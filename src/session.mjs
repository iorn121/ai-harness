import { EventEmitter, setMaxListeners } from 'node:events';
import { HarnessError } from './errors.mjs';

setMaxListeners(32);
EventEmitter.defaultMaxListeners = 32;

/**
 * @param {import('@cursor/sdk').Run} run
 */
async function streamRun(run) {
  for await (const event of run.stream()) {
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'text') process.stdout.write(block.text);
        else if (block.type === 'tool_use') process.stderr.write(`\n[tool] ${block.name}\n`);
      }
    } else if (event.type === 'tool_call') {
      process.stderr.write(`\n[tool_call] ${event.name} (${event.status})\n`);
    } else if (event.type === 'status') {
      process.stderr.write(`\n[status] ${event.status}${event.message ? ` ${event.message}` : ''}\n`);
    }
  }
}

/**
 * @param {import('@cursor/sdk').Run} run
 * @param {number} timeoutMs
 */
async function runWithTimeout(run, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new HarnessError(`エージェントが ${timeoutMs}ms で時間切れになりました。`, 2));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      (async () => {
        await streamRun(run);
        return await run.wait();
      })(),
      timeout,
    ]);
    return result;
  } catch (error) {
    if (run.supports('cancel')) await run.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * @param {{ [Symbol.asyncDispose](): Promise<void> }} agent
 */
async function disposeAgent(agent) {
  const ms = 30_000;
  try {
    await Promise.race([
      agent[Symbol.asyncDispose](),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`dispose timed out after ${ms}ms`)), ms);
      }),
    ]);
  } catch (error) {
    console.error('[dispose]', error instanceof Error ? error.message : error);
  }
}

/**
 * @param {unknown} error
 */
export function isAgentBusy(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /already has active run/i.test(message);
}

/**
 * @param {Array<{ id: string, status?: string, supports?: (op: string) => boolean, cancel?: () => Promise<void> }>} runs
 * @param {(runId: string) => Promise<void>} cancelRun
 */
export async function cancelRunningRuns(runs, cancelRun) {
  /** @type {string[]} */
  const cancelled = [];
  for (const run of runs) {
    if (run.status !== 'running') continue;
    if (typeof run.cancel === 'function' && run.supports?.('cancel') !== false) await run.cancel();
    else await cancelRun(run.id);
    cancelled.push(run.id);
  }
  return cancelled;
}

/**
 * @param {{ prompt: string, agentId?: string | null, cwd: string, model: string, apiKey: string, timeoutMs: number }} input
 */
export async function sendPrompt(input) {
  const { Agent, CursorAgentError } = await import('@cursor/sdk');
  const local = { cwd: input.cwd, settingSources: /** @type {const} */ (['project']) };
  /** @type {{ agentId: string, send: (prompt: string) => Promise<import('@cursor/sdk').Run>, [Symbol.asyncDispose](): Promise<void> }} */
  let agent;
  try {
    agent = input.agentId
      ? await Agent.resume(input.agentId, {
          apiKey: input.apiKey,
          model: { id: input.model },
          local,
        })
      : await Agent.create({
          apiKey: input.apiKey,
          model: { id: input.model },
          name: 'ai-harness',
          local,
        });
    console.error(`[harness] agent ${agent.agentId}`);
    try {
      const run = await sendOrReplaceBusyAgent(Agent, agent, input, local);
      agent = run.agent;
      console.error(`[harness] run ${run.run.id}`);
      const result = await runWithTimeout(run.run, input.timeoutMs);
      return {
        status: result.status,
        text: result.result ?? '',
        agentId: agent.agentId,
        runId: run.run.id,
      };
    } finally {
      await disposeAgent(agent);
    }
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    if (error instanceof CursorAgentError) {
      throw new HarnessError(
        `エージェントを起動できませんでした: ${error.message} (retryable=${error.isRetryable})`,
        1,
      );
    }
    throw error;
  }
}

/**
 * @param {typeof import('@cursor/sdk').Agent} Agent
 * @param {{ agentId: string, send: (prompt: string) => Promise<import('@cursor/sdk').Run>, [Symbol.asyncDispose](): Promise<void> }} agent
 * @param {{ prompt: string, cwd: string, model: string, apiKey: string }} input
 * @param {{ cwd: string, settingSources: readonly ['project'] }} local
 */
async function sendOrReplaceBusyAgent(Agent, agent, input, local) {
  try {
    return { agent, run: await agent.send(input.prompt) };
  } catch (error) {
    if (!isAgentBusy(error)) throw error;
    const listed = await Agent.listRuns(agent.agentId, { runtime: 'local', cwd: input.cwd });
    const cancelled = await cancelRunningRuns(listed.items, (runId) =>
      Agent.cancelRun(runId, { runtime: 'local', cwd: input.cwd }),
    );
    console.error(`[harness] cancelled active run: ${cancelled.join(', ') || '(none)'}`);
    try {
      return { agent, run: await agent.send(input.prompt) };
    } catch (again) {
      if (!isAgentBusy(again)) throw again;
      console.error('[harness] agent still busy, starting a new agent');
      await disposeAgent(agent);
      const created = await Agent.create({
        apiKey: input.apiKey,
        model: { id: input.model },
        name: 'ai-harness',
        local,
      });
      console.error(`[harness] agent ${created.agentId}`);
      return { agent: created, run: await created.send(input.prompt) };
    }
  }
}
