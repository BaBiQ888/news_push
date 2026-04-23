import type { NewsItem } from '../types.js';

// Rule-based blocklist applied BEFORE the AI sees the candidate set.
// The AI's job is summarization only; quality/spam filtering lives here in code.

interface BlockRule {
  name: string;
  pattern: RegExp;
}

const TITLE_RULES: BlockRule[] = [
  { name: 'hiring-tag', pattern: /^\s*\[hiring\]/i },
  { name: 'hiring-prefix', pattern: /^\s*hiring:/i },
  { name: 'ask-hn-hiring', pattern: /^\s*ask hn:\s*who(['’ ]?s| is) hiring/i },
  { name: 'ask-hn-wants-hired', pattern: /^\s*ask hn:\s*who wants to be hired/i },
  { name: 'ask-hn-freelancer', pattern: /^\s*ask hn:\s*freelancer\??\s*[—\-]?\s*seeking freelancer/i },
];

export interface FilterStats {
  total: number;
  blocked: number;
  reasons: Record<string, number>;
}

export function filterByRules(items: NewsItem[]): { kept: NewsItem[]; stats: FilterStats } {
  const kept: NewsItem[] = [];
  const stats: FilterStats = { total: items.length, blocked: 0, reasons: {} };
  for (const item of items) {
    const matched = TITLE_RULES.find((r) => r.pattern.test(item.title));
    if (matched) {
      stats.blocked++;
      stats.reasons[matched.name] = (stats.reasons[matched.name] ?? 0) + 1;
      continue;
    }
    kept.push(item);
  }
  return { kept, stats };
}
