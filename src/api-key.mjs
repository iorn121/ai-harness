import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const apiKeyPath = path.join(os.homedir(), '.config', 'ai-harness', 'env');

const CREDENTIAL_KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

/**
 * @param {string} text
 */
export function credentialsFromEnvFile(text) {
  /** @type {Record<string, string>} */
  const found = {};
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=(.*)$/);
    if (!match) continue;
    found[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return found;
}

/**
 * 環境変数をファイルより優先する。空文字は未設定として扱う。
 * @param {{ env?: NodeJS.ProcessEnv, fileText?: string }} [options]
 */
export function resolveCredentials(options = {}) {
  const fromFile =
    options.fileText != null
      ? credentialsFromEnvFile(options.fileText)
      : readCredentialFile();
  /** @type {Record<string, string>} */
  const resolved = {};
  for (const key of CREDENTIAL_KEYS) {
    const fromEnv = options.env?.[key]?.trim();
    resolved[key] = fromEnv || fromFile[key] || '';
  }
  return resolved;
}

/**
 * @param {Record<string, string>} credentials
 */
export function hasExplicitCredentials(credentials) {
  return CREDENTIAL_KEYS.some((key) => Boolean(credentials?.[key]));
}

function readCredentialFile() {
  try {
    return credentialsFromEnvFile(readFileSync(apiKeyPath, 'utf8'));
  } catch {
    return {};
  }
}
