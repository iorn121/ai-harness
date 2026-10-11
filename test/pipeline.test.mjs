import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDefaults } from '../src/manifest.mjs';
import { runPipeline } from '../src/pipeline.mjs';
import { isAutomatedBranch, openPullRequest, releaseArgv } from '../src/release.mjs';
import { commitTitle, decodeGitPath, englishBranch, parsePorcelain, slugFromBrief, unexpectedSpecChanges } from '../src/text.mjs';

const now = new Date(2026, 9, 4);

/**
 * @param {Record<string, any>} [overrides]
 */
function createHarness(overrides = {}) {
  const files = new Set(overrides.files ?? []);
  /** @type {Array<{ command: string | string[], input?: string }>} */
  const commands = [];
  /** @type {string[]} */
  const prompts = [];
  /** @type {Array<Record<string, any>>} */
  const saved = [];
  let statusCalls = 0;
  const ctx = {
    manifest: applyDefaults({
      name: 'demo',
      commands: { verify: ['npm test'] },
      ...overrides.manifest,
    }),
    state: overrides.state ?? null,
    requested: overrides.requested ?? 'all',
    yes: overrides.yes ?? false,
    brief: overrides.brief ?? '検索を追加する',
    cwd: '/repo',
    now,
    exists: (relativePath) => files.has(relativePath),
    exec: async (command, execOptions) => {
      commands.push({ command, input: execOptions?.input });
      if (overrides.exec) return overrides.exec(command, statusCalls);
      const text = Array.isArray(command) ? command.join(' ') : command;
      if (text.includes('--porcelain')) {
        statusCalls += 1;
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    send: async (prompt) => {
      prompts.push(prompt);
      files.add(overrides.specPath ?? 'docs/specs/20261004-change.md');
      return overrides.sendResult ?? { status: 'finished', text: 'ok', agentId: 'agent-1', runId: 'run-1' };
    },
    save: async (state) => {
      saved.push(structuredClone(state));
    },
  };
  return { ctx, files, commands, prompts, saved };
}

test('slug uses the local date and the brief', () => {
  assert.equal(slugFromBrief('検索を追加する', now), '20261004-change');
  assert.equal(slugFromBrief('Slug: readable-user-memos', now), '20261004-readable-user-memos');
});

test('git octal quotes for a Japanese spec path decode to that path', () => {
  const specPath = 'docs/specs/20261004-比較画面にコントラスト警告を出す.md';
  const quoted = `"${[...Buffer.from(specPath)]
    .map((byte) => (byte < 128 ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, '0')}`))
    .join('')}"`;
  assert.equal(decodeGitPath(quoted), specPath);
  assert.deepEqual(unexpectedSpecChanges(parsePorcelain(`?? ${quoted}`), specPath), []);
});

test('specify stops for human approval', async () => {
  const harness = createHarness({ manifest: { automation: 'attended' } });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 0);
  assert.equal(result.state.status, 'awaiting-approval');
  assert.equal(harness.prompts.length, 1);
  assert.match(harness.prompts[0], /アプリケーションコード、設定、依存関係は変更しないでください/);
  assert.match(harness.prompts[0], /docs\/specs\/20261004-change\.md/);
});

