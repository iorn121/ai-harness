/**
 * ユースケースごとの必須テスト。人が画面を見る代わりに、ここで決めたコマンドが verify を通る。
 *
 * web-ui: 画面を持つ Web アプリ。静的検査、単体、ビルド、Playwright（操作と画面比較）
 * library: UI のない Node ツール。存在する lint / test / build
 * mobile: Flutter。analyze と flutter test
 * service: Go などの API。go test
 * batch: Python のバッチやスクリプト。pytest
 */

const WEB_UI_PACKAGES = ['react', 'react-dom', 'svelte', 'vue'];

/**
 * @param {Record<string, string>} dependencies
 */
export function isWebUiPackage(dependencies) {
  return WEB_UI_PACKAGES.some((name) => dependencies[name] != null);
}

/**
 * @param {string} profile
 * @param {Record<string, string>} [scripts]
 */
export function commandsForProfile(profile, scripts = {}) {
  if (profile === 'web-ui') {
    /** @type {string[]} */
    const verify = [];
    if (scripts.check) verify.push('npm run check');
    else {
      for (const name of ['format:check', 'lint', 'typecheck']) {
        if (scripts[name]) verify.push(`npm run ${name}`);
      }
    }
    verify.push('npm run test:unit', 'npm run build', 'npm run test:e2e');
    return verify;
  }
  if (profile === 'mobile') return ['flutter analyze', 'flutter test'];
  if (profile === 'service') return ['go test ./...'];
  if (profile === 'batch') return ['python -m pytest'];
  return [];
}

/**
 * @param {string} profile
 * @param {string[]} commands
 */
export function missingTestingCommands(profile, commands) {
  /** @type {string[]} */
  const required =
    profile === 'web-ui'
      ? ['test:unit', 'test:e2e', 'build']
      : profile === 'mobile'
        ? ['flutter analyze', 'flutter test']
        : profile === 'service'
          ? ['go test']
          : [];
  if (profile === 'batch') {
    const covered = commands.some(
      (command) => command.includes('pytest') || command.includes('unittest'),
    );
    return covered ? [] : ['pytest または unittest'];
  }
  return required.filter((fragment) => !commands.some((command) => command.includes(fragment)));
}
