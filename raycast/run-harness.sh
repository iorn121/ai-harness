#!/bin/zsh
# @raycast.schemaVersion 1
# @raycast.title ハーネスを実行
# @raycast.mode silent
# @raycast.packageName AI Harness
# @raycast.icon 🤖
# @raycast.description 選んだプロダクトで、要件から Pull Request まで実行する
# @raycast.argument1 { "type": "dropdown", "placeholder": "プロダクト", "data": [{"title": "color-verse", "value": "color-verse"}, {"title": "pocket-museum", "value": "pocket-museum"}, {"title": "tabi-no-shiori", "value": "tabi-no-shiori"}, {"title": "shinjuku-chronowalk", "value": "shinjuku-chronowalk"}, {"title": "AQUASYNC", "value": "AQUASYNC"}, {"title": "Yomu-Kamo", "value": "Yomu-Kamo"}, {"title": "iorn121.github.io", "value": "iorn121.github.io"}, {"title": "quant-ops", "value": "quant-ops"}, {"title": "claude-automation", "value": "claude-automation"}] }
# @raycast.argument2 { "type": "text", "placeholder": "やってほしいこと", "percentEncoded": false }
# @raycast.argument3 { "type": "dropdown", "placeholder": "段階", "optional": true, "data": [{"title": "すべて", "value": "all"}, {"title": "要件", "value": "specify"}, {"title": "実装", "value": "implement"}, {"title": "テスト", "value": "verify"}, {"title": "Pull Request", "value": "release"}] }

set -euo pipefail

product="${1:-}"
brief="${2:-}"
stage="${3:-all}"
[[ -z "$stage" ]] && stage="all"

if [[ -z "$product" || -z "$brief" ]]; then
  echo "プロダクトと、やってほしいことを入力してください"
  exit 1
fi

harness="$HOME/Documents/workspace/ai-harness"
key_file="$HOME/.config/ai-harness/env"
if [[ ! -f "$key_file" ]]; then
  echo "API キーがありません: $key_file"
  exit 1
fi

runner=$(mktemp -t harness-run)
product="$product" brief="$brief" stage="$stage" harness="$harness" key_file="$key_file" runner="$runner" python3 - <<'PY'
import os, shlex, pathlib
path = pathlib.Path(os.environ["runner"])
script = "\n".join([
    "#!/bin/zsh",
    "set -euo pipefail",
    f"cd {shlex.quote(os.environ['harness'])}",
    "set -a",
    f"source {shlex.quote(os.environ['key_file'])}",
    "set +a",
    "exec node src/cli.mjs run"
    + f" --product {shlex.quote(os.environ['product'])}"
    + f" --stage {shlex.quote(os.environ['stage'])}"
    + f" --brief {shlex.quote(os.environ['brief'])}",
    "",
])
path.write_text(script, encoding="utf-8")
path.chmod(0o700)
PY

osacompile -o "${TMPDIR:-/tmp}/harness-run.scpt" -e "tell application \"Terminal\" to activate" -e "tell application \"Terminal\" to do script \"/bin/zsh $(printf '%q' "$runner")\"" >/dev/null
osascript "${TMPDIR:-/tmp}/harness-run.scpt"
echo "${product} のハーネスを Terminal で開始しました"