test('specify fails when the agent edits files other than the spec', async () => {
  const harness = createHarness({
    exec: (command) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      if (!text.includes('--porcelain')) return { code: 0, stdout: '', stderr: '' };
      harness.statusCalls = (harness.statusCalls ?? 0) + 1;
      if (harness.statusCalls === 1) return { code: 0, stdout: ' M README.md\n', stderr: '' };
      return { code: 0, stdout: ' M README.md\n M src/app.js\n', stderr: '' };
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /src\/app\.js/);
  assert.equal(result.state.status, 'specify-failed');
});

test('all continues through verify and stops before release when the spec gate is off', async () => {
  const harness = createHarness({
    manifest: { automation: 'attended', gates: { afterSpecify: false } },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 0);
  assert.equal(result.state.status, 'awaiting-release');
  assert.equal(harness.prompts.length, 2);
  assert.equal(
    harness.commands.filter((entry) => entry.command === 'npm test').length,
    1,
  );
});

test('verify refreshes an out-of-sync lockfile without calling the agent', async () => {
  let installs = 0;
  const harness = createHarness({
    requested: 'verify',
    manifest: {
      automation: 'attended',
      commands: { install: 'npm ci', verify: ['npm test'] },
    },
    files: ['docs/specs/20261004-search.md'],
    state: {
      id: '20261004-search',
      agentId: 'agent-1',
      specPath: 'docs/specs/20261004-search.md',
      brief: '検索を追加する',
      status: 'implemented',
      nextStage: 'verify',
      verifyAttempts: 0,
      repairs: [],
      branch: 'harness/20261004-search',
    },
    exec: (command) => {
      if (command === 'npm ci') {
        installs += 1;
        if (installs === 1) {
          return {
            code: 1,
            stdout: '',
            stderr:
              'npm ci can only install packages when your package.json and package-lock.json are in sync\nMissing: iconv-lite@0.6.3 from lock file',
          };
        }
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 0);
  assert.equal(result.state.status, 'verified');
  assert.equal(harness.prompts.length, 0);
  assert.equal(result.state.repairs[0].reason, 'lockfile-sync');
});

test('verify sends the failure back to the agent once and then passes', async () => {
  let tests = 0;
  const harness = createHarness({
    requested: 'verify',
    files: ['docs/specs/20261004-search.md'],
    state: {
      id: '20261004-search',
      agentId: 'agent-1',
      specPath: 'docs/specs/20261004-search.md',
      brief: '検索を追加する',
      status: 'implemented',
      nextStage: 'verify',
      verifyAttempts: 0,
      branch: 'harness/20261004-search',
    },
    exec: (command) => {
      if (command !== 'npm test') return { code: 0, stdout: '', stderr: '' };
      tests += 1;
      if (tests === 1) return { code: 1, stdout: '', stderr: 'expected 1 received 2' };
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 0);
  assert.equal(result.state.status, 'verified');
  assert.equal(harness.prompts.length, 1);
  assert.match(harness.prompts[0], /expected 1 received 2/);
});

test('verify stops after the retry budget is spent', async () => {
  const harness = createHarness({
    requested: 'verify',
    manifest: { limits: { verifyRetries: 1 } },
    files: ['docs/specs/20261004-search.md'],
    state: {
      id: '20261004-search',
      agentId: 'agent-1',
      specPath: 'docs/specs/20261004-search.md',
      brief: '検索を追加する',
      status: 'implemented',
      nextStage: 'verify',
      verifyAttempts: 0,
      branch: 'harness/20261004-search',
    },
    exec: (command) => {
      if (command === 'npm test') return { code: 1, stdout: '', stderr: 'still failing' };
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 2);
  assert.equal(result.state.status, 'verify-failed');
  assert.equal(harness.prompts.length, 1);
});

test('release pushes a harness branch and never main', async () => {
  const harness = createHarness({
    requested: 'release',
    files: ['docs/specs/20261004-search.md'],
    state: {
      id: '20261004-search',
      agentId: 'agent-1',
      specPath: 'docs/specs/20261004-search.md',
      brief: '検索を追加する',
      status: 'verified',
      nextStage: 'release',
      verifyAttempts: 0,
      branch: 'harness/20261004-search',
    },
    exec: (command) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      if (text.includes('--porcelain')) return { code: 0, stdout: ' M README.md\n', stderr: '' };
      if (text.startsWith('git diff --cached --quiet')) return { code: 1, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 0);
  assert.equal(result.state.status, 'released');
  const push = harness.commands.find(
    (entry) => Array.isArray(entry.command) && entry.command[0] === 'git' && entry.command[1] === 'push',
  );
  assert.deepEqual(push?.command, ['git', 'push', '-u', 'origin', 'harness/20261004-search']);
  const add = harness.commands.find(
    (entry) => Array.isArray(entry.command) && entry.command[1] === 'add',
  );
  assert.deepEqual(add?.command, ['git', 'add', '-A']);
  assert.equal(commitTitle('harness/20261004-readable-user-memos'), 'feat: readable user memos');
});

test('release rejects an empty worktree', async () => {
  const harness = createHarness({
    requested: 'release',
    state: {
      id: '20261004-search',
      agentId: 'agent-1',
      specPath: 'docs/specs/20261004-search.md',
      brief: '検索を追加する',
      status: 'verified',
      nextStage: 'release',
      verifyAttempts: 0,
      branch: 'harness/20261004-search',
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /変更がありません/);
});

test('a later brief keeps the branch and updates the open pull request', async () => {
  const harness = createHarness({
    brief: 'メモの余白を広げる',
    files: ['docs/specs/20261004-search.md'],
    state: {
      id: '20261004-search',
      agentId: 'agent-1',
      specPath: 'docs/specs/20261004-search.md',
      brief: '検索を追加する',
      status: 'released',
      nextStage: 'done',
      verifyAttempts: 0,
      branch: 'harness/20261004-search',
    },
    exec: (command) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      if (text.includes('--porcelain')) return { code: 0, stdout: ' M README.md\n', stderr: '' };
      if (text.startsWith('git diff --cached --quiet')) return { code: 1, stdout: '', stderr: '' };
      if (text.startsWith('gh pr view')) {
        return {
          code: 0,
          stdout: '{"url":"https://github.com/example/repo/pull/1","state":"OPEN","number":1}\n',
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 0);
  assert.equal(result.state.status, 'released');
  assert.equal(result.state.branch, 'harness/20261004-search');
  assert.match(result.message, /既存の Pull Request を更新しました: https:\/\/github.com\/example\/repo\/pull\/1/);
  assert.match(harness.prompts[0], /追加要望/);
  assert.match(harness.prompts[0], /メモの余白を広げる/);
  const created = harness.commands.find(
    (entry) => Array.isArray(entry.command) && entry.command[0] === 'gh' && entry.command[2] === 'create',
  );
  assert.equal(created, undefined);
  const commit = harness.commands.find(
    (entry) => Array.isArray(entry.command) && entry.command[1] === 'commit',
  );
  assert.match(commit?.input ?? '', /^fix: search/);
});

test('a verified run with a new brief continues through push', async () => {
  const harness = createHarness({
    brief: '余白を広げる',
    files: ['docs/specs/20261004-search.md'],
    state: {
      id: '20261004-search',
      agentId: 'agent-1',
      specPath: 'docs/specs/20261004-search.md',
      brief: '検索を追加する',
      status: 'verified',
      nextStage: 'release',
      verifyAttempts: 0,
      branch: 'harness/20261004-search',
    },
    exec: (command) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      if (text.includes('--porcelain')) return { code: 0, stdout: ' M README.md\n', stderr: '' };
      if (text.startsWith('git diff --cached --quiet')) return { code: 1, stdout: '', stderr: '' };
      if (text.startsWith('gh pr view')) {
        return {
          code: 0,
          stdout: '{"url":"https://github.com/example/repo/pull/9","state":"OPEN","number":9}\n',
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 0);
  assert.match(harness.prompts[0], /余白を広げる/);
  assert.equal(
    harness.commands.filter((entry) => entry.command === 'npm test').length,
    1,
  );
  assert.match(result.message, /既存の Pull Request を更新しました/);
});

test('a released run without a new brief stays on the existing pull request', async () => {
  const harness = createHarness({
    brief: '',
    state: {
      id: '20261004-search',
      agentId: 'agent-1',
      specPath: 'docs/specs/20261004-search.md',
      brief: '検索を追加する',
      status: 'released',
      nextStage: 'done',
      branch: 'harness/20261004-search',
    },
  });
  const result = await runPipeline(harness.ctx);
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /同じ Pull Request に足すには/);
  assert.equal(harness.prompts.length, 0);
  assert.deepEqual(harness.commands.map((entry) => entry.command), [['git', 'branch', '--show-current']]);
});

test('english branch stays on the existing slug across days', () => {
  const later = new Date(2026, 9, 6);
  assert.equal(
    englishBranch('Slug: readable-user-memos\n', 'harness/20261005-readable-user-memos', later),
    'harness/20261005-readable-user-memos',
  );
  assert.equal(
    englishBranch('Slug: readable-user-memos\n', 'harness/20261005-change', later),
    'harness/20261006-readable-user-memos',
  );
});

test('an automated branch stops the harness before any stage', async () => {
  const harness = createHarness({
    exec: (command) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      if (text === 'git branch --show-current') {
        return { code: 0, stdout: 'dependabot/npm_and_yarn/vite-8.3.2\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  await assert.rejects(() => runPipeline(harness.ctx), /自動で作られたブランチではハーネスを動かしません/);
  assert.equal(harness.prompts.length, 0);
});

test('an automated pull request is not treated as the harness pull request', () => {
  assert.equal(isAutomatedBranch('dependabot/github_actions/actions/checkout-7'), true);
  assert.equal(isAutomatedBranch('renovate/npm-vite'), true);
  assert.equal(isAutomatedBranch('harness/20261004-search'), false);
  assert.equal(
    openPullRequest({
      code: 0,
      stdout: JSON.stringify({
        url: 'https://github.com/example/repo/pull/4',
        state: 'OPEN',
        number: 4,
        headRefName: 'dependabot/npm_and_yarn/vite-8.3.2',
      }),
    }),
    null,
  );
});

test('release refuses to target main', () => {
  assert.throws(() => releaseArgv({
    branch: 'main',
    base: 'main',
    title: 'harness: test',
    body: 'body',
  }), /安全でないブランチ名/);
});
