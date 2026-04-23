import type {
  NewsItem,
  AISummaryItem,
  DailyReport,
  AIConfig,
} from '../types.js';
import {
  ALLOWED_CATEGORIES,
  buildSystemPrompt,
  buildUserPrompt,
} from './prompts.js';
import { buildProvider } from './providers/index.js';

export interface SummarizeOptions {
  /** ISO date string for the report (YYYY-MM-DD) */
  date: string;
}

const DEFAULT_MAX_ITEMS = 20;
const DEFAULT_LANGUAGE = 'zh-CN';
const DEFAULT_MAX_TOKENS = 16384;
const RAW_TEXT_LIMIT = 3000;

interface ModelItemInput {
  id: string;
  title: string;
  url?: string;
  score?: number;
  author?: string;
  createdAt: string;
  rawText?: string;
}

interface ModelOutputItem {
  id: string;
  title: string;
  url?: string;
  category: string;
  oneLineSummary: string;
  keyPoints: string[];
}

interface ModelOutput {
  items: ModelOutputItem[];
}

export async function summarize(
  items: NewsItem[],
  cfg: AIConfig,
  opts: SummarizeOptions,
): Promise<DailyReport> {
  const language = cfg.language ?? DEFAULT_LANGUAGE;
  const maxItems = cfg.maxItemsToSummarize ?? DEFAULT_MAX_ITEMS;
  const promptCaching = cfg.promptCaching !== false;

  const selected = selectItems(items, maxItems);
  const modelInput: ModelItemInput[] = selected.map(toModelInput);
  const itemsJson = JSON.stringify(modelInput, null, 2);

  const systemPrompt = buildSystemPrompt(language);
  const userPrompt = buildUserPrompt(opts.date, itemsJson);

  const provider = buildProvider(cfg);
  const result = await provider.generate({
    systemPrompt,
    systemSuffix: `当日日期：${opts.date}`,
    userMessage: userPrompt,
    model: cfg.model,
    maxTokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(typeof cfg.temperature === 'number' ? { temperature: cfg.temperature } : {}),
    enableCaching: promptCaching,
  });

  const parsed = parseModelJson(result.text);
  reportCoverage(parsed.items, selected);
  const summaryItems = normalizeItems(parsed.items, selected);

  const markdown = renderMarkdown({
    date: opts.date,
    items: summaryItems,
    sourceCount: countSources(items),
    allItemsCount: items.length,
  });

  return {
    date: opts.date,
    generatedAt: new Date().toISOString(),
    title: `HN AI 日报 ${opts.date}`,
    markdown,
    items: summaryItems,
    meta: {
      sourceCount: countSources(items),
      itemCount: summaryItems.length,
      model: `${provider.name}/${cfg.model}`,
      ...(result.usage ? { usage: result.usage } : {}),
    },
  };
}

function reportCoverage(modelItems: ModelOutputItem[], input: NewsItem[]): void {
  const inputIds = new Set(input.map((it) => it.id));
  const outputIds = new Set<string>();
  for (const it of modelItems) {
    if (it && typeof it.id === 'string') outputIds.add(it.id);
  }

  const missing: string[] = [];
  for (const id of inputIds) if (!outputIds.has(id)) missing.push(id);

  const invented: string[] = [];
  for (const id of outputIds) if (!inputIds.has(id)) invented.push(id);

  if (missing.length > 0) {
    const lossPct = (missing.length / input.length) * 100;
    console.warn(
      `[ai] coverage: model dropped ${missing.length}/${input.length} (${lossPct.toFixed(1)}%) items. ` +
        `Missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`,
    );
  }
  if (invented.length > 0) {
    console.warn(
      `[ai] coverage: model invented ${invented.length} unknown ids: ` +
        `${invented.slice(0, 5).join(', ')}${invented.length > 5 ? '...' : ''} (will be dropped)`,
    );
  }
}

function selectItems(items: NewsItem[], maxItems: number): NewsItem[] {
  return [...items]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxItems);
}

function toModelInput(item: NewsItem): ModelItemInput {
  const out: ModelItemInput = {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
  };
  if (item.url) out.url = item.url;
  if (typeof item.score === 'number') out.score = item.score;
  if (item.author) out.author = item.author;
  if (item.rawText) {
    out.rawText =
      item.rawText.length > RAW_TEXT_LIMIT
        ? item.rawText.slice(0, RAW_TEXT_LIMIT)
        : item.rawText;
  }
  return out;
}

