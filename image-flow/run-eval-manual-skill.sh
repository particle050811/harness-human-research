#!/usr/bin/env bash
# manual-skill 模式专属脚本：模拟人工逐轮以 "/skill名 任务" 驱动开发流程。
# 与 run-eval.sh 的区别：不发单条 prompt 交给模型自主跑完，而是逐轮 headless 调用——
# 第 1 轮 `claude -p`，之后 `claude -p --continue` 续接同一会话。
#
# 两种用法：
# run 目录按实验轮次分组（runs/round<N>/），固定剧本与 setup 均须以 ROUND=<N> 指定轮次。
# 1) 固定剧本模式（原有行为）：按 eval-config-manual-<变体>.yml 的 rounds 剧本自动逐轮跑完
#      ROUND=<N> ./run-eval-manual-skill.sh [skill变体，默认 superpowers] [配置文件，默认 eval-config-manual-<变体>.yml]
# 2) 监工模式（由评测员逐轮驱动，每轮提示词现场拼）：
#      ROUND=<N> ./run-eval-manual-skill.sh setup [skill变体] [配置文件]   # 只做准备，打印 RUN_DIR 后退出
#        剧本各轮文本存入 $RUN_DIR/rounds/ 供拼提示词参考；调用参数存入 $RUN_DIR/.eval-env
#      ./run-eval-manual-skill.sh round <RUN_DIR> <提示词文件>   # 跑一轮（自动判断是否 --continue）
#      ./run-eval-manual-skill.sh export <RUN_DIR>              # 会话记录导出 HTML/Markdown
set -euo pipefail
cd "$(dirname "$0")"

MODE=run
case "${1:-}" in
  setup|round|export) MODE="$1"; shift ;;
esac

