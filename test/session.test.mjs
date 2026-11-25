import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  claudeArgs,
  consumeStreamEvent,
  isResumeFailure,
  loggedInFromStatus,
  normalizeModel,
  sendPrompt,
} from '../src/session.mjs';

test('maps leftover Cursor model ids onto Claude', () => {
  assert.equal(normalizeModel('composer-2.5'), 'sonnet');
  assert.equal(normalizeModel(''), 'sonnet');
  assert.equal(normalizeModel('opus'), 'opus');
});

test('asks Claude to edit the working tree without a prompt', () => {
  const args = claudeArgs({ model: 'composer-2.5', sessionId: 'session-1' });
  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('session-1'));
  assert.ok(args.includes('bypassPermissions'));
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
});

test('detects a session that cannot be resumed', () => {
  assert.equal(isResumeFailure('No conversation found with session ID abc', 1), true);
  assert.equal(isResumeFailure('No conversation found', 0), false);
  assert.equal(isResumeFailure('rate limit', 1), false);
});

test('reads Claude auth status', () => {
  assert.equal(loggedInFromStatus('{"loggedIn":true,"authMethod":"claude.ai"}'), true);
  assert.equal(loggedInFromStatus('{"loggedIn":false}'), false);
});

test('collects assistant text and tool names from a stream event', () => {
  const consumed = consumeStreamEvent({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: '仕様を書きます' },
        { type: 'tool_use', name: 'Write' },
      ],
    },
  });
  assert.deepEqual(consumed.texts, ['仕様を書きます']);
  assert.deepEqual(consumed.tools, ['Write']);
  assert.equal(consumed.result, null);
});

test('returns a finished run and the Claude session id', async () => {
  const result = await sendPrompt({
    prompt: '仕様を書いて',
    cwd: '/tmp/product',
    model: 'sonnet',
    timeoutMs: 1000,
    bin: 'claude',
    onText() {},
    onTool() {},
    spawn: fakeSpawn((child) => {
      child.stdout.emit(
        'data',
        `${JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: '書きました' }] },
        })}\n`,
      );
      child.stdout.emit(
        'data',
        `${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '書きました',
          session_id: 'session-9',
        })}\n`,
      );
      child.emit('close', 0);
    }),
  });
  assert.equal(result.status, 'finished');
  assert.equal(result.text, '書きました');
  assert.equal(result.agentId, 'session-9');
  assert.equal(result.runId, 'session-9');
});

test('starts a new session when the previous one cannot be resumed', async () => {
  /** @type {string[][]} */
  const calls = [];
  const result = await sendPrompt({
    prompt: '続き',
    agentId: 'missing',
    cwd: '/tmp/product',
    model: 'sonnet',
    timeoutMs: 1000,
    bin: 'claude',
    onText() {},
    onTool() {},
    spawn: fakeSpawn((child, args) => {
      calls.push(args);
      if (args.includes('--resume')) {
        child.stderr.emit('data', 'No conversation found with session ID missing\n');
        child.emit('close', 1);
        return;
      }
      child.stdout.emit(
        'data',
        `${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'やり直しました',
          session_id: 'session-new',
        })}\n`,
      );
      child.emit('close', 0);
    }),
  });
  assert.equal(calls.length, 2);
  assert.equal(result.status, 'finished');
  assert.equal(result.agentId, 'session-new');
});

/**
 * @param {(child: EventEmitter & { stdout: EventEmitter, stderr: EventEmitter, stdin: { write: () => void, end: () => void } }, args: string[]) => void} onSpawn
 */
function fakeSpawn(onSpawn) {
  return (_command, args) => {
    const child = /** @type {EventEmitter & { stdout: EventEmitter, stderr: EventEmitter, stdin: { write: () => void, end: () => void }, kill: () => void }} */ (
      new EventEmitter()
    );
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() {} };
    child.kill = () => {};
    queueMicrotask(() => onSpawn(child, args));
    return child;
  };
}
