// Provider-agnostic generation contract.
// Each AI vendor implements this interface; summarizer stays vendor-neutral.

export interface GenerationRequest {
  /** Stable system prompt. Providers that support inline caching will mark this as cacheable. */
  systemPrompt: string;
  /** Small dynamic tail appended AFTER the cacheable system block (e.g. today's date). */
  systemSuffix?: string;
  /** Single user message. */
  userMessage: string;
  /** Model id, e.g. "claude-sonnet-4-6", "gemini-3-pro". */
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** Hint to enable inline prompt caching when supported. */
  enableCaching?: boolean;
}

export interface AIProvider {
  /** Stable identifier, used in logs / DailyReport.meta */
  readonly name: string;
  /** Returns raw text response from the model (caller is responsible for JSON parsing). */
  generate(req: GenerationRequest): Promise<string>;
}
