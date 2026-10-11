/**
 * @param {{ id: string, hasHarness: boolean, manifestError?: string, profile?: string, scripts?: Record<string, string> }} input
 */
export function inspectProduct(input) {
  /** @type {string[]} */
  const gaps = [];
  if (!input.hasHarness) gaps.push('harness.json がありません');
  if (input.manifestError) gaps.push(input.manifestError);
  const scripts = input.scripts ?? {};
  if (input.profile === 'web-ui') {
    for (const name of ['test:unit', 'test:e2e', 'build']) {
      if (!scripts[name]) gaps.push(`npm script ${name} がありません`);
    }
  }
  if (input.profile === 'mobile' && !input.hasHarness) {
    gaps.push('flutter analyze と flutter test を verify に入れる harness.json がありません');
  }
  return { id: input.id, profile: input.profile ?? 'unknown', gaps };
}
