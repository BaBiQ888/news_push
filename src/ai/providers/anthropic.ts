import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, GenerationRequest } from './base.js';

const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';

  async generate(req: GenerationRequest): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set.');
    }
    const client = new Anthropic({ apiKey });

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
    return parts.join('\n').trim();
  }
}
