/**
 * エージェントを呼ぶ前に、コマンドだけで直せる失敗。
 */
export class RepairPlan {
  /**
   * @param {string} repair
   * @param {string | string[]} retry
   * @param {string} reason
   */
  constructor(repair, retry, reason) {
    this.repair = repair;
    this.retry = retry;
    this.reason = reason;
  }

  /**
   * @param {string | string[]} command
   * @param {string} output
   * @returns {RepairPlan | null}
   */
  static fromFailure(command, output) {
    if (typeof command !== 'string') return null;
    const text = output ?? '';
    if (command.trim() === 'npm ci' && /package\.json and package-lock\.json/.test(text) && /Missing: /.test(text)) {
      return new RepairPlan('npm install --package-lock-only', 'npm ci', 'lockfile-sync');
    }
    if (/(format:check|prettier --check)/.test(command) && /Code style issues found/.test(text)) {
      return new RepairPlan('npm run format', command, 'format');
    }
    return null;
  }
}
