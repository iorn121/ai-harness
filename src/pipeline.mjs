import { HarnessError } from './errors.mjs';
import { implementPrompt, specifyPrompt, verifyFixPrompt } from './prompts.mjs';
import { planMechanicalRepair } from './repair.mjs';
import {
  isAutomatedBranch,
  openPullRequest,
  releaseArgv,
  releaseBody,
  releaseTitle,
  sensitiveCachedPaths,
} from './release.mjs';
import { englishBranch, parsePorcelain, slugFromBrief, specRelativePath, unexpectedSpecChanges } from './text.mjs';

const ORDER = ['specify', 'implement', 'verify', 'release'];
const VERIFIED = new Set(['verified', 'awaiting-release']);

/**
 * @param {{ requested: string, state: Record<string, any> | null, yes: boolean, gates: { afterSpecify: boolean, beforeRelease: boolean }, brief?: string }} input
 */
export function selectStages(input) {
  if (input.requested !== 'all') return { stages: [input.requested], message: null, followUp: false };
  const state = input.state;
  const brief = String(input.brief ?? '').trim();
  const openForFollowUp = new Set(['released', 'pushed', 'verified', 'awaiting-release', 'release-failed']);
  if (brief && brief !== String(state?.brief ?? '').trim() && openForFollowUp.has(state?.status)) {
    return { stages: ['implement', 'verify', 'release'], message: null, followUp: true };
  }
  if (state?.status === 'released') {
    return {
      stages: [],
      followUp: false,
      message:
        'このランはリリース済みです。同じ Pull Request に足すには、--brief を付けて harness run を実行してください。',
    };
  }
  if (state?.status === 'awaiting-approval' && !input.yes) {
    return {
      stages: [],
      followUp: false,
      message: `仕様を確認してください: ${state.specPath}\n続けるには harness run --stage implement`,
    };
  }
  if (state && VERIFIED.has(state.status) && !input.yes && input.gates.beforeRelease) {
    return {
      stages: [],
      followUp: false,
      message: 'テストは通過しています。Pull Request を作るには harness run --stage release',
    };
  }
  if (!state) return { stages: [...ORDER], message: null, followUp: false };
  const index = ORDER.indexOf(state.nextStage ?? 'specify');
  return { stages: index === -1 ? [...ORDER] : ORDER.slice(index), message: null, followUp: false };
}

/**
 * @param {Record<string, any>} ctx
 */
export async function runPipeline(ctx) {
  const current = await ctx.exec(['git', 'branch', '--show-current'], { cwd: ctx.cwd });
  const currentBranch = String(current.stdout ?? '').trim();
  if (current.code === 0 && isAutomatedBranch(currentBranch)) {
    throw new HarnessError(`自動で作られたブランチではハーネスを動かしません: ${currentBranch}`);
  }

  let state = ctx.state ? { ...ctx.state } : null;
  if (ctx.requested === 'specify' || (ctx.requested === 'all' && !state)) {
    state = createRun(ctx);
  }
  if (!state) {
    throw new HarnessError('進行中のランがありません。先に harness run --stage specify を実行してください。');
  }

  const selected = selectStages({
    requested: ctx.requested,
    state: ctx.requested === 'specify' ? { ...state, status: 'created', nextStage: 'specify' } : state,
    yes: ctx.yes,
    gates: ctx.manifest.gates,
    brief: ctx.brief,
  });
  if (selected.followUp) {
    state.brief = String(ctx.brief).trim();
    state.followUps = [...(Array.isArray(state.followUps) ? state.followUps : []), state.brief];
    state.followUp = true;
  }
  if (selected.stages.length === 0) {
    return { exitCode: 0, message: selected.message ?? '', state };
  }

  for (const stage of selected.stages) {
    if (stage === 'specify') {
      const outcome = await runSpecify(ctx, state);
      state = outcome.state;
      await ctx.save(state);
      if (outcome.stop) return { exitCode: outcome.exitCode, message: outcome.message, state };
      if (ctx.requested === 'all' && ctx.manifest.gates.afterSpecify && !ctx.yes) {
        state.status = 'awaiting-approval';
        state.nextStage = 'implement';
        await ctx.save(state);
        return {
          exitCode: 0,
          message: `仕様を書きました: ${state.specPath}\n確認してから harness run --stage implement`,
          state,
        };
      }
      state.status = 'specified';
      state.nextStage = 'implement';
      await ctx.save(state);
    }

    if (stage === 'implement') {
      const outcome = await runImplement(ctx, state);
      state = outcome.state;
      await ctx.save(state);
      if (outcome.stop) return { exitCode: outcome.exitCode, message: outcome.message, state };
    }

    if (stage === 'verify') {
      const outcome = await runVerify(ctx, state);
      state = outcome.state;
      await ctx.save(state);
      if (outcome.stop) return { exitCode: outcome.exitCode, message: outcome.message, state };
      if (ctx.requested === 'all' && ctx.manifest.gates.beforeRelease && !ctx.yes) {
        state.status = 'awaiting-release';
        state.nextStage = 'release';
        await ctx.save(state);
        return {
          exitCode: 0,
          message: 'テストは通過しました。Pull Request を作るには harness run --stage release',
          state,
        };
      }
      state.status = 'verified';
      state.nextStage = 'release';
      await ctx.save(state);
    }

    if (stage === 'release') {
      if (!VERIFIED.has(state.status) && state.status !== 'release-failed' && state.status !== 'pushed') {
        throw new HarnessError('release の前に verify を通過してください。');
      }
      const outcome = await runRelease(ctx, state);
      state = outcome.state;
      await ctx.save(state);
      return { exitCode: outcome.exitCode, message: outcome.message, state };
    }
  }

  const last = selected.stages[selected.stages.length - 1];
  if (last === 'implement') {
    return { exitCode: 0, message: '実装しました。次は harness run --stage verify', state };
  }
  if (last === 'verify') {
    return {
      exitCode: 0,
      message: 'テストは通過しました。Pull Request を作るには harness run --stage release',
      state,
    };
  }
  return { exitCode: 0, message: `停止しました。状態: ${state.status}`, state };
}

