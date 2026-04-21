import { loadConfig } from './config.js';
import { fetchAll } from './sources/index.js';
import { enrichWithJina } from './enrichment/jina-reader.js';
import { summarize } from './ai/summarizer.js';
import { buildPushers, pushAll } from './pushers/index.js';
import { DedupStore } from './state/dedup.js';
import type { NewsItem, PushResult } from './types.js';

interface RunOptions {
  /** Override config path */
  configPath?: string;
  /** Skip dedup (re-summarize even if seen). Useful for re-runs. */
  ignoreDedup?: boolean;
  /** Dry run — generate report but skip pushing. */
  dryRun?: boolean;
}

export async function run(options: RunOptions = {}): Promise<{
  itemsFetched: number;
  itemsAfterDedup: number;
  reportItems: number;
  pushResults: PushResult[];
}> {
  const cfg = loadConfig(options.configPath);
  const today = todayLocal();

  console.log(`[run] starting for ${today}`);

  const fetched = await fetchAll(cfg.sources);
  console.log(`[run] fetched ${fetched.length} items from sources`);

  const dedupPath = cfg.state?.dedupFile ?? './data/seen.json';
  const dedupStore = new DedupStore(dedupPath, cfg.state?.retentionDays);
  const fresh: NewsItem[] = options.ignoreDedup
    ? fetched
    : dedupStore.filterUnseen(fetched);
  console.log(`[run] ${fresh.length} fresh items after dedup`);

  if (fresh.length === 0) {
    console.log('[run] nothing new today, exiting');
    return {
      itemsFetched: fetched.length,
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

  dedupStore.markSeen(fresh.map((it) => it.id));
  dedupStore.save();

  return {
    itemsFetched: fetched.length,
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
