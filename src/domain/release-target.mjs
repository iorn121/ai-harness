import { HarnessError } from '../errors.mjs';

const AUTOMATED = /^(?:dependabot|renovate|snyk|pyup|pre-commit-ci|github-actions)(?:\/|$)/i;
const SENSITIVE = [
  /^(?:.*\/)?\.harness(?:\/|$)/,
  /^(?:.*\/)?\.env$/,
  /^(?:.*\/)?\.env\./,
  /^(?:.*\/)?credentials\.json$/,
  /^(?:.*\/)?token\.json$/,
  /^(?:.*\/)?playwright-report(?:\/|$)/,
  /^(?:.*\/)?test-results(?:\/|$)/,
];

/** リリースしてよいブランチと、コミットに含めてはいけないパス。 */
export class ReleaseTarget {
  static isAutomated(branch) {
    return AUTOMATED.test(String(branch ?? '').trim());
  }

  static assertBranch(branch) {
    if (
      typeof branch !== 'string' ||
      !branch.startsWith('harness/') ||
      branch === 'harness/' ||
      branch.includes('..') ||
      branch.includes(' ') ||
      branch.startsWith('-') ||
      branch.length > 120
    ) {
      throw new HarnessError(`安全でないブランチ名です: ${branch}`);
    }
    const name = branch.slice('harness/'.length);
    if (name === 'main' || name === 'master') {
      throw new HarnessError(`保護ブランチには push しません: ${branch}`);
    }
  }

  static assertBase(base) {
    if (typeof base !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(base) || base.includes('..')) {
      throw new HarnessError(`安全でない base ブランチです: ${base}`);
    }
  }

  static hiddenPaths(names) {
    return names.filter((name) => SENSITIVE.some((pattern) => pattern.test(name)));
  }
}
