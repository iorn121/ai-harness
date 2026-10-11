# ai-harness

プロダクトごとの実装差を `harness.json` に閉じ込め、要件定義から Pull Request までを同じ段階で進める。実行本体は Cursor のローカルエージェント（`@cursor/sdk`）で、マージはしない。

```
specify → implement → verify → release
要件定義    実装        テスト     Pull Request
```

既定は `automation: unattended` です。仕様の承認とリリース前の目視では止まりません。テストが通ると Pull Request を作ります。main へのマージは行いません。人が確認したいときだけ `automation` を `attended` にし、`gates.afterSpecify` と `gates.beforeRelease` を true にします。

ローカルエージェントの会話は同じマシンでしか再開できない。CI は 1 ジョブで完走させる。

## コマンド

```bash
cd /path/to/ai-harness
npm ci
# キーは ~/.config/ai-harness/env の CURSOR_API_KEY を読む。環境変数があればそちらが優先される。

node src/cli.mjs list
node src/cli.mjs init --product color-verse
node src/cli.mjs run --product color-verse --stage specify --brief "比較画面にコントラスト警告を出す"
node src/cli.mjs run --product color-verse --stage implement
node src/cli.mjs run --product color-verse --stage verify
node src/cli.mjs run --product color-verse --stage release
```

`products.json` にあるディレクトリは `--product` で指定できる。それ以外は `--cwd` を使う。

| 段階 | エージェント | ハーネスが自分で行うこと |
| --- | --- | --- |
| specify | `docs/specs/` に仕様を書く。アプリのコードは触らない | 仕様以外の新規変更があれば止める |
| implement | 仕様の範囲だけ実装する。コミットしない | |
| verify | 失敗したコマンドの出力を渡して直させる | プロファイルの必須テストを実行する。失敗後の往復は最大 5 回 |
| release | | `harness/<id>` ブランチへ commit、push、`gh pr create`。`main` には push しない。開いている Pull Request があれば作成せず、そのブランチへ push して更新する |

`release` は `.env`、`credentials.json`、`token.json`、`.harness/` をコミット対象から外す。Dependabot や Renovate のブランチでは開始せず、その Pull Request は更新しない。

すでに Pull Request があるランへ追加するときは、新しい仕様にはしません。同じプロダクトで `--brief` を付けて `harness run` すると、実装、テスト、同じブランチへの push まで進みます。

```bash
node src/cli.mjs run --product Yomu-Kamo --brief "メモの余白を広げる"
```

## テストの決め

| profile | 対象 | verify が必ず実行するもの |
| --- | --- | --- |
| web-ui | React / Svelte / Vue | 既存の lint・型検査（`npm run check` があればそれ）、`npm run test:unit`、`npm run build`、`npm run test:e2e` |
| library | UI のない Node | ある lint、単体テスト、ビルド |
| mobile | Flutter | `flutter analyze`、`flutter test` |
| service | Go | `go test ./...` |
| batch | Python | `python -m pytest` |

`web-ui` の `test:e2e` は Playwright です。操作の受け入れ条件と、同じテスト内の画面比較（`toHaveScreenshot`）の両方を含めます。単体テストは計算や状態、ブラウザテストは画面のユースケースです。

検証が失敗したとき、エージェントを呼ぶ前にハーネスが自分で直せるものがあります。`npm ci` が lock の不足を報告したときは `npm install --package-lock-only` のあとでもう一度 `npm ci` を実行します。整形チェックが落ちたときは `npm run format` のあとで同じチェックを再実行します。各コマンドにつき 1 回です。結果は対象プロダクトの `.harness/report.md` に残します。`harness doctor` は、登録済みプロダクトに必須のテストコマンドが揃っているかを見ます。

## プロダクトへの導入

対象のルートで `harness init` を実行すると、スタックに応じた `harness.json` を書く。

- Node: `package.json` の `check`（なければ lint / typecheck）、`test`、`build`。`npm` の空テストは入れない
- Flutter: `flutter analyze`、`flutter test`
- Python: `tests/` または `test/` があるとき `python -m pytest`
- Go: `go test ./...`

`commands.verify` が空のときは、そのプロダクトの確認コマンドを追記してから `verify` を実行する。状態は `.harness/run.json` に残り、`.gitignore` に `.harness/` を足す。

```json
{
  "name": "color-verse",
  "model": "composer-2.5",
  "specDir": "docs/specs",
  "commands": {
    "install": "npm ci",
    "verify": ["npm run check", "npm run build"]
  },
  "release": { "base": "main", "mode": "pull-request" },
  "gates": { "afterSpecify": true, "beforeRelease": true }
}
```

`release.mode` は `pull-request` だけを受け付ける。

## CI

`templates/github-workflow.yml` をプロダクトの `.github/workflows/ai-harness.yml` にコピーする。リポジトリ変数 `AI_HARNESS_REPOSITORY` とシークレット `CURSOR_API_KEY` が必要。Issue タイトルに `[AI]` があり、起票者が Owner / Member / Collaborator のときだけ動く。

color-verse にある `remote-ai-agent.yml` は、このハーネスより前の Issue から PR までの経路として残している。
