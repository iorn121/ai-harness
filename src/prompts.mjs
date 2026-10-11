/**
 * @param {{ brief: string, specPath: string, product: string }} input
 */
export function specifyPrompt(input) {
  return [
    `プロダクト「${input.product}」の要件定義だけを行ってください。`,
    `仕様書を次のパスに新規作成または更新してください: ${input.specPath}`,
    '',
    '仕様書の先頭付近に、英小文字とハイフンだけの行を1つ書いてください。例: Slug: readable-user-memos',
    'この Slug が Git ブランチ名とコミットメッセージになります。',
    '仕様書には次の見出しを含めてください。',
    '- 背景',
    '- 要件',
    '- 受け入れ条件',
    '- 対象外',
    '- テスト',
    '',
    '既存ドキュメントの言語に合わせてください。判断できなければ日本語で書いてください。',
    'アプリケーションコード、設定、依存関係は変更しないでください。',
    'git commit やブランチ作成、push はしないでください。',
    '',
    '依頼:',
    input.brief.trim(),
  ].join('\n');
}

/**
 * @param {{ brief: string, specPath: string, product: string, followUp?: boolean }} input
 */
export function implementPrompt(input) {
  return [
    `プロダクト「${input.product}」で、仕様書 ${input.specPath} を実装してください。`,
    input.followUp
      ? 'これは既存の Pull Request への追加要望です。新しいブランチは作らず、今の作業ツリーに続きを書いてください。'
      : '仕様の範囲だけを変更してください。',
    'リポジトリの既存の作法と、プロジェクトのルールファイルに従ってください。',
    'git commit やブランチ作成、push はしないでください。変更は作業ツリーに残してください。',
    '検証は人が見ずに通します。web-ui なら単体テスト（npm run test:unit）と Playwright の操作確認・画面比較（npm run test:e2e）を仕様の受け入れ条件ごとに追加してください。',
    '',
    '依頼の要約:',
    input.brief.trim(),
  ].join('\n');
}

/**
 * @param {{ command: string, output: string, attempt: number, limit: number }} input
 */
export function verifyFixPrompt(input) {
  return [
    `検証コマンドが失敗しました（修正 ${input.attempt}/${input.limit}）。`,
    `失敗したコマンド: ${input.command}`,
    '失敗原因だけを直し、仕様の範囲を広げないでください。',
    'git commit や push はしないでください。',
    '',
    '出力の末尾:',
    input.output,
  ].join('\n');
}
