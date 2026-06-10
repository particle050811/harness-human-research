#!/usr/bin/env bash
# manual-skill 模式专属脚本：模拟人工逐轮以 "/skill名 任务" 驱动开发流程。
# 与 run-eval.sh 的区别：不发单条 prompt 交给模型自主跑完，而是按
# eval-config-manual-skill.yml 的 rounds 剧本逐轮 headless 调用——
# 第 1 轮 `claude -p`，之后 `claude -p --continue` 续接同一会话。
# 用法：./run-eval-manual-skill.sh [skill变体，默认 superpowers] [配置文件，默认 eval-config-manual-skill.yml]
set -euo pipefail
cd "$(dirname "$0")"

VARIANT="${1:-superpowers}"
CONFIG="${2:-eval-config-manual-skill.yml}"
[ -f "$CONFIG" ] || { echo "配置文件不存在: $CONFIG" >&2; exit 1; }

# 轮次剧本写入临时目录（01.txt、02.txt…），其余字段输出 shell 变量
ROUNDS_TMP="$(mktemp -d)"
trap 'rm -rf "$ROUNDS_TMP"' EXIT
eval "$(python3 - "$CONFIG" "$ROUNDS_TMP" <<'PY'
import sys, yaml, shlex, os

def load(path):
    cfg = yaml.safe_load(open(path))
    base_path = cfg.pop("extends", None)
    if base_path:
        base = load(os.path.join(os.path.dirname(path), base_path))
        for k, v in cfg.items():  # 项目覆盖公共；字典按字段合并
            if isinstance(v, dict) and isinstance(base.get(k), dict):
                base[k].update(v)
            else:
                base[k] = v
        return base
    return cfg

cfg = load(sys.argv[1])
c = cfg["claude"]
rounds = cfg.get("rounds") or sys.exit("配置缺少 rounds 剧本")
for i, r in enumerate(rounds, 1):
    open(os.path.join(sys.argv[2], f"{i:02d}.txt"), "w").write(r.strip())
print(f'TEST_ROOT={shlex.quote(cfg["test_root"])}')
print(f'DIR_PREFIX={shlex.quote(cfg.get("dir_prefix", "eval-manual"))}')
print(f'VARIANTS_DIR={shlex.quote(cfg.get("skill_variants_dir", "./skill-variants"))}')
print(f'CLAUDE_BIN={shlex.quote(c["bin"])}')
print(f'CLAUDE_SETTINGS={shlex.quote(c["settings"])}')
print(f'PERMISSION_MODE={shlex.quote(c.get("permission_mode", "acceptEdits"))}')
pairs = "\n".join(f'{f["src"]}\t{f["dest"]}' for f in cfg.get("files", []))
print(f'FILES={shlex.quote(pairs)}')
PY
)"

if [ ! -d "$VARIANTS_DIR/$VARIANT" ]; then
  echo "用法: ./run-eval-manual-skill.sh [skill变体] [配置文件]" >&2
  echo "可用变体: $(ls "$VARIANTS_DIR" | xargs)" >&2
  exit 1
fi

# 展开 ~ 路径
CLAUDE_BIN="${CLAUDE_BIN/#\~/$HOME}"
CLAUDE_SETTINGS="${CLAUDE_SETTINGS/#\~/$HOME}"

[ -x "$CLAUDE_BIN" ] || { echo "claude 旧版不存在: $CLAUDE_BIN（先按 README 安装 2.1.152）" >&2; exit 1; }
[ -f "$CLAUDE_SETTINGS" ] || { echo "settings 文件不存在: $CLAUDE_SETTINGS" >&2; exit 1; }

# 创建本次测试目录（含变体名，时间戳精确到秒）
RUN_DIR="$TEST_ROOT/$DIR_PREFIX-$VARIANT-$(date +%y%m%d%H%M%S)"
mkdir -p "$RUN_DIR"
RUN_DIR="$(cd "$RUN_DIR" && pwd)"

# 复制评测材料
while IFS=$'\t' read -r src dest; do
  [ -n "$src" ] || continue
  mkdir -p "$RUN_DIR/$(dirname "$dest")"
  cp "$src" "$RUN_DIR/$dest"
  echo "已复制: $src -> $RUN_DIR/$dest"
done <<< "$FILES"

