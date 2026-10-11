# ハーネス作業報告（2026-10-04）

人の目視を待たずに実装を進めるため、テストの種類をプロダクトの形で決め、落ちた検証のうち機械的に直せるものはエージェントの前にハーネスが直すようにした。

## テストの決め

| profile | 対象 | verify |
| --- | --- | --- |
| web-ui | React / Svelte / Vue | 既存の lint・型検査、`npm run test:unit`、`npm run build`、`npm run test:e2e` |
| library | UI のない Node | ある lint、単体テスト、ビルド |
| mobile | Flutter | `flutter analyze`、`flutter test` |
| service | Go | `go test ./...` |
| batch | Python | `python -m pytest` |

`web-ui` の `test:e2e` は Playwright に固定した。操作の受け入れ条件と、同じテストの画面比較（`toHaveScreenshot`）を両方入れる。計算は単体テスト、画面のユースケースはブラウザテスト、という分担にした。

既定の `automation` は `unattended`。仕様承認とリリース前の目視では止まらない。テストが通ると Pull Request を作る。`main` へのマージはしない。

## color-verse に入れた検証

比較画面 `/compare` を対象にした。

- 単体テスト `tests/unit/contrast.test.ts`。黒白は 21:1 で AAA、`#777777` と白は AA 未達、`#767676` と白は AA のみ、入れ替えで比は不変、無効 HEX は結果なし。`#595959` は実測で AAA を超えていたので、AA のみの例は `#767676`（約 4.54:1）に改めた。
- Playwright `e2e/compare.spec.ts`。AA 未達の警告、AAA だけの情報表示、黒白の成功と入れ替え、無効 HEX。各状態の画面比較 4 枚を `e2e/compare.spec.ts-snapshots/` に保存した。
- `harness.json` の verify は `npm run check`、`npm run test:unit`、`npm run build`、`npm run test:e2e`。
- GitHub Actions の CI にも単体テスト、ビルド、Playwright を追加した。

このマシンでの結果: 単体 5 件成功、整形・lint・型検査成功、ビルド成功、ブラウザテスト 4 件はスナップショット作成後の再実行でも成功。

## 自己修復

検証コマンドが落ちたとき、エージェントを呼ぶ前に次の 2 つだけを各 1 回試す。

- `npm ci` が lock の不足（`Missing:`）を出したら、`npm install --package-lock-only` のあとでもう一度 `npm ci`。
- 整形チェックが `Code style issues found` なら、`npm run format` のあとで同じチェックを再実行。

実行結果は対象プロダクトの `.harness/report.md` に書く。`harness doctor` は登録 9 プロダクトを見る。今回の結果は color-verse だけ `web-ui` として揃っており、他の 8 つには `harness.json` がまだない。

ハーネス自身の単体テストは 25 件成功。

## 9プロダクトへの接続

`harness doctor` は 9 件とも ok になった。

| プロダクト | profile | このあいだに足して、このマシンで通したこと |
| --- | --- | --- |
| color-verse | web-ui | 単体 5、ブラウザ 4、画面比較 4 |
| pocket-museum | web-ui | ESLint 10 用の `eslint.config.js`。lint が通る。空の常設展のブラウザテストと画面比較 |
| tabi-no-shiori | web-ui | 見本 JSON の単体テスト。ホームのブラウザテストと画面比較 |
| shinjuku-chronowalk | web-ui | エリア定義の単体テスト。タイトル画面のブラウザテストと画面比較 |
| AQUASYNC | mobile | `flutter analyze` と `flutter test` を verify に記載。テスト本体は既存のまま |
| quant-ops | batch | `python3 -m unittest discover -s tests`。pytest が未導入でも既存の unittest を必須にした |
| claude-automation | batch | ブリーフィングの unittest |
| iorn121.github.io | library | lint と build |
| Yomu-Kamo | library | frontend の lint と build、`go test -C backend ./...` |

pocket-museum、tabi-no-shiori、shinjuku-chronowalk の CI にも、単体テストと Playwright を追加した。

## まだやっていないこと

- Git へのコミットと Pull Request の作成はしていない。
- Cursor のエージェントによる実装の再実行はしていない。API キーはこの実行環境から見えない。
- 画面比較は Mac（`darwin`）と Ubuntu 用 Docker（`linux`）の両方の基準画像を置いた。CI は linux の画像と比べる。
- Yomu-Kamo は、認証情報なしで通るログイン画面の確認と画面比較を `npm run test:e2e:public` として verify に加えた。本の登録シナリオはテスト用アカウントが必要なので、そこは動かしていない。