/**
 * @param {Record<string, any>} ctx
 */
function createRun(ctx) {
  if (!String(ctx.brief ?? '').trim()) {
    throw new HarnessError('specify には --brief または --brief-file が必要です');
  }
  const slug = slugFromBrief(ctx.brief, ctx.now);
  return {
    id: slug,
    agentId: null,
    specPath: specRelativePath(ctx.manifest.specDir, slug),
    brief: ctx.brief.trim(),
    status: 'created',
    nextStage: 'specify',
    verifyAttempts: 0,
    repairs: [],
    branch: `harness/${slug}`,
    updatedAt: ctx.now.toISOString(),
  };
}

/**
 * @param {Record<string, any>} ctx
 * @param {Record<string, any>} state
 */
async function runSpecify(ctx, state) {
  const statusArgv = ['git', '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all'];
  const before = await ctx.exec(statusArgv, { cwd: ctx.cwd });
  const beforePaths = new Set(before.code === 0 ? parsePorcelain(before.stdout) : []);
  const sent = await ctx.send(
    specifyPrompt({
      brief: state.brief,
      specPath: state.specPath,
      product: ctx.manifest.name,
    }),
    { agentId: state.agentId },
  );
  state.agentId = sent.agentId;
  state.updatedAt = ctx.now.toISOString();
  if (sent.status !== 'finished') {
    state.status = 'specify-failed';
    return { state, stop: true, exitCode: 2, message: '要件定義のエージェントが失敗しました。' };
  }
  if (!ctx.exists(state.specPath)) {
    state.status = 'specify-failed';
    return {
      state,
      stop: true,
      exitCode: 2,
      message: `仕様書が作成されていません: ${state.specPath}`,
    };
  }
  const status = await ctx.exec(statusArgv, { cwd: ctx.cwd });
  if (status.code === 0) {
    const extra = unexpectedSpecChanges(parsePorcelain(status.stdout), state.specPath).filter(
      (filePath) => !beforePaths.has(filePath),
    );
    if (extra.length > 0) {
      state.status = 'specify-failed';
      return {
        state,
        stop: true,
        exitCode: 2,
        message: `要件定義で仕様書以外が変更されています: ${extra.join(', ')}`,
      };
    }
  }
  return { state, stop: false, exitCode: 0, message: '' };
}

/**
 * @param {Record<string, any>} ctx
 * @param {Record<string, any>} state
 */
