#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveApiKey } from './api-key.mjs';
import { detectFromTree } from './detect.mjs';
import { inspectProduct } from './doctor.mjs';
import { HarnessError } from './errors.mjs';
import { runCommand } from './exec.mjs';
import { mergeGitignore } from './gitignore.mjs';
import { applyDefaults } from './manifest.mjs';
import { runPipeline } from './pipeline.mjs';
import { resolveProductPath } from './products.mjs';
import { renderRunReport } from './report.mjs';
import { sendPrompt } from './session.mjs';

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGES = new Set(['specify', 'implement', 'verify', 'release', 'all']);

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const opts = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) opts[key] = true;
    else {
      opts[key] = next;
      index += 1;
    }
  }
  return { command: positionals[0] ?? 'help', opts };
}

/**
 * @param {Record<string, string | boolean>} opts
 */
function resolveCwd(opts) {
  if (opts.cwd && opts.product) {
    throw new HarnessError('--cwd と --product は同時に指定できません');
  }
  if (typeof opts.cwd === 'string') return path.resolve(opts.cwd);
  if (typeof opts.product === 'string') {
    const catalog = JSON.parse(readFileSync(path.join(harnessRoot, 'products.json'), 'utf8'));
    return resolveProductPath(catalog, opts.product, harnessRoot);
  }
  return process.cwd();
}

/**
 * @param {string} cwd
 */
function readTree(cwd) {
  /** @type {Record<string, string>} */
  const tree = {};
  for (const name of ['package.json', 'package-lock.json', 'pubspec.yaml', 'requirements.txt', 'pyproject.toml', 'go.mod']) {
    const file = path.join(cwd, name);
    if (existsSync(file)) tree[name] = readFileSync(file, 'utf8');
  }
  if (existsSync(path.join(cwd, 'tests'))) tree['tests/'] = '';
  if (existsSync(path.join(cwd, 'test'))) tree['test/'] = '';
  return tree;
}

/**
 * @param {string} cwd
 */
