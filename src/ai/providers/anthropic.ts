import Anthropic from '@anthropic-ai/sdk';
import type { UsageInfo } from '../../types.js';
import type { AIProvider, GenerationRequest, GenerationResult } from './base.js';

const DEFAULT_MAX_TOKENS = 4096;
// Match the manual retry depth used by the Gemini provider.
// SDK retries on connection errors, 408/409/429/5xx (same coverage as Gemini's loop).
const SDK_MAX_RETRIES = 4;

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set.');
    }
    const client = new Anthropic({ apiKey, maxRetries: SDK_MAX_RETRIES });

    const systemBlocks = req.enableCaching
      ? [
          {
            type: 'text' as const,
            text: req.systemPrompt,
            cache_control: { type: 'ephemeral' as const },
          },
          ...(req.systemSuffix
            ? [{ type: 'text' as const, text: req.systemSuffix }]
            : []),
        ]
      : [
          {
            type: 'text' as const,
            text: req.systemSuffix
              ? `${req.systemPrompt}\n\n${req.systemSuffix}`
              : req.systemPrompt,
          },
        ];

    const response = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
      system: systemBlocks,
      messages: [{ role: 'user', content: req.userMessage }],
    });

    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') parts.push(block.text);
    }
    const text = parts.join('\n').trim();

    const u = response.usage;
    const usage: UsageInfo = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
    };
    if (u.cache_read_input_tokens) usage.cachedTokens = u.cache_read_input_tokens;
    if (u.cache_creation_input_tokens) usage.cacheCreationTokens = u.cache_creation_input_tokens;

    return { text, usage };
  }
}
