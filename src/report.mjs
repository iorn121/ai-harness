/**
 * @param {{ name?: string, status?: string, message?: string, repairs?: Array<{ command: string, repair: string, reason: string, code: number }>, specPath?: string, nextStage?: string }} input
 */
export function renderRunReport(input) {
  const repairs = input.repairs ?? [];
  const repairLines =
    repairs.length === 0
      ? ['機械的な修復はありません。']
      : repairs.map(
          (repair) =>
            `- ${repair.reason}: \`${repair.repair}\` のあと \`${repair.command}\` を再実行（終了コード ${repair.code}）`,
        );
  return [
    `# ${input.name ?? 'harness'} の実行報告`,
    '',
    `- 状態: ${input.status ?? 'unknown'}`,
    `- 次: ${input.nextStage ?? 'unknown'}`,
    `- 仕様: ${input.specPath ?? 'なし'}`,
    '',
    input.message ? `${input.message}` : 'メッセージはありません。',
    '',
    '## 機械的な修復',
    '',
    ...repairLines,
    '',
  ].join('\n');
}
