import assert from 'node:assert/strict';
import test from 'node:test';
import { RepairPlan } from '../src/domain/repair-plan.mjs';

test('a lockfile mismatch is repaired before the agent is called', () => {
  const plan = RepairPlan.fromFailure(
    'npm ci',
    'npm ci can only install packages when your package.json and package-lock.json are in sync\nMissing: iconv-lite@0.6.3 from lock file',
  );
  assert.equal(plan?.reason, 'lockfile-sync');
  assert.equal(plan?.repair, 'npm install --package-lock-only');
});

test('an ordinary test failure is not a mechanical repair', () => {
  assert.equal(RepairPlan.fromFailure('npm test', 'AssertionError'), null);
  assert.equal(RepairPlan.fromFailure(['npm', 'ci'], 'Missing: x'), null);
});
