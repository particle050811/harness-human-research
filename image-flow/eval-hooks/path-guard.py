#!/usr/bin/env python3
# 路径越界守卫（PreToolUse hook）：被测会话的文件类工具只允许访问 run 目录与 /tmp；
# Bash 命令中出现评测仓库内、run 目录外的绝对路径时拒绝。
# 退出码 2 = 拦截，stderr 作为反馈返回给被测模型。
import json
import os
import sys

# 脚本位于 RUN_DIR/.claude-home/hooks/，向上三级即 RUN_DIR
RUN_DIR = os.path.realpath(os.path.join(os.path.abspath(__file__), "..", "..", ".."))
# 评测仓库根：RUN_DIR 形如 <EVAL_ROOT>/image-flow/runs/...，取 /image-flow/runs/ 之前部分
EVAL_ROOT = RUN_DIR.split("/image-flow/runs/")[0] if "/image-flow/runs/" in RUN_DIR else ""

FILE_PATH_KEYS = ("file_path", "path", "notebook_path")


def inside(path, root):
    real = os.path.realpath(path)
    return real == root or real.startswith(root + os.sep)


def allowed_file_path(path, cwd):
    if not os.path.isabs(path):
        path = os.path.join(cwd, path)
    return inside(path, RUN_DIR) or inside(path, "/tmp")


def deny(reason):
    sys.stderr.write(
        f"拒绝：{reason}\n本项目根目录是 {RUN_DIR}（即你的工作目录），"
        "所有文件读写必须使用项目内路径。\n"
    )
    sys.exit(2)


data = json.load(sys.stdin)
tool = data.get("tool_name", "")
ti = data.get("tool_input", {}) or {}
cwd = data.get("cwd") or RUN_DIR

if tool == "Bash":
    cmd = ti.get("command", "")
    if EVAL_ROOT:
        # 逐个提取命令中以评测仓库根开头的绝对路径片段
        start = 0
        while True:
            i = cmd.find(EVAL_ROOT, start)
            if i < 0:
                break
            j = i
            while j < len(cmd) and cmd[j] not in " \t\n'\";|&)(<>":
                j += 1
            p = cmd[i:j]
            if not (inside(p, RUN_DIR)):
                deny(f"Bash 命令引用了项目外路径 {p}")
            start = j
else:
    for k in FILE_PATH_KEYS:
        v = ti.get(k)
        if isinstance(v, str) and v and not allowed_file_path(v, cwd):
            deny(f"{tool} 访问了项目外路径 {v}")

sys.exit(0)