function loadManifest(cwd) {
  const file = path.join(cwd, 'harness.json');
  if (!existsSync(file)) {
    throw new HarnessError('harness.json がありません。対象ディレクトリで harness init を実行してください。');
  }
  return applyDefaults(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * @param {string} cwd
 */
function statePath(cwd) {
  return path.join(cwd, '.harness', 'run.json');
}

/**
 * @param {string} cwd
 */
function loadState(cwd) {
  const file = statePath(cwd);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * @param {string} cwd
 * @param {Record<string, unknown>} state
 */
function saveState(cwd, state) {
  const dir = path.join(cwd, '.harness');
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(cwd), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * @param {Record<string, string | boolean>} opts
 */
function loadBrief(opts) {
  if (opts.brief && opts['brief-file']) {
    throw new HarnessError('--brief と --brief-file は同時に指定できません');
  }
  if (typeof opts['brief-file'] === 'string') return readFileSync(opts['brief-file'], 'utf8');
  if (typeof opts.brief === 'string') return opts.brief;
  return '';
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
  const { command, opts } = parseArgs(argv);
  if (command === 'help' || opts.help) {
    console.log(helpText());
    return 0;
  }
  if (command === 'list') {
    const catalog = JSON.parse(readFileSync(path.join(harnessRoot, 'products.json'), 'utf8'));
    for (const item of catalog) console.log(`${item.id}\t${path.resolve(harnessRoot, item.path)}`);
    return 0;
  }
  if (command === 'doctor') return doctor();
  const cwd = resolveCwd(opts);
  if (command === 'init') return init(cwd);
  if (command === 'status') return status(cwd);
  if (command === 'run') return run(cwd, opts);
  throw new HarnessError(`不明なコマンドです: ${command}\n\n${helpText()}`);
}

/**
 * @param {string} cwd
 */
function init(cwd) {
  const destination = path.join(cwd, 'harness.json');
  if (existsSync(destination)) throw new HarnessError('harness.json は既にあります。');
  const detected = detectFromTree(readTree(cwd));
  const manifest = applyDefaults({
    name: path.basename(cwd),
    stack: detected.stack,
    automation: 'unattended',
    testing: detected.profile ? { profile: detected.profile } : undefined,
    commands: detected.commands,
    gates: { afterSpecify: false, beforeRelease: false },
  });
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  const ignorePath = path.join(cwd, '.gitignore');
  const current = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
  writeFileSync(ignorePath, mergeGitignore(current));
  console.log(`harness.json を書きました (${detected.stack}): ${destination}`);
  if (manifest.commands.verify.length === 0) {
    console.log('commands.verify が空です。テストやビルドのコマンドを追記してください。');
  }
  return 0;
}

/**
 * @param {string} cwd
 */
function status(cwd) {
  const state = loadState(cwd);
  if (!state) {
    console.log('進行中のランはありません。');
    return 0;
  }
  console.log(`${state.status}\t${state.specPath ?? ''}\t${state.branch ?? ''}`);
  return 0;
}

/**
 * @param {string} cwd
 * @param {Record<string, string | boolean>} opts
 */
async function run(cwd, opts) {
  const stage = typeof opts.stage === 'string' ? opts.stage : 'all';
  if (!STAGES.has(stage)) throw new HarnessError(`不明な stage です: ${stage}`);
  const manifest = loadManifest(cwd);
  const apiKey = resolveApiKey({ env: process.env });
  if (!apiKey) {
    throw new HarnessError('CURSOR_API_KEY が未設定です。~/.config/ai-harness/env に置いてください。');
  }
  const outcome = await runPipeline({
    manifest,
    state: loadState(cwd),
    requested: stage,
    yes: opts.yes === true,
    brief: loadBrief(opts),
    cwd,
    now: new Date(),
    exists: (relativePath) => existsSync(path.join(cwd, relativePath)),
    readFile: (relativePath) => readFileSync(path.join(cwd, relativePath), 'utf8'),
    exec: (command, commandOptions = {}) => runCommand(command, { ...commandOptions, cwd }),
    save: async (state) => saveState(cwd, state),
    send: (prompt, meta) =>
      sendPrompt({
        prompt,
        agentId: meta.agentId,
        cwd,
        model: manifest.model,
        apiKey,
        timeoutMs: manifest.limits.timeoutMs,
      }),
  });
  if (outcome.message) console.error(`\n${outcome.message}`);
  writeRunReport(cwd, manifest, outcome);
  return outcome.exitCode;
}

function doctor() {
  const catalog = JSON.parse(readFileSync(path.join(harnessRoot, 'products.json'), 'utf8'));
  let gaps = 0;
  for (const item of catalog) {
    const cwd = resolveProductPath(catalog, item.id, harnessRoot);
    const harnessFile = path.join(cwd, 'harness.json');
    const packageFile = path.join(cwd, 'package.json');
    /** @type {Record<string, string>} */
    let scripts = {};
    if (existsSync(packageFile)) {
      try {
        scripts = JSON.parse(readFileSync(packageFile, 'utf8')).scripts ?? {};
      } catch {
        scripts = {};
      }
    }
    let profile;
    /** @type {string | undefined} */
    let manifestError;
    if (existsSync(harnessFile)) {
      try {
        const manifest = applyDefaults(JSON.parse(readFileSync(harnessFile, 'utf8')));
        profile = manifest.testing?.profile;
      } catch (error) {
        manifestError = error instanceof Error ? error.message : String(error);
      }
    }
    const finding = inspectProduct({
      id: item.id,
      hasHarness: existsSync(harnessFile),
      manifestError,
      profile,
      scripts,
    });
    gaps += finding.gaps.length;
    const detail = finding.gaps.length === 0 ? 'ok' : finding.gaps.join('; ');
    console.log(`${finding.id}\t${finding.profile}\t${detail}`);
  }
  return gaps === 0 ? 0 : 1;
}

/**
 * @param {string} cwd
 * @param {Record<string, any>} manifest
 * @param {{ state?: Record<string, any>, message?: string }} outcome
 */
function writeRunReport(cwd, manifest, outcome) {
  const state = outcome.state ?? {};
  const report = renderRunReport({
    name: manifest.name,
    status: state.status,
    message: outcome.message,
    repairs: state.repairs,
    specPath: state.specPath,
    nextStage: state.nextStage,
  });
  mkdirSync(path.join(cwd, '.harness'), { recursive: true });
  writeFileSync(path.join(cwd, '.harness', 'report.md'), report);
}

function helpText() {
  return `使い方:
  harness list
  harness doctor
  harness init [--product <id> | --cwd <dir>]
  harness status [--product <id> | --cwd <dir>]
  harness run --stage specify|implement|verify|release|all [--brief <text> | --brief-file <file>] [--yes] [--product <id> | --cwd <dir>]

段階は specify（要件）→ implement（実装）→ verify（テスト）→ release（Pull Request）です。
release はマージしません。開いている Pull Request があるブランチでは、commit と push でその Pull Request を更新します。
リリース済みのランに --brief を付けて run すると、同じブランチで実装、テスト、push まで進みます。
--yes は承認ゲートを通過します。`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof HarnessError) {
        console.error(error.message);
        process.exit(error.exitCode);
      }
      console.error(error);
      process.exit(1);
    });
}
