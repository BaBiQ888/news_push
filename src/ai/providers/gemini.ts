import type { AIProvider, GenerationRequest } from './base.js';

const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MAX_TOKENS = 4096;

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

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await res.text();
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
    return partText.trim();
  }
}