# ---------- round：跑一轮（无需 YAML，参数全部来自 setup 写入的 .eval-env） ----------
if [ "$MODE" = "round" ]; then
  [ $# -ge 2 ] || { echo "用法: ./run-eval-manual-skill.sh round <RUN_DIR> <提示词文件>" >&2; exit 1; }
  RUN_DIR="$(cd "$1" && pwd)"
  PROMPT="$(cat "$2")"
  # shellcheck source=/dev/null
  source "$RUN_DIR/.claude-home/eval-env"
  # 已有会话记录则续接，否则开新会话
  CONT_ARGS=()
  if find "$CONFIG_HOME/projects" -name '*.jsonl' -print -quit 2>/dev/null | grep -q .; then
    CONT_ARGS=(--continue)
  fi
  cd "$RUN_DIR"
  exec env DISABLE_AUTOUPDATER=1 CLAUDE_CONFIG_DIR="$CONFIG_HOME" "$CLAUDE_BIN" \
    --settings "$CLAUDE_SETTINGS" \
    --permission-mode "$PERMISSION_MODE" \
    -p "${CONT_ARGS[@]}" "$PROMPT"
fi

# ---------- export：会话 JSONL 渲染成 HTML/Markdown ----------
do_export() {
  local run_dir="$1" config_home="$2"
  local proj_dir
  proj_dir="$(find "$config_home/projects" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)"
  if [ ! -x "$HOME/.local/bin/claude-code-log" ]; then
    echo "未安装 claude-code-log（pip3 install --user claude-code-log），原始记录在 $config_home/projects/" >&2
  elif [ -z "$proj_dir" ]; then
    echo "未找到会话记录目录: $config_home/projects/" >&2
  else
    "$HOME/.local/bin/claude-code-log" "$proj_dir" -o "$run_dir/transcript.html" \
      && echo "对话记录已导出: $run_dir/transcript.html" \
      || echo "HTML 对话记录导出失败（原始 JSONL 在 $proj_dir）" >&2
    # markdown 版（注意：--format md 必须显式传，仅凭 .md 后缀不生效）
    "$HOME/.local/bin/claude-code-log" "$proj_dir" --format md --no-cache -o "$run_dir/transcript.md" \
      && echo "对话记录已导出: $run_dir/transcript.md" \
      || echo "Markdown 对话记录导出失败（原始 JSONL 在 $proj_dir）" >&2
  fi
  # 评测已结束，收纳 run 目录的隔离 git 仓库——嵌套 .git 会让外层 git 静默跳过 transcript 的 add
  if [ -d "$run_dir/.git" ] && [ -d "$config_home" ]; then
    mv "$run_dir/.git" "$config_home/run-git"
    echo "隔离 git 仓库已收纳，查历史用: git --git-dir=$config_home/run-git log"
  fi
}

if [ "$MODE" = "export" ]; then
  [ $# -ge 1 ] || { echo "用法: ./run-eval-manual-skill.sh export <RUN_DIR>" >&2; exit 1; }
  RUN_DIR="$(cd "$1" && pwd)"
  do_export "$RUN_DIR" "$RUN_DIR/.claude-home"
  exit 0
fi

# ---------- setup / run 公共准备 ----------
VARIANT="${1:-superpowers}"
CONFIG="${2:-eval-config-manual-$VARIANT.yml}"
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
  echo "用法: ./run-eval-manual-skill.sh [setup] [skill变体] [配置文件]" >&2
  echo "可用变体: $(ls "$VARIANTS_DIR" | xargs)" >&2
  exit 1
fi

# 展开 ~ 路径
CLAUDE_BIN="${CLAUDE_BIN/#\~/$HOME}"
CLAUDE_SETTINGS="${CLAUDE_SETTINGS/#\~/$HOME}"

[ -x "$CLAUDE_BIN" ] || { echo "claude 旧版不存在: $CLAUDE_BIN（先按 README 安装 2.1.152）" >&2; exit 1; }
[ -f "$CLAUDE_SETTINGS" ] || { echo "settings 文件不存在: $CLAUDE_SETTINGS" >&2; exit 1; }

# 创建本次测试目录（含变体名，时间戳精确到秒；监工模式加 supervised 前缀以区分驱动方式）
[ "$MODE" = "setup" ] && DIR_PREFIX="$DIR_PREFIX-supervised"
[ -n "${ROUND:-}" ] || { echo "请用 ROUND=<实验轮次号> 指定本 run 所属轮次（目录将放入 runs/round<N>/）" >&2; exit 1; }
RUN_DIR="$TEST_ROOT/round$ROUND/$DIR_PREFIX-$VARIANT-$(date +%y%m%d%H%M%S)"
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

# 隔离 git：run 目录自带仓库并提交基线。否则 run 目录处于评测仓库工作树内，
# 被测会话开场注入的 gitStatus 是评测仓库的（分支/提交/路径全部越界），
# 会把模型引向 image-flow 源目录读写（260611 监工试跑实际发生，run 作废）
printf '.claude-home/\n' > "$RUN_DIR/.gitignore"
git -C "$RUN_DIR" init -q -b main
git -C "$RUN_DIR" -c user.name=eval -c user.email=eval@local add -A
git -C "$RUN_DIR" -c user.name=eval -c user.email=eval@local commit -qm "初始材料：需求文档与 API 文档"

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

# ---------- setup：保存轮次参考与调用参数，打印 RUN_DIR 后退出，轮次由评测员接管 ----------
# 剧本与调用参数放进 .claude-home（git 忽略且不在被测模型视线内），避免剧本剧透
if [ "$MODE" = "setup" ]; then
  cp -r "$ROUNDS_TMP" "$CONFIG_HOME/rounds"
  printf 'CLAUDE_BIN=%q\nCLAUDE_SETTINGS=%q\nPERMISSION_MODE=%q\nCONFIG_HOME=%q\n' \
    "$CLAUDE_BIN" "$CLAUDE_SETTINGS" "$PERMISSION_MODE" "$CONFIG_HOME" > "$CONFIG_HOME/eval-env"
  echo "skill 变体: $VARIANT"
  echo "剧本参考: $CONFIG_HOME/rounds/（共 $(ls "$CONFIG_HOME/rounds" | wc -l) 轮）"
  echo "RUN_DIR=$RUN_DIR"
  exit 0
fi

# ---------- run：固定剧本逐轮执行（原有行为） ----------
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

# 结束后导出会话记录
do_export "$RUN_DIR" "$CONFIG_HOME"
exit $CLAUDE_EXIT