async function runImplement(ctx, state) {
  if (!state.specPath || !ctx.exists(state.specPath)) {
    throw new HarnessError(`仕様書がありません: ${state.specPath ?? '(未設定)'}`);
  }
  const sent = await ctx.send(
    implementPrompt({
      brief: state.brief,
      specPath: state.specPath,
      product: ctx.manifest.name,
      followUp: state.followUp === true,
    }),
    { agentId: state.agentId },
  );
  state.agentId = sent.agentId;
  state.updatedAt = ctx.now.toISOString();
  if (sent.status !== 'finished') {
    state.status = 'implement-failed';
    state.nextStage = 'implement';
    return { state, stop: true, exitCode: 2, message: '実装のエージェントが失敗しました。' };
  }
  state.status = 'implemented';
  state.nextStage = 'verify';
  return { state, stop: false, exitCode: 0, message: '' };
}

/**
 * @param {Record<string, any>} ctx
 * @param {Record<string, any>} state
 */
async function runVerify(ctx, state) {
  const commands = ctx.manifest.commands.verify;
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new HarnessError('commands.verify が空です。harness.json に検証コマンドを書いてください。');
  }
  if (!Array.isArray(state.repairs)) state.repairs = [];
  if (ctx.manifest.commands.install) {
    const installed = await runCommandWithRepair(ctx, state, ctx.manifest.commands.install);
    if (installed.result.code !== 0) {
      state.status = 'verify-failed';
      return {
        state,
        stop: true,
        exitCode: 2,
        message: `インストールに失敗しました: ${ctx.manifest.commands.install}`,
      };
    }
  }

  const limit = ctx.manifest.limits.verifyRetries;
  let fixes = 0;
  while (true) {
    /** @type {{ command: string, code: number, stdout: string, stderr: string } | null} */
    let failed = null;
    for (const command of commands) {
      const executed = await runCommandWithRepair(ctx, state, command);
      if (executed.result.code !== 0) {
        failed = { command, ...executed.result };
        break;
      }
    }
    if (!failed) {
      state.verifyAttempts = fixes;
      return { state, stop: false, exitCode: 0, message: '' };
    }
    if (fixes >= limit) {
      state.status = 'verify-failed';
      state.verifyAttempts = fixes;
      return {
        state,
        stop: true,
        exitCode: 2,
        message: `検証に失敗しました: ${failed.command}`,
      };
    }
    fixes += 1;
    state.verifyAttempts = fixes;
    const output = `${failed.stdout}\n${failed.stderr}`.trim().slice(-8000);
    const sent = await ctx.send(
      verifyFixPrompt({ command: failed.command, output, attempt: fixes, limit }),
      { agentId: state.agentId },
    );
    state.agentId = sent.agentId;
    if (sent.status !== 'finished') {
      state.status = 'verify-failed';
      return { state, stop: true, exitCode: 2, message: '検証失敗の修正エージェントが失敗しました。' };
    }
  }
}

/**
 * 失敗が整形ずれや lock の不一致なら、エージェントの前に 1 回だけ直して同じコマンドを再実行する。
 * @param {Record<string, any>} ctx
 * @param {Record<string, any>} state
 * @param {string | string[]} command
 */
