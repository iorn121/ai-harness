import assert from 'node:assert/strict';
import test from 'node:test';
import { detectFromTree } from '../src/detect.mjs';
import { mergeGitignore } from '../src/gitignore.mjs';
import { applyDefaults, MAX_VERIFY_RETRIES } from '../src/manifest.mjs';

test('detects node scripts and skips the placeholder test', () => {
  const detected = detectFromTree({
    'package.json': JSON.stringify({
      scripts: {
        check: 'npm run lint && npm run typecheck',
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        test: 'echo "Error: no test specified" && exit 1',
        build: 'vite build',
      },
    }),
    'package-lock.json': '',
  });
  assert.equal(detected.stack, 'node');
  assert.deepEqual(detected.commands, {
    install: 'npm ci',
    verify: ['npm run check', 'npm run build'],
  });
});

test('detects flutter, python, and go', () => {
  assert.equal(detectFromTree({ 'pubspec.yaml': 'name: app\n' }).stack, 'flutter');
  assert.deepEqual(detectFromTree({ 'requirements.txt': 'pytest\n', 'tests/': '' }).commands.verify, [
    'python -m pytest',
  ]);
  assert.deepEqual(detectFromTree({ 'go.mod': 'module example.com/app\n' }).commands.verify, ['go test ./...']);
});

test('web UI projects require unit tests, build, and Playwright', () => {
  const detected = detectFromTree({
    'package.json': JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
      scripts: { check: 'npm run lint', build: 'vite build' },
    }),
    'package-lock.json': '',
  });
  assert.equal(detected.profile, 'web-ui');
  assert.deepEqual(detected.commands.verify, [
    'npm run check',
    'npm run test:unit',
    'npm run build',
    'npm run test:e2e',
  ]);
});

test('node package.json wins when several stacks are present', () => {
  const detected = detectFromTree({
    'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
    'pubspec.yaml': 'name: app\n',
  });
  assert.equal(detected.stack, 'node');
});

test('rejects a release mode that would merge', () => {
  assert.throws(
    () => applyDefaults({ name: 'demo', release: { mode: 'merge' } }),
    /pull-request/,
  );
});

test('caps verify retries', () => {
  const manifest = applyDefaults({
    name: 'demo',
    commands: { verify: ['npm test'] },
    limits: { verifyRetries: 99 },
  });
  assert.equal(manifest.limits.verifyRetries, MAX_VERIFY_RETRIES);
});

test('adds the harness state directory to gitignore once', () => {
  assert.equal(mergeGitignore(''), '.harness/\n');
  assert.equal(mergeGitignore('node_modules\n'), 'node_modules\n.harness/\n');
  assert.equal(mergeGitignore('node_modules\n.harness/\n'), 'node_modules\n.harness/\n');
});
