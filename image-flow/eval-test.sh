#!/usr/bin/env bash
# 一键启动评测产物的 VS Code 插件测试（扩展开发宿主）
# 用法：
#   eval-test                         # 最新一次 run
#   eval-test superpowers             # 该变体最新一次 run（跨所有轮次）
#   eval-test runs/roundN/eval-xxx    # 指定 run 目录
# VS Code 程序路径默认自动探测；可用环境变量覆盖：
#   VSCODE_BIN=/path/to/Code.exe eval-test ...
set -euo pipefail

RUNS_DIR="$(cd "$(dirname "$0")" && pwd)/runs"

case "${1:-}" in
  "")  RUN_DIR=$(ls -dt "$RUNS_DIR"/round*/eval-* 2>/dev/null | head -1) ;;
  */*) RUN_DIR="$1" ;;
  *)   RUN_DIR=$(ls -dt "$RUNS_DIR"/round*/eval-*"$1"-* 2>/dev/null | head -1) ;;
esac

[ -n "${RUN_DIR:-}" ] && [ -d "$RUN_DIR" ] || { echo "未找到 run 目录（runs/ 下现有: $(ls "$RUNS_DIR" 2>/dev/null | xargs)）" >&2; exit 1; }
RUN_DIR="$(cd "$RUN_DIR" && pwd)"
echo "插件目录: $RUN_DIR"

cd "$RUN_DIR"
[ -d node_modules ] || { echo "安装依赖..."; npm install; }
[ -f dist/extension.js ] || { echo "构建..."; npm run compile; }

# 窗口标题：往 run 工作区注入 window.title，多开开发宿主时一眼区分是哪个 run。
# 只合并这一个键，保留被测会话可能已写入的其它设置。
mkdir -p .vscode
python3 - "$(basename "$RUN_DIR")" <<'PY'
import json, sys, pathlib
tag = sys.argv[1]
p = pathlib.Path(".vscode/settings.json")
data = {}
if p.exists():
    try:
        data = json.loads(p.read_text(encoding="utf-8") or "{}")
    except Exception:
        data = {}
data["window.title"] = f"\U0001F9EA {tag} ${{separator}}${{rootName}}${{separator}}${{activeEditorShort}}${{dirty}}"
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

# 拉起扩展开发宿主，工作区即 run 目录（demo.md 可直接测试）
if [ -n "${WSL_DISTRO_NAME:-}" ]; then
  # WSL：直发 Windows 侧 Code.exe + UNC 路径 => 纯本地窗口、无 --remote。
  # （走 remote 的窗口一旦打开 Windows 侧文件夹就会断连；UNC 本地窗口不会。）
  WIN_DIR="$(wslpath -w "$RUN_DIR")"
  CODE="${VSCODE_BIN:-}"
  if [ -z "$CODE" ]; then
    LAD="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
    for c in \
      "$(wslpath -u "$LAD" 2>/dev/null)/Programs/Microsoft VS Code/Code.exe" \
      "/mnt/c/Program Files/Microsoft VS Code/Code.exe"; do
      [ -x "$c" ] && CODE="$c" && break
    done
  fi
  [ -n "$CODE" ] || { echo "未找到 Windows 侧 VS Code，可用 VSCODE_BIN=/path/to/Code.exe 指定" >&2; exit 1; }
  exec "$CODE" --new-window --extensionDevelopmentPath="$WIN_DIR" "$WIN_DIR"
fi
exec "${VSCODE_BIN:-code}" --new-window --extensionDevelopmentPath="$RUN_DIR" "$RUN_DIR"