function parseModelJson(text: string): ModelOutput {
  const trimmed = text.trim();
  let parsed: unknown;
  let candidate = trimmed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Fall back: extract the first complete top-level JSON object.
    // Models occasionally emit multiple objects concatenated or trailing prose,
    // which a greedy regex would mis-capture as one invalid blob.
    const extracted = extractFirstJsonObject(trimmed);
    if (!extracted) {
      throw new Error(
        `AI response did not contain a JSON object. Raw: ${trimmed.slice(0, 500)}`,
      );
    }
    candidate = extracted;
    try {
      parsed = JSON.parse(extracted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to parse JSON from AI response: ${msg}. Raw: ${extracted.slice(0, 500)}`,
      );
    }
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw new Error(
      `AI JSON missing required "items" array. Raw: ${candidate.slice(0, 500)}`,
    );
  }
  return parsed as ModelOutput;
}

/** Walk the text string-aware and return the first balanced { ... } block. */
function extractFirstJsonObject(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function normalizeItems(
  modelItems: ModelOutputItem[],
  source: NewsItem[],
): AISummaryItem[] {
  const sourceById = new Map(source.map((it) => [it.id, it] as const));
  const allowed = new Set<string>(ALLOWED_CATEGORIES);
  const out: AISummaryItem[] = [];

  for (const it of modelItems) {
    if (!it || typeof it.id !== 'string') continue;
    const original = sourceById.get(it.id);
    if (!original) continue; // drop AI-invented ids (already warned via reportCoverage)
    const title =
      typeof it.title === 'string' && it.title.length > 0
        ? it.title
        : original.title;
    const url = it.url ?? original.url;
    const category = allowed.has(it.category) ? it.category : '其它';
    const oneLineSummary =
      typeof it.oneLineSummary === 'string' ? it.oneLineSummary : '';
    const keyPoints = Array.isArray(it.keyPoints)
      ? it.keyPoints.filter((k): k is string => typeof k === 'string')
      : [];
    const summary: AISummaryItem = {
      id: it.id,
      title,
      category,
      oneLineSummary,
      keyPoints,
    };
    if (url) summary.url = url;
    if (typeof original?.score === 'number') summary.score = original.score;
    out.push(summary);
  }

  return out;
}

function countSources(items: NewsItem[]): number {
  const set = new Set<string>();
  for (const it of items) set.add(it.source);
  return set.size;
}

interface RenderArgs {
  date: string;
  items: AISummaryItem[];
  sourceCount: number;
  allItemsCount: number;
}

function renderMarkdown(args: RenderArgs): string {
  const { date, items, sourceCount, allItemsCount } = args;
  const lines: string[] = [];
  lines.push(`# HN AI 日报 ${date}`);
  lines.push('');
  lines.push(
    `> 日期：${date} ｜ 来源数：${sourceCount} ｜ 候选条目：${allItemsCount} ｜ 入选：${items.length}`,
  );
  lines.push('');

  const grouped = groupByCategory(items);
  for (const category of orderedCategories(grouped)) {
    const list = grouped.get(category);
    if (!list || list.length === 0) continue;
    lines.push(`## ${category}`);
    lines.push('');
    for (const it of list) {
      const titleLink = it.url
        ? `[${it.title}](${it.url})`
        : it.title;
      lines.push(`- **${titleLink}**: ${it.oneLineSummary}`);
      for (const kp of it.keyPoints) {
        lines.push(`  - ${kp}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function groupByCategory(
  items: AISummaryItem[],
): Map<string, AISummaryItem[]> {
  const map = new Map<string, AISummaryItem[]>();
  for (const it of items) {
    const arr = map.get(it.category) ?? [];
    arr.push(it);
    map.set(it.category, arr);
  }
  return map;
}

function orderedCategories(grouped: Map<string, AISummaryItem[]>): string[] {
  const present = new Set(grouped.keys());
  const ordered: string[] = [];
  for (const c of ALLOWED_CATEGORIES) {
    if (present.has(c)) {
      ordered.push(c);
      present.delete(c);
    }
  }
  for (const c of present) ordered.push(c);
  return ordered;
}
