import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const apiKeyPath = path.join(os.homedir(), '.config', 'ai-harness', 'env');

/**
 * @param {string} text
 */
export function apiKeyFromEnvFile(text) {
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^CURSOR_API_KEY=(.*)$/);
    if (!match) continue;
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fileText?: string }} [options]
 */
export function resolveApiKey(options = {}) {
  const fromEnv = options.env?.CURSOR_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (options.fileText != null) return apiKeyFromEnvFile(options.fileText);
  try {
    return apiKeyFromEnvFile(readFileSync(apiKeyPath, 'utf8'));
  } catch {
    return '';
  }
}
