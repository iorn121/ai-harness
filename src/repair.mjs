/**
 * エージェントを呼ぶ前に、同じ失敗をコマンドだけで直せる場合の手順。
 * 1 コマンドにつき 1 回だけ使う。
 * @param {string | string[]} command
 * @param {string} output
 * @returns {{ repair: string, retry: string | string[], reason: string } | null}
 */
export function planMechanicalRepair(command, output) {
  if (typeof command !== 'string') return null;
  const text = output ?? '';
  if (
    command.trim() === 'npm ci' &&
    /package\.json and package-lock\.json/.test(text) &&
    /Missing: /.test(text)
  ) {
    return {
      repair: 'npm install --package-lock-only',
      retry: 'npm ci',
      reason: 'lockfile-sync',
    };
  }
  if (/(format:check|prettier --check)/.test(command) && /Code style issues found/.test(text)) {
    return {
      repair: 'npm run format',
      retry: command,
      reason: 'format',
    };
  }
  return null;
}
