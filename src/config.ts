import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import 'dotenv/config';
import type { AppConfig } from './types.js';

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

function expandEnv(input: unknown): unknown {
  if (typeof input === 'string') {
    return input.replace(ENV_PATTERN, (_, key: string) => process.env[key] ?? '');
  }
  if (Array.isArray(input)) return input.map(expandEnv);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = expandEnv(v);
    }
    return out;
  }
  return input;
}

export function loadConfig(path?: string): AppConfig {
  const configPath = resolve(path ?? process.env.CONFIG_PATH ?? './config/pushers.config.yaml');
  const raw = readFileSync(configPath, 'utf8');
  const parsed = parseYaml(raw);
  const expanded = expandEnv(parsed) as AppConfig;
  validate(expanded);
  return expanded;
}

function validate(cfg: AppConfig): void {
  if (!cfg.sources) throw new Error('config.sources is required');
  if (!cfg.ai?.model) throw new Error('config.ai.model is required');
  if (!Array.isArray(cfg.pushers)) throw new Error('config.pushers must be an array');
}
