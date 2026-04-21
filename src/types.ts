// Shared types across sources, AI, pushers and orchestrator.
// All layers MUST conform to these contracts.

export interface NewsItem {
  /** Globally unique id, e.g. "hn:12345". Used for dedup. */
  id: string;
  /** Source key, e.g. "hn-firebase", "hn-algolia". */
  source: string;
  title: string;
  url?: string;
  author?: string;
  score?: number;
  commentsUrl?: string;
  /** ISO 8601 string. */
  createdAt: string;
  /** Optional plain-text/markdown body fetched by enrichment. */
  rawText?: string;
  /** Free-form per-source metadata. */
  meta?: Record<string, unknown>;
}

export interface AISummaryItem {
  /** Matches a NewsItem.id */
  id: string;
  title: string;
  url?: string;
  /** AI-assigned topic bucket, e.g. "AI/LLM", "工程", "创业" */
  category: string;
  /** One sentence describing the value/why-care */
  oneLineSummary: string;
  /** 1-5 bullet key takeaways */
  keyPoints: string[];
  score?: number;
}

export interface DailyReport {
  /** YYYY-MM-DD in local timezone */
  date: string;
  /** ISO 8601 generation timestamp */
  generatedAt: string;
  /** Display title, e.g. "HN AI 日报 2026-04-21" */
  title: string;
  /** Full markdown body, suitable for posting to docs / chat cards */
  markdown: string;
  /** Structured items, suitable for sheets/bitable rows */
  items: AISummaryItem[];
  meta: {
    sourceCount: number;
    itemCount: number;
    model?: string;
  };
}

export interface PushResult {
  pusher: string;
  ok: boolean;
  error?: string;
  detail?: unknown;
}

export interface Pusher {
  readonly name: string;
  push(report: DailyReport): Promise<PushResult>;
}

export interface SourceFetcher {
  readonly name: string;
  fetch(): Promise<NewsItem[]>;
}

// ============ Config types ============

export interface SourcesConfig {
  hn_firebase?: {
    enabled: boolean;
    storyType?: 'top' | 'best' | 'new';
    limit?: number;
  };
  hn_algolia?: {
    enabled: boolean;
    queries: { query: string; minPoints?: number }[];
    timeWindowHours?: number;
  };
}

export interface EnrichmentConfig {
  jina_reader?: {
    enabled: boolean;
    timeoutMs?: number;
    maxConcurrency?: number;
  };
}

export type AIProviderName = 'anthropic' | 'gemini';

export interface AIConfig {
  provider: AIProviderName;
  model: string;
  /** Override API base URL (mainly for gemini / self-hosted proxy) */
  apiBase?: string;
  maxItemsToSummarize?: number;
  /** Whether to use inline prompt caching where the provider supports it */
  promptCaching?: boolean;
  /** Optional language hint for the summary, e.g. "zh-CN" */
  language?: string;
  /** Override generation params */
  maxTokens?: number;
  temperature?: number;
}

export type PusherConfig =
  | {
      type: 'feishu_bot';
      enabled: boolean;
      webhook: string;
      secret?: string;
    }
  | {
      type: 'feishu_doc';
      enabled: boolean;
      appId: string;
      appSecret: string;
      target:
        | { kind: 'bitable'; appToken: string; tableId: string }
        | { kind: 'doc'; documentId: string };
    }
  | {
      type: 'google_sheets';
      enabled: boolean;
      credentialsFile?: string;
      spreadsheetId: string;
      sheetName?: string;
    }
  | {
      type: 'google_docs';
      enabled: boolean;
      credentialsFile?: string;
      documentId: string;
    };

export interface StateConfig {
  dedupFile?: string;
  retentionDays?: number;
}

export interface AppConfig {
  sources: SourcesConfig;
  enrichment?: EnrichmentConfig;
  ai: AIConfig;
  pushers: PusherConfig[];
  state?: StateConfig;
}
