import type { NewsItem, SourceFetcher, SourcesConfig } from '../types.js';
import { createHnFirebaseFetcher } from './hn-firebase.js';
import { createHnAlgoliaFetcher } from './hn-algolia.js';

export function buildSources(cfg: SourcesConfig): SourceFetcher[] {
  const out: SourceFetcher[] = [];
  if (cfg.hn_firebase?.enabled) {
    out.push(createHnFirebaseFetcher(cfg.hn_firebase));
  }
  if (cfg.hn_algolia?.enabled) {
    out.push(createHnAlgoliaFetcher(cfg.hn_algolia));
  }
  return out;
}

export async function fetchAll(cfg: SourcesConfig): Promise<NewsItem[]> {
  const fetchers = buildSources(cfg);
  const results = await Promise.all(
    fetchers.map(async (f) => {
      try {
        return await f.fetch();
      } catch (err) {
        console.error(`[sources] ${f.name} failed:`, err instanceof Error ? err.message : err);
        return [] as NewsItem[];
      }
    }),
  );
  const dedup = new Map<string, NewsItem>();
  for (const list of results) {
    for (const item of list) {
      const existing = dedup.get(item.id);
      if (!existing) {
        dedup.set(item.id, item);
        continue;
      }
      const merged: NewsItem = {
        ...existing,
        ...item,
        score: Math.max(existing.score ?? 0, item.score ?? 0) || existing.score || item.score,
        meta: { ...(existing.meta ?? {}), ...(item.meta ?? {}) },
      };
      dedup.set(item.id, merged);
    }
  }
  return Array.from(dedup.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
