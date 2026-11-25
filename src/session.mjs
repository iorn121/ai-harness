import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HarnessError } from './errors.mjs';

export const DEFAULT_MODEL = 'sonnet';

/**
 * Cursor のモデル名が残っていても Claude Code が受け取れる別名にする。
 * @param {string | null | undefined} model
 */
export function normalizeModel(model) {
  const value = String(model ?? '').trim();
  if (!value || value.startsWith('composer')) return DEFAULT_MODEL;
  return value;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveClaudeBin(env = process.env) {
  const configured = env.CLAUDE_BIN?.trim();
  if (configured) return configured;
  const directories = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    const candidate = path.join(directory, 'claude');
    if (existsSync(candidate)) return candidate;
  }
  const home = env.HOME || os.homedir();
  for (const candidate of [
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return 'claude';
}

/**
 * @param {{ model?: string, sessionId?: string | null }} input
 */
export function claudeArgs(input) {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--dangerously-skip-permissions',
    '--model',
    normalizeModel(input.model),
    '--name',
    'ai-harness',
    '--setting-sources',
    'project',
  ];
  if (input.sessionId) args.push('--resume', input.sessionId);
  return args;
}

/**
 * @param {string} output
 * @param {number | null} code
 */
export function isResumeFailure(output, code) {
  if (code === 0) return false;
  return /no conversation found|session not found|invalid session|could not resume/i.test(output);
}

/**
 * @param {string} stdout
 */
export function loggedInFromStatus(stdout) {
  try {
    return JSON.parse(stdout).loggedIn === true;
  } catch {
    return /"loggedIn"\s*:\s*true/.test(stdout);
  }
}

/**
 * @param {Record<string, any>} event
 */
export function consumeStreamEvent(event) {
  /** @type {string[]} */
  const texts = [];
  /** @type {string[]} */
  const tools = [];
  if (event?.type === 'assistant') {
    for (const block of event.message?.content ?? []) {
      if (block?.type === 'text' && block.text) texts.push(block.text);
      else if (block?.type === 'tool_use' && block.name) tools.push(block.name);
    }
  }
  return {
    texts,
    tools,
    result: event?.type === 'result' ? event : null,
  };
}

/**
 * @param {{ bin?: string, env?: NodeJS.ProcessEnv, spawn?: typeof spawn }} [options]
 */
export function claudeLoggedIn(options = {}) {
  const spawnImpl = options.spawn ?? spawn;
  const bin = options.bin ?? resolveClaudeBin(options.env ?? process.env);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(bin, ['auth', 'status'], {
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', (error) => {
      if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
        reject(new HarnessError('claude コマンドが見つかりません。Claude Code をインストールし、PATH に通してください。', 1));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      resolve(code === 0 && loggedInFromStatus(stdout));
    });
  });
}

/**
 * @param {{ prompt: string, agentId?: string | null, cwd: string, model: string, timeoutMs: number, env?: NodeJS.ProcessEnv, bin?: string, spawn?: typeof spawn, onText?: (text: string) => void, onTool?: (name: string) => void }} input
 */
export async function sendPrompt(input) {
  const first = await runClaudeOnce(input);
  if (first.resumeFailed) {
    console.error('[harness] session resume failed, starting a new session');
    const retry = await runClaudeOnce({ ...input, agentId: null });
    return toResult(retry);
  }
  return toResult(first);
}

/**
 * @param {{ status: string, text: string, agentId: string | null, runId: string | null }} outcome
 */
/**
 * @param {NodeJS.ProcessEnv | Record<string, string> | undefined} env
 */
function definedEnv(env) {
  return Object.fromEntries(Object.entries(env ?? {}).filter(([, value]) => Boolean(value)));
}

function toResult(outcome) {
  return {
    status: outcome.status,
    text: outcome.text,
    agentId: outcome.agentId,
    runId: outcome.runId,
  };
}

/**
 * @param {{ prompt: string, agentId?: string | null, cwd: string, model: string, timeoutMs: number, env?: NodeJS.ProcessEnv, bin?: string, spawn?: typeof spawn, onText?: (text: string) => void, onTool?: (name: string) => void }} input
 */
function runClaudeOnce(input) {
  const spawnImpl = input.spawn ?? spawn;
  const bin = input.bin ?? resolveClaudeBin(input.env ?? process.env);
  const args = claudeArgs({ model: input.model, sessionId: input.agentId });
  const onText = input.onText ?? ((text) => process.stdout.write(text));
  const onTool = input.onTool ?? ((name) => process.stderr.write(`\n[tool] ${name}\n`));

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(bin, args, {
        cwd: input.cwd,
        env: { ...process.env, ...definedEnv(input.env) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let stdout = '';
    let stderr = '';
    /** @type {Record<string, any> | null} */
    let resultEvent = null;
    let lineBuffer = '';

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => {
        reject(new HarnessError(`エージェントが ${input.timeoutMs}ms で時間切れになりました。`, 2));
      });
    }, input.timeoutMs);

    const takeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return;
      }
      const consumed = consumeStreamEvent(event);
      for (const text of consumed.texts) onText(text);
      for (const name of consumed.tools) onTool(name);
      if (consumed.result) resultEvent = consumed.result;
    };

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) takeLine(line);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      finish(() => {
        if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
          reject(new HarnessError('claude コマンドが見つかりません。Claude Code をインストールし、PATH に通してください。', 1));
          return;
        }
        reject(error);
      });
    });
    child.on('close', (code) => {
      if (lineBuffer) takeLine(lineBuffer);
      const output = `${stderr}\n${stdout}`;
      finish(() => {
        if (input.agentId && isResumeFailure(output, code)) {
          resolve({
            resumeFailed: true,
            status: 'error',
            text: '',
            agentId: null,
            runId: null,
          });
          return;
        }
        const failed = code !== 0 || resultEvent?.is_error === true || resultEvent?.subtype === 'error';
        console.error(`[harness] claude exit ${code ?? 'null'}`);
        resolve({
          resumeFailed: false,
          status: failed ? 'error' : 'finished',
          text: typeof resultEvent?.result === 'string' ? resultEvent.result : '',
          agentId: resultEvent?.session_id ?? input.agentId ?? null,
          runId: resultEvent?.session_id ?? null,
        });
      });
    });

    child.stdin?.write(input.prompt);
    child.stdin?.end();
  });
}
