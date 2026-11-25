import assert from 'node:assert/strict';
import test from 'node:test';
import { credentialsFromEnvFile, resolveCredentials } from '../src/api-key.mjs';
import { inspectProduct } from '../src/doctor.mjs';
import { planMechanicalRepair } from '../src/repair.mjs';
import { renderRunReport } from '../src/report.mjs';

test('reads Claude credentials from the home env file', () => {
  assert.deepEqual(credentialsFromEnvFile("ANTHROPIC_API_KEY='claude_test'\n"), {
    ANTHROPIC_API_KEY: 'claude_test',
  });
  assert.equal(
    resolveCredentials({ env: {}, fileText: 'CLAUDE_CODE_OAUTH_TOKEN=from-file\n' }).CLAUDE_CODE_OAUTH_TOKEN,
    'from-file',
  );
  assert.equal(
    resolveCredentials({
      env: { ANTHROPIC_API_KEY: 'from-env' },
      fileText: 'ANTHROPIC_API_KEY=from-file\n',
    }).ANTHROPIC_API_KEY,
    'from-env',
  );
});

test('plans a lockfile refresh when npm ci reports missing packages', () => {
  const plan = planMechanicalRepair(
    'npm ci',
    'npm ci can only install packages when your package.json and package-lock.json are in sync\nMissing: iconv-lite@0.6.3 from lock file',
  );
  assert.equal(plan?.repair, 'npm install --package-lock-only');
  assert.equal(plan?.retry, 'npm ci');
});

test('plans prettier when format check fails', () => {
  const plan = planMechanicalRepair(
    'npm run format:check',
    'Code style issues found in 2 files. Run Prettier with --write to fix.',
  );
  assert.equal(plan?.reason, 'format');
  assert.equal(plan?.repair, 'npm run format');
});

test('does not repair an ordinary test failure', () => {
  assert.equal(planMechanicalRepair('npm test', 'expected 1 received 2'), null);
});

test('renders a run report with repairs', () => {
  const report = renderRunReport({
    name: 'color-verse',
    status: 'verified',
    nextStage: 'release',
    specPath: 'docs/specs/example.md',
    message: 'テストは通過しました。',
    repairs: [{ command: 'npm ci', repair: 'npm install --package-lock-only', reason: 'lockfile-sync', code: 0 }],
  });
  assert.match(report, /lockfile-sync/);
  assert.match(report, /verified/);
});

test('doctor lists missing web-ui scripts', () => {
  const finding = inspectProduct({
    id: 'demo',
    hasHarness: true,
    profile: 'web-ui',
    scripts: { build: 'vite build' },
  });
  assert.deepEqual(finding.gaps, ['npm script test:unit がありません', 'npm script test:e2e がありません']);
});
