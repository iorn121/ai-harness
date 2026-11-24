const ORDER = ['specify', 'implement', 'verify', 'release'];
const VERIFIED = new Set(['verified', 'awaiting-release']);
const OPEN_FOR_FOLLOW_UP = new Set(['released', 'pushed', 'verified', 'awaiting-release', 'release-failed']);

/** 1本のハーネス実行。次に進めてよい段階を自分で決める。 */
export class Run {
  /**
   * @param {Record<string, any> | null} state
   */
  constructor(state) {
    this.state = state;
  }

  /**
   * @param {{ requested: string, yes: boolean, gates: { afterSpecify: boolean, beforeRelease: boolean }, brief?: string }} input
   */
  decide(input) {
    if (input.requested !== 'all') return { stages: [input.requested], message: null, followUp: false };
    const brief = String(input.brief ?? '').trim();
    const state = this.state;
    if (brief && brief !== String(state?.brief ?? '').trim() && OPEN_FOR_FOLLOW_UP.has(state?.status)) {
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
}
