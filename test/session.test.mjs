import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelRunningRuns, isAgentBusy } from '../src/session.mjs';

test('detects an agent that still has an active run', () => {
  assert.equal(isAgentBusy(new Error('Agent agent-1 already has active run')), true);
  assert.equal(isAgentBusy(new Error('Invalid User API Key')), false);
});

test('cancels only runs that are still running', async () => {
  /** @type {string[]} */
  const cancelled = [];
  const runs = [
    {
      id: 'run-live',
      status: 'running',
      supports: () => true,
      cancel: async () => {
        cancelled.push('run-live');
      },
    },
    { id: 'run-done', status: 'finished' },
  ];
  const ids = await cancelRunningRuns(runs, async (runId) => {
    cancelled.push(runId);
  });
  assert.deepEqual(ids, ['run-live']);
  assert.deepEqual(cancelled, ['run-live']);
});
