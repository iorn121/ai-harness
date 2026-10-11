import { commandsForProfile, isWebUiPackage } from './testing-policy.mjs';

/**
 * @param {Record<string, string | undefined>} tree ファイル名から内容。ディレクトリはキー `tests/` のように空文字で表す。
 */
export function detectFromTree(tree) {
  if (tree['package.json'] != null) return detectNode(tree);
  if (tree['pubspec.yaml'] != null) return detectFlutter();
  if (tree['go.mod'] != null) return detectGo();
  if (tree['requirements.txt'] != null || tree['pyproject.toml'] != null || tree['tests/'] != null) {
    return detectPython(tree);
  }
  return { stack: 'unknown', profile: 'unknown', commands: { install: null, verify: [] } };
}

/**
 * @param {Record<string, string | undefined>} tree
 */
function detectNode(tree) {
  /** @type {Record<string, string>} */
  let scripts = {};
  /** @type {Record<string, string>} */
  let dependencies = {};
  try {
    const parsed = JSON.parse(tree['package.json'] ?? '{}');
    scripts = parsed.scripts ?? {};
    dependencies = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
  } catch {
    scripts = {};
    dependencies = {};
  }
  const profile = isWebUiPackage(dependencies) ? 'web-ui' : 'library';
  /** @type {string[]} */
  let verify = commandsForProfile(profile, scripts);
  if (profile === 'library') {
    if (scripts.check) verify.push('npm run check');
    else {
      for (const name of ['format:check', 'lint', 'typecheck']) {
        if (scripts[name]) verify.push(`npm run ${name}`);
      }
    }
    if (scripts['test:unit']) verify.push('npm run test:unit');
    else if (scripts.test && !/no test specified/.test(scripts.test)) verify.push('npm test');
    if (scripts.build) verify.push('npm run build');
  }
  const install = tree['package-lock.json'] != null ? 'npm ci' : 'npm install';
  return { stack: 'node', profile, commands: { install, verify } };
}

function detectFlutter() {
  return {
    stack: 'flutter',
    profile: 'mobile',
    commands: {
      install: 'flutter pub get',
      verify: commandsForProfile('mobile'),
    },
  };
}

function detectGo() {
  return {
    stack: 'go',
    profile: 'service',
    commands: { install: null, verify: commandsForProfile('service') },
  };
}

/**
 * @param {Record<string, string | undefined>} tree
 */
function detectPython(tree) {
  const hasTests = tree['tests/'] != null || tree['test/'] != null;
  return {
    stack: 'python',
    profile: 'batch',
    commands: {
      install: tree['requirements.txt'] != null ? 'python -m pip install -r requirements.txt' : null,
      verify: hasTests ? commandsForProfile('batch') : [],
    },
  };
}
