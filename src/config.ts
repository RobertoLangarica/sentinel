import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// Config lives in the user's home config dir so it's set once and forgotten.
// Resolution order for the API key: config file → environment variable.
export const CONFIG_DIR = join(homedir(), '.config', 'sentinel');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export interface SentinelConfig {
  anthropicApiKey?: string;
  model?: string;
}

export function loadConfig(): SentinelConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as SentinelConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: SentinelConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

// Resolve the API key: config file first, then ANTHROPIC_API_KEY env var.
export function getApiKey(): string | undefined {
  return loadConfig().anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
}

// Resolve the default model: explicit override → config → built-in default (applied in provider).
export function getConfiguredModel(): string | undefined {
  return loadConfig().model ?? process.env.SENTINEL_MODEL;
}

export function setApiKey(key: string): void {
  const cfg = loadConfig();
  cfg.anthropicApiKey = key;
  saveConfig(cfg);
}

export function setModel(model: string): void {
  const cfg = loadConfig();
  cfg.model = model;
  saveConfig(cfg);
}
