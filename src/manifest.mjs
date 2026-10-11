import { HarnessError } from './errors.mjs';
import { missingTestingCommands } from './testing-policy.mjs';

export const MAX_VERIFY_RETRIES = 5;

/**
 * @param {unknown} raw
 */
export function applyDefaults(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HarnessError('harness.json はオブジェクトである必要があります');
  }
  const input = /** @type {Record<string, any>} */ (raw);
  if (typeof input.name !== 'string' || !input.name.trim()) {
    throw new HarnessError('harness.json の name が必要です');
  }
  if (input.release?.mode != null && input.release.mode !== 'pull-request') {
    throw new HarnessError('release.mode は pull-request のみです。マージは人間が行います');
  }
  const verify = input.commands?.verify ?? [];
  if (!Array.isArray(verify) || verify.some((command) => typeof command !== 'string' || !command.trim())) {
    throw new HarnessError('commands.verify は空でない文字列の配列である必要があります');
  }
  const install = input.commands?.install ?? null;
  if (install != null && typeof install !== 'string') {
    throw new HarnessError('commands.install は文字列である必要があります');
  }
  const retries = input.limits?.verifyRetries ?? 2;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new HarnessError('limits.verifyRetries は 0 以上の整数である必要があります');
  }
  const timeoutMs = input.limits?.timeoutMs ?? 30 * 60 * 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new HarnessError('limits.timeoutMs は正の数である必要があります');
  }
  const base = input.release?.base ?? 'main';
  if (typeof base !== 'string' || !base.trim()) {
    throw new HarnessError('release.base は文字列である必要があります');
  }
  const automation = input.automation === 'attended' ? 'attended' : 'unattended';
  const gateDefault = automation === 'attended';
  const profile = input.testing?.profile;
  if (
    profile != null &&
    !['web-ui', 'library', 'mobile', 'service', 'batch', 'unknown'].includes(profile)
  ) {
    throw new HarnessError(`testing.profile が不明です: ${profile}`);
  }
  const missing = profile ? missingTestingCommands(profile, verify) : [];
  if (missing.length > 0) {
    throw new HarnessError(
      `testing.profile ${profile} に必要な検証コマンドがありません: ${missing.join(', ')}`,
    );
  }
  /** @type {Record<string, unknown>} */
  const manifest = {
    name: input.name.trim(),
    automation,
    model: typeof input.model === 'string' && input.model.trim() ? input.model.trim() : 'composer-2.5',
    specDir: typeof input.specDir === 'string' && input.specDir.trim() ? input.specDir.trim() : 'docs/specs',
    commands: { install, verify },
    release: { base, mode: 'pull-request' },
    gates: {
      afterSpecify: input.gates?.afterSpecify ?? gateDefault,
      beforeRelease: input.gates?.beforeRelease ?? gateDefault,
    },
    limits: {
      verifyRetries: Math.min(MAX_VERIFY_RETRIES, retries),
      timeoutMs,
    },
  };
  if (typeof input.stack === 'string') manifest.stack = input.stack;
  if (profile) manifest.testing = { profile };
  return manifest;
}
