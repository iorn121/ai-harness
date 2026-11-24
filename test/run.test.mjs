import assert from 'node:assert/strict';
import test from 'node:test';
import { Run } from '../src/domain/run.mjs';

const gates = { afterSpecify: true, beforeRelease: true };

test('a new run starts from the specification', () => {
  const decision = new Run(null).decide({ requested: 'all', yes: false, gates, brief: '検索' });
  assert.deepEqual(decision.stages, ['specify', 'implement', 'verify', 'release']);
});

test('a released run stays closed until the brief changes', () => {
  const closed = new Run({ status: 'released', brief: '検索', specPath: 'docs/a.md' }).decide({
    requested: 'all',
    yes: false,
    gates,
    brief: '検索',
  });
  assert.deepEqual(closed.stages, []);

  const followUp = new Run({ status: 'released', brief: '検索' }).decide({
    requested: 'all',
    yes: false,
    gates,
    brief: '並びを変える',
  });
  assert.equal(followUp.followUp, true);
  assert.deepEqual(followUp.stages, ['implement', 'verify', 'release']);
});
