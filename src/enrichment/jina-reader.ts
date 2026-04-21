import type { EnrichmentConfig, NewsItem } from '../types.js';
import { fetchWithTimeout, pool } from '../sources/base.js';

const MAX_CHARS = 8000;

function shouldEnrich(item: NewsItem): boolean {
  if (!item.url) return false;
  try {
    const u = new URL(item.url);
    if (u.hostname === 'news.ycombinator.com' || u.hostname.endsWith('.ycombinator.com')) {
      return false;
    }
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchOne(url: string, timeoutMs: number): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
      timeoutMs,
    });
    if (!res.ok) return undefined;
    const text = await res.text();
    if (!text) return undefined;
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  } catch {
    return undefined;
  }
}

export async function enrichWithJina(
  items: NewsItem[],
  cfg: EnrichmentConfig['jina_reader'],
): Promise<NewsItem[]> {
  if (!cfg?.enabled) return items;
  const timeoutMs = cfg.timeoutMs ?? 15000;
  const concurrency = Math.max(1, cfg.maxConcurrency ?? 4);
  const targets = items.map((it, i) => ({ it, i }));
  const out = items.slice();
  await pool(targets, concurrency, async ({ it, i }) => {
    if (!shouldEnrich(it) || !it.url) return;
    const text = await fetchOne(it.url, timeoutMs);
    if (text) {
      const current = out[i];
      if (current) out[i] = { ...current, rawText: text };
    }
  });
  return out;
}
