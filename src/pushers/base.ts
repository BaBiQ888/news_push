import type { PushResult } from '../types.js';

export class PushError extends Error {
  constructor(
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'PushError';
  }
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function failResult(name: string, err: unknown, detail?: unknown): PushResult {
  return {
    pusher: name,
    ok: false,
    error: toErrorMessage(err),
    detail: detail ?? (err instanceof PushError ? err.detail : undefined),
  };
}

export function okResult(name: string, detail?: unknown): PushResult {
  return { pusher: name, ok: true, detail };
}

export interface RequestJsonOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function requestJson<T = unknown>(url: string, opts: RequestJsonOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, timeoutMs = 15000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      signal: controller.signal,
    };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      throw new PushError(`HTTP ${res.status} ${res.statusText} for ${url}`, parsed);
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Truncate a string to a max byte size (utf-8), appending suffix if cut. */
export function truncateBytes(input: string, maxBytes: number, suffix = '\n\n... (truncated, 详见归档文档)'): string {
  const buf = Buffer.from(input, 'utf8');
  if (buf.length <= maxBytes) return input;
  const suffixBuf = Buffer.from(suffix, 'utf8');
  const sliceLen = Math.max(0, maxBytes - suffixBuf.length);
  // Buffer.slice may cut a multi-byte character — decode with replacement and trim.
  const head = buf.subarray(0, sliceLen).toString('utf8');
  return head + suffix;
}
