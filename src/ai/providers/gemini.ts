import type { AIProvider, GenerationRequest } from './base.js';

const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MAX_TOKENS = 4096;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false;
  const cause = (err as { cause?: { code?: string } }).cause;
  const code = cause?.code;
  if (
    code === 'UND_ERR_SOCKET' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  ) {
    return true;
  }
  return /fetch failed|socket hang up|other side closed|network/i.test(err.message);
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export interface GeminiProviderOptions {
  apiBase?: string;
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private readonly apiBase: string;

  constructor(opts: GeminiProviderOptions = {}) {
    this.apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  }

  async generate(req: GenerationRequest): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY (or GOOGLE_AI_API_KEY) is not set.');
    }

    const systemText = req.systemSuffix
      ? `${req.systemPrompt}\n\n${req.systemSuffix}`
      : req.systemPrompt;

    const url = `${this.apiBase}/models/${encodeURIComponent(req.model)}:generateContent?key=${apiKey}`;

    const body = {
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: req.userMessage }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
      },
    };

    const payload = JSON.stringify(body);

    let res: Response | undefined;
    let text = '';
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
        });
        text = await res.text();
        const retryableStatus = res.status === 408 || res.status === 429 || res.status >= 500;
        if (!res.ok && retryableStatus && attempt < MAX_ATTEMPTS) {
          const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
          console.warn(
            `[gemini] HTTP ${res.status} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${delay}ms`,
          );
          await sleep(delay);
          continue;
        }
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (!isRetryableError(err) || attempt === MAX_ATTEMPTS) throw err;
        const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[gemini] network error on attempt ${attempt}/${MAX_ATTEMPTS} (${msg}), retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }

    if (!res) {
      throw lastErr instanceof Error ? lastErr : new Error('Gemini fetch failed');
    }
    if (!res.ok) {
      throw new Error(`Gemini API ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    }

    let parsed: GeminiResponse;
    try {
      parsed = JSON.parse(text) as GeminiResponse;
    } catch {
      throw new Error(`Gemini returned non-JSON: ${text.slice(0, 500)}`);
    }

    if (parsed.error) {
      throw new Error(
        `Gemini error ${parsed.error.code ?? '?'}: ${parsed.error.message ?? 'unknown'}`,
      );
    }
    if (parsed.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked prompt: ${parsed.promptFeedback.blockReason}`);
    }

    const candidate = parsed.candidates?.[0];
    const partText = candidate?.content?.parts?.[0]?.text;
    if (!partText) {
      throw new Error(
        `Gemini response missing text. finishReason=${candidate?.finishReason ?? 'unknown'}`,
      );
    }
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error(
        `Gemini hit MAX_TOKENS limit (output truncated at ${partText.length} chars). Increase ai.maxTokens in config.`,
      );
    }
    return partText.trim();
  }
}