async function runCommandWithRepair(ctx, state, command) {
  let result = await ctx.exec(command, { cwd: ctx.cwd });
  if (result.code === 0) return { result };
  const plan = planMechanicalRepair(command, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (!plan || state.repairs.some((repair) => repair.command === command && repair.reason === plan.reason)) {
    return { result };
  }
  const repaired = await ctx.exec(plan.repair, { cwd: ctx.cwd });
  state.repairs.push({
    command: typeof command === 'string' ? command : command.join(' '),
    repair: plan.repair,
    reason: plan.reason,
    code: repaired.code,
  });
  if (repaired.code !== 0) return { result: repaired };
  result = await ctx.exec(plan.retry, { cwd: ctx.cwd });
  return { result };
}

/**
 * @param {Record<string, any>} ctx
 * @param {Record<string, any>} state
 */
/**
 * @param {Record<string, any>} ctx
 * @param {string} relativePath
 */
function readOptional(ctx, relativePath) {
  if (typeof ctx.readFile !== 'function') return '';
  try {
    return ctx.readFile(relativePath) ?? '';
  } catch {
    return '';
  }
}

async function runRelease(ctx, state) {
  const specText = readOptional(ctx, state.specPath);
  state.branch = englishBranch(specText, state.branch, ctx.now);
  const title = releaseTitle(state.branch, state.followUp === true);
  const body = releaseBody({ specPath: state.specPath, brief: state.brief });
  const argv = releaseArgv({
    branch: state.branch,
    base: ctx.manifest.release.base,
    title,
    body,
  });
  const status = await ctx.exec(argv.status, { cwd: ctx.cwd });
  if (status.code !== 0) {
    state.status = 'release-failed';
    return { state, exitCode: 2, message: 'git status に失敗しました。' };
  }
  if (!String(status.stdout ?? '').trim()) {
    if (state.status !== 'pushed') {
      state.status = 'release-failed';
      return { state, exitCode: 1, message: 'コミットする変更がありません。' };
    }
    const pushed = await ctx.exec(argv.push, { cwd: ctx.cwd });
    if (pushed.code !== 0) {
      state.status = 'release-failed';
      return { state, exitCode: 2, message: `push に失敗しました。ブランチ ${state.branch} はローカルにあります。` };
    }
    return finishPullRequest(ctx, state, argv, body);
  }

  const checkout = await ctx.exec(argv.checkout, { cwd: ctx.cwd });
  if (checkout.code !== 0) {
    state.status = 'release-failed';
    return { state, exitCode: 2, message: '作業ブランチの作成に失敗しました。' };
  }
  const added = await ctx.exec(argv.add, { cwd: ctx.cwd });
  if (added.code !== 0) {
    state.status = 'release-failed';
    return { state, exitCode: 2, message: 'git add に失敗しました。' };
  }
  const cached = await ctx.exec(argv.cachedNames, { cwd: ctx.cwd });
  const drop = sensitiveCachedPaths(
    String(cached.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  if (drop.length > 0) {
    const restored = await ctx.exec(['git', 'restore', '--staged', '--', ...drop], { cwd: ctx.cwd });
    if (restored.code !== 0) {
      state.status = 'release-failed';
      return { state, exitCode: 2, message: '秘密情報と生成物をステージから外すのに失敗しました。' };
    }
  }
  const staged = await ctx.exec(argv.staged, { cwd: ctx.cwd });
  if (staged.code === 0) {
    state.status = 'release-failed';
    return { state, exitCode: 1, message: 'ステージされた変更がありません。秘密情報の除外後に空になった可能性があります。' };
  }

  const committed = await ctx.exec(argv.commit, { cwd: ctx.cwd, input: `${title}\n\n${body}\n` });
  const commitText = `${committed.stdout}\n${committed.stderr}`;
  if (committed.code !== 0 && !/nothing to commit/i.test(commitText)) {
    state.status = 'release-failed';
    return { state, exitCode: 2, message: 'git commit に失敗しました。' };
  }

  const pushed = await ctx.exec(argv.push, { cwd: ctx.cwd });
  if (pushed.code !== 0) {
    state.status = 'release-failed';
    return { state, exitCode: 2, message: `push に失敗しました。ブランチ ${state.branch} はローカルにあります。` };
  }
  state.status = 'pushed';
  return finishPullRequest(ctx, state, argv, body);
}

/**
 * @param {Record<string, any>} ctx
 * @param {Record<string, any>} state
 * @param {ReturnType<typeof releaseArgv>} argv
 * @param {string} body
 */
async function finishPullRequest(ctx, state, argv, body) {
  const viewed = await ctx.exec(argv.prView, { cwd: ctx.cwd });
  const existing = openPullRequest(viewed);
  if (existing) {
    state.status = 'released';
    state.nextStage = 'done';
    state.followUp = false;
    state.pullRequest = existing.url;
    return {
      state,
      exitCode: 0,
      message: `既存の Pull Request を更新しました: ${existing.url}`,
    };
  }

  const pr = await ctx.exec(argv.pr, { cwd: ctx.cwd, input: body });
  if (pr.code !== 0) {
    const again = openPullRequest(await ctx.exec(argv.prView, { cwd: ctx.cwd }));
    if (again) {
      state.status = 'released';
      state.nextStage = 'done';
      state.followUp = false;
      state.pullRequest = again.url;
      return {
        state,
        exitCode: 0,
        message: `既存の Pull Request を更新しました: ${again.url}`,
      };
    }
    state.status = 'pushed';
    return {
      state,
      exitCode: 2,
      message: `ブランチ ${state.branch} は push 済みです。Pull Request の作成に失敗しました。`,
    };
  }
  state.status = 'released';
  state.nextStage = 'done';
  state.followUp = false;
  return {
    state,
    exitCode: 0,
    message: `Pull Request を作成しました。マージは人間が行ってください。ブランチ: ${state.branch}`,
  };
}
