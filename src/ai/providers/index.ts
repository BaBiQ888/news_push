import type { AIConfig } from '../../types.js';
import type { AIProvider } from './base.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';

export type { AIProvider, GenerationRequest } from './base.js';
export { AnthropicProvider } from './anthropic.js';
export { GeminiProvider } from './gemini.js';

export function buildProvider(cfg: AIConfig): AIProvider {
  switch (cfg.provider) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'gemini':
      return new GeminiProvider({ apiBase: cfg.apiBase });
    default: {
      const exhaustive: never = cfg.provider;
      throw new Error(`Unknown AI provider: ${exhaustive as string}`);
    }
  }
}
