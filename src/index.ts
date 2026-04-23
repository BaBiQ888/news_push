import { loadConfig } from './config.js';
import { fetchAll } from './sources/index.js';
import { filterByRules } from './sources/filter.js';
import { enrichWithJina } from './enrichment/jina-reader.js';
import { summarize } from './ai/summarizer.js';
import { buildPushers, pushAll } from './pushers/index.js';
import { DedupStore } from './state/dedup.js';
import type { NewsItem, PushResult } from './types.js';

interface RunOptions {
  /** Override config path */
  configPath?: string;
  /** Skip persistent dedup (re-summarize even if seen). Useful for re-runs. */
  ignoreDedup?: boolean;
  /** Dry run — generate report but skip pushing. */
  dryRun?: boolean;
}

export async function run(options: RunOptions = {}): Promise<{
  itemsFetched: number;
  itemsAfterRuleFilter: number;
  itemsAfterDedup: number;
  reportItems: number;
  pushResults: PushResult[];
}> {
  const cfg = loadConfig(options.configPath);
  const today = todayLocal();

  console.log(`[run] starting for ${today}`);

  const fetched = await fetchAll(cfg.sources);
  console.log(`[run] fetched ${fetched.length} items from sources`);

  const ruleFiltered = filterByRules(fetched);
  if (ruleFiltered.stats.blocked > 0) {
    const reasonStr = Object.entries(ruleFiltered.stats.reasons)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(
      `[run] rule-filter: ${ruleFiltered.kept.length} kept / ${ruleFiltered.stats.blocked} blocked (${reasonStr})`,
    );
  }

  const dedupPath = cfg.state?.dedupFile ?? './data/seen.json';
  const dedupStore = new DedupStore(dedupPath, cfg.state?.retentionDays);

  let fresh: NewsItem[];
  if (options.ignoreDedup) {
    fresh = ruleFiltered.kept;
    console.log(`[run] dedup skipped (--ignore-dedup): ${fresh.length} items`);
  } else {
    const result = dedupStore.filterUnseen(ruleFiltered.kept);
    fresh = result.kept;
    const s = result.stats;
    console.log(
      `[run] dedup: ${fresh.length} kept / ${ruleFiltered.kept.length - fresh.length} blocked ` +
        `(id=${s.blockedById}, url=${s.blockedByUrl}, title=${s.blockedByTitle}, batch=${s.blockedInBatch})`,
    );
  }

  if (fresh.length === 0) {
    console.log('[run] nothing new today, exiting');
    return {
      itemsFetched: fetched.length,
      itemsAfterRuleFilter: ruleFiltered.kept.length,
      itemsAfterDedup: 0,
      reportItems: 0,
      pushResults: [],
    };
  }

  let workingSet = fresh;
  if (cfg.enrichment?.jina_reader?.enabled) {
    console.log('[run] enriching with Jina Reader...');
    workingSet = await enrichWithJina(fresh, cfg.enrichment.jina_reader);
    const enriched = workingSet.filter((it) => it.rawText).length;
    console.log(`[run] enriched ${enriched}/${workingSet.length} items`);
  }

  console.log(`[run] summarizing with ${cfg.ai.model}...`);
  const report = await summarize(workingSet, cfg.ai, { date: today });
  console.log(`[run] report has ${report.items.length} items`);
  if (report.meta.usage) {
    const u = report.meta.usage;
    const cached = u.cachedTokens ? ` cached=${u.cachedTokens}` : '';
    const cacheWrite = u.cacheCreationTokens ? ` cacheWrite=${u.cacheCreationTokens}` : '';
    console.log(`[run] tokens: in=${u.inputTokens} out=${u.outputTokens}${cached}${cacheWrite}`);
  }

  let pushResults: PushResult[] = [];
  if (options.dryRun) {
    console.log('[run] dry-run mode: skipping push');
    console.log('---\n' + report.markdown + '\n---');
  } else {
    const pushers = buildPushers(cfg.pushers);
    if (pushers.length === 0) {
      console.warn('[run] no pushers enabled');
    } else {
      console.log(`[run] pushing to ${pushers.length} target(s): ${pushers.map((p) => p.name).join(', ')}`);
      pushResults = await pushAll(report, pushers);
      for (const r of pushResults) {
        if (r.ok) console.log(`  ✓ ${r.pusher}`);
        else console.error(`  ✗ ${r.pusher}: ${r.error}`);
      }
    }
  }

  if (options.ignoreDedup) {
    console.log('[run] state save skipped (--ignore-dedup)');
  } else {
    dedupStore.markSeen(fresh);
    dedupStore.save();
  }

  return {
    itemsFetched: fetched.length,
    itemsAfterRuleFilter: ruleFiltered.kept.length,
    itemsAfterDedup: fresh.length,
    reportItems: report.items.length,
    pushResults,
  };
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  run().catch((err) => {
    console.error('[run] fatal:', err);
    process.exit(1);
  });
}
