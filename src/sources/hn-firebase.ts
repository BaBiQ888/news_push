import type { NewsItem, SourceFetcher, SourcesConfig } from '../types.js';
import { fetchJson, hnItemUrl, pool } from './base.js';

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  by?: string;
  score?: number;
  time?: number;
  descendants?: number;
  type?: string;
  dead?: boolean;
  deleted?: boolean;
}

const BASE = 'https://hacker-news.firebaseio.com/v0';

type StoryType = NonNullable<NonNullable<SourcesConfig['hn_firebase']>['storyType']>;

function listEndpoint(storyType: StoryType): string {
  switch (storyType) {
    case 'best':
      return `${BASE}/beststories.json`;
    case 'new':
      return `${BASE}/newstories.json`;
    case 'top':
    default:
      return `${BASE}/topstories.json`;
  }
}

export function createHnFirebaseFetcher(cfg: NonNullable<SourcesConfig['hn_firebase']>): SourceFetcher {
  const storyType: StoryType = cfg.storyType ?? 'top';
  const limit = Math.max(1, cfg.limit ?? 30);
  return {
    name: 'hn-firebase',
    async fetch(): Promise<NewsItem[]> {
      const ids = await fetchJson<number[]>(listEndpoint(storyType), { timeoutMs: 15000 });
      const slice = ids.slice(0, limit);
      const items = await pool(slice, 8, async (id) => {
        try {
          return await fetchJson<HNItem | null>(`${BASE}/item/${id}.json`, { timeoutMs: 15000 });
        } catch {
          return null;
        }
      });
      const out: NewsItem[] = [];
      for (const it of items) {
        if (!it || it.deleted || it.dead || !it.title) continue;
        const id = `hn:${it.id}`;
        const createdAt = it.time ? new Date(it.time * 1000).toISOString() : new Date(0).toISOString();
        out.push({
          id,
          source: 'hn-firebase',
          title: it.title,
          url: it.url ?? hnItemUrl(it.id),
          author: it.by,
          score: it.score,
          commentsUrl: hnItemUrl(it.id),
          createdAt,
          meta: {
            descendants: it.descendants,
            type: it.type,
            storyType,
          },
        });
      }
      return out;
    },
  };
}
