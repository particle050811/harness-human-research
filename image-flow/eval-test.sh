#!/usr/bin/env bash
# 一键启动评测产物的 VS Code 插件测试（扩展开发宿主）
# 用法：
#   eval-test                  # 最新一次 run
#   eval-test superpowers      # 该变体最新一次 run
#   eval-test runs/eval-xxx    # 指定 run 目录
set -euo pipefail

RUNS_DIR="$(cd "$(dirname "$0")" && pwd)/runs"

case "${1:-}" in
  "")  RUN_DIR=$(ls -dt "$RUNS_DIR"/eval-* 2>/dev/null | head -1) ;;
  */*) RUN_DIR="$1" ;;
  *)   RUN_DIR=$(ls -dt "$RUNS_DIR"/eval-"$1"-* 2>/dev/null | head -1) ;;
esac

[ -n "${RUN_DIR:-}" ] && [ -d "$RUN_DIR" ] || { echo "未找到 run 目录（runs/ 下现有: $(ls "$RUNS_DIR" 2>/dev/null | xargs)）" >&2; exit 1; }
RUN_DIR="$(cd "$RUN_DIR" && pwd)"
echo "插件目录: $RUN_DIR"

cd "$RUN_DIR"
[ -d node_modules ] || { echo "安装依赖..."; npm install; }
[ -f dist/extension.js ] || { echo "构建..."; npm run compile; }

# 拉起扩展开发宿主，工作区即 run 目录（demo.md 可直接测试）
# WSL 下 remote-cli 的 code 不支持 --extensionDevelopmentPath，需调 Windows 侧主程序 + --remote
WIN_CODE="/mnt/c/Users/particle/AppData/Local/Programs/Microsoft VS Code/bin/code"
if [ -n "${WSL_DISTRO_NAME:-}" ] && [ -x "$WIN_CODE" ]; then
  # 该包装脚本会自动附加 --remote wsl+<发行版>
  exec "$WIN_CODE" --new-window --extensionDevelopmentPath="$RUN_DIR" "$RUN_DIR"
fi
exec code --new-window --extensionDevelopmentPath="$RUN_DIR" "$RUN_DIR"
