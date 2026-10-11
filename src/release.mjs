import { HarnessError } from './errors.mjs';
import { commitTitle } from './text.mjs';

const AUTOMATED_BRANCH = /^(?:dependabot|renovate|snyk|pyup|pre-commit-ci|github-actions)(?:\/|$)/i;

/**
 * Dependabot や Renovate など、ボットが自動で作るブランチ。
 * @param {string} branch
 */
export function isAutomatedBranch(branch) {
  return AUTOMATED_BRANCH.test(String(branch ?? '').trim());
}

/**
 * @param {string} branch
 */
export function assertSafeBranch(branch) {
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

/**
 * @param {string} base
 */
export function assertSafeBase(base) {
  if (typeof base !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(base) || base.includes('..')) {
    throw new HarnessError(`安全でない base ブランチです: ${base}`);
  }
}

/**
 * @param {{ branch: string, base: string, title: string, body: string }} input
 */
export function releaseArgv(input) {
  assertSafeBranch(input.branch);
  assertSafeBase(input.base);
  return {
    status: ['git', 'status', '--porcelain=v1', '--untracked-files=all'],
    checkout: ['git', 'checkout', '-B', input.branch],
    add: ['git', 'add', '-A'],
    cachedNames: ['git', 'diff', '--cached', '--name-only'],
    staged: ['git', 'diff', '--cached', '--quiet'],
    commit: ['git', 'commit', '-F', '-'],
    push: ['git', 'push', '-u', 'origin', input.branch],
    currentBranch: ['git', 'branch', '--show-current'],
    prView: ['gh', 'pr', 'view', input.branch, '--json', 'url,state,number,headRefName'],
    pr: [
      'gh',
      'pr',
      'create',
      '--base',
      input.base,
      '--head',
      input.branch,
      '--title',
      input.title,
      '--body-file',
      '-',
    ],
  };
}

/**
 * @param {{ specPath: string, brief: string }} input
 */
export function releaseBody(input) {
  return ['Open a pull request for review. Do not merge it automatically.', '', `Spec: ${input.specPath}`, ''].join(
    '\n',
  );
}

/**
 * @param {string} branch
 * @param {boolean} [followUp]
 */
export function releaseTitle(branch, followUp = false) {
  const title = commitTitle(branch);
  return followUp ? title.replace(/^feat: /, 'fix: ') : title;
}

/**
 * @param {{ code?: number, stdout?: string }} result
 */
export function openPullRequest(result) {
  if (!result || result.code !== 0) return null;
  try {
    const parsed = JSON.parse(String(result.stdout ?? ''));
    if (parsed?.state !== 'OPEN' || typeof parsed.url !== 'string') return null;
    if (typeof parsed.headRefName === 'string' && !parsed.headRefName.startsWith('harness/')) return null;
    if (isAutomatedBranch(parsed.headRefName)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const SENSITIVE_PATH = [
  /^(?:.*\/)?\.harness(?:\/|$)/,
  /^(?:.*\/)?\.env$/,
  /^(?:.*\/)?\.env\./,
  /^(?:.*\/)?credentials\.json$/,
  /^(?:.*\/)?token\.json$/,
  /^(?:.*\/)?playwright-report(?:\/|$)/,
  /^(?:.*\/)?test-results(?:\/|$)/,
];

/**
 * @param {string[]} names
 */
export function sensitiveCachedPaths(names) {
  return names.filter((name) => SENSITIVE_PATH.some((pattern) => pattern.test(name)));
}
