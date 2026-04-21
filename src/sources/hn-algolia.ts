import type { NewsItem, SourceFetcher, SourcesConfig } from '../types.js';
import { fetchJson, hnItemUrl } from './base.js';

interface AlgoliaHit {
  objectID: string;
  title?: string;
  story_title?: string;
  url?: string;
  story_url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  created_at_i?: number;
  story_text?: string;
  _tags?: string[];
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

const BASE = 'https://hn.algolia.com/api/v1';

export function createHnAlgoliaFetcher(cfg: NonNullable<SourcesConfig['hn_algolia']>): SourceFetcher {
  const timeWindowHours = cfg.timeWindowHours ?? 24;
  return {
    name: 'hn-algolia',
    async fetch(): Promise<NewsItem[]> {
      const sinceTs = Math.floor(Date.now() / 1000) - timeWindowHours * 3600;
      const seen = new Map<string, NewsItem>();
      for (const q of cfg.queries) {
        const numericFilters: string[] = [`created_at_i>${sinceTs}`];
        if (typeof q.minPoints === 'number') {
          numericFilters.push(`points>${q.minPoints}`);
        }
        const params = new URLSearchParams({
          query: q.query,
          tags: 'story',
          numericFilters: numericFilters.join(','),
          hitsPerPage: '50',
        });
        const url = `${BASE}/search_by_date?${params.toString()}`;
        let data: AlgoliaResponse;
        try {
          data = await fetchJson<AlgoliaResponse>(url, { timeoutMs: 15000 });
        } catch {
          continue;
        }
        for (const hit of data.hits ?? []) {
          if (!hit.objectID) continue;
          const title = hit.title ?? hit.story_title;
          if (!title) continue;
          const id = `hn:${hit.objectID}`;
          if (seen.has(id)) continue;
          const createdAt = hit.created_at
            ? new Date(hit.created_at).toISOString()
            : hit.created_at_i
              ? new Date(hit.created_at_i * 1000).toISOString()
              : new Date(0).toISOString();
          const link = hit.url ?? hit.story_url ?? hnItemUrl(hit.objectID);
          seen.set(id, {
            id,
            source: 'hn-algolia',
            title,
            url: link,
            author: hit.author,
            score: hit.points,
            commentsUrl: hnItemUrl(hit.objectID),
            createdAt,
            meta: {
              num_comments: hit.num_comments,
              query: q.query,
              tags: hit._tags,
              storyText: hit.story_text,
            },
          });
        }
      }
      return Array.from(seen.values());
    },
  };
}