# 安装 skill 变体：project/ 进测试目录根（项目级），home/ 进隔离配置目录（用户级）
VARIANT_DIR="$(cd "$VARIANTS_DIR/$VARIANT" && pwd)"
if [ -d "$VARIANT_DIR/project" ]; then
  cp -r "$VARIANT_DIR/project/." "$RUN_DIR/"
  echo "已安装项目级 skill: $VARIANT/project/ -> $RUN_DIR/"
fi

# 隔离的 CLAUDE_CONFIG_DIR：屏蔽 ~/.claude 的用户级 skills 与全局 CLAUDE.md，保证基线干净
CONFIG_HOME="$RUN_DIR/.claude-home"
mkdir -p "$CONFIG_HOME"
if [ -d "$VARIANT_DIR/home" ]; then
  cp -r "$VARIANT_DIR/home/." "$CONFIG_HOME/"
  echo "已安装用户级 skill: $VARIANT/home/ -> $CONFIG_HOME/"
fi

# 预置 onboarding 完成与目录信任标记，避免新配置目录首次启动卡在引导界面
python3 - "$CONFIG_HOME/.claude.json" "$RUN_DIR" <<'PY'
import json, sys
json.dump({
    "hasCompletedOnboarding": True,
    "theme": "dark",
    "projects": {sys.argv[2]: {"hasTrustDialogAccepted": True}},
}, open(sys.argv[1], "w"), indent=2)
PY

ROUND_FILES=("$ROUNDS_TMP"/*.txt)
echo "测试目录: $RUN_DIR"
echo "skill 变体: $VARIANT"
echo "剧本轮数: ${#ROUND_FILES[@]}"
echo "逐轮 headless 启动 claude-deepseek ($("$CLAUDE_BIN" --version))..."

cd "$RUN_DIR"
CLAUDE_EXIT=0
ROUND_NO=0
for rf in "${ROUND_FILES[@]}"; do
  ROUND_NO=$((ROUND_NO + 1))
  PROMPT="$(cat "$rf")"
  echo
  echo "===== 第 $ROUND_NO/${#ROUND_FILES[@]} 轮：$(head -c 60 "$rf")..."
  # 第 1 轮新会话，之后 --continue 续接最近会话（CLAUDE_CONFIG_DIR 隔离，必为本次会话）
  CONT_ARGS=()
  [ "$ROUND_NO" -gt 1 ] && CONT_ARGS=(--continue)
  set +e
  env DISABLE_AUTOUPDATER=1 CLAUDE_CONFIG_DIR="$CONFIG_HOME" "$CLAUDE_BIN" \
    --settings "$CLAUDE_SETTINGS" \
    --permission-mode "$PERMISSION_MODE" \
    -p "${CONT_ARGS[@]}" "$PROMPT"
  CLAUDE_EXIT=$?
  set -e
  if [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "第 $ROUND_NO 轮异常退出（exit=$CLAUDE_EXIT），剧本中止；已完成轮次的记录仍会导出" >&2
    break
  fi
done

# 结束后用 claude-code-log 把会话 JSONL 渲染成 HTML，存进运行目录
# （需指向 projects/ 下的具体项目子目录；本次运行只会产生一个）
PROJ_DIR="$(find "$CONFIG_HOME/projects" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)"
if [ ! -x "$HOME/.local/bin/claude-code-log" ]; then
  echo "未安装 claude-code-log（pip3 install --user claude-code-log），原始记录在 $CONFIG_HOME/projects/" >&2
elif [ -z "$PROJ_DIR" ]; then
  echo "未找到会话记录目录: $CONFIG_HOME/projects/" >&2
else
  "$HOME/.local/bin/claude-code-log" "$PROJ_DIR" -o "$RUN_DIR/transcript.html" \
    && echo "对话记录已导出: $RUN_DIR/transcript.html" \
    || echo "HTML 对话记录导出失败（原始 JSONL 在 $PROJ_DIR）" >&2
  # markdown 版（注意：--format md 必须显式传，仅凭 .md 后缀不生效）
  "$HOME/.local/bin/claude-code-log" "$PROJ_DIR" --format md --no-cache -o "$RUN_DIR/transcript.md" \
    && echo "对话记录已导出: $RUN_DIR/transcript.md" \
    || echo "Markdown 对话记录导出失败（原始 JSONL 在 $PROJ_DIR）" >&2
fi
exit $CLAUDE_EXIT
