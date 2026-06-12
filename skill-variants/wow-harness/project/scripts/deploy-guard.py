#!/usr/bin/env python3
"""Deploy Guard — Claude Code Bash PreToolUse hook。

拦截对受保护服务器的写操作，强制走标准更新路径。
PLAN-060 WP-1, ISSUE-026 + ADR-030 Level 2（guard-20260408-0445 orphan worktree）防复发。

受保护服务器：
- 47.118.31.230  阿里云 backend  → 必须用 scripts/deploy.sh
- 46.250.229.84  新加坡 bridge VPS → 必须用 git pull（避免重新制造 orphan worktree）

行为：
- 写操作（scp 上传, rsync 非 dry-run, ssh systemctl restart/stop/start）→ exit 1 (hard block)
- 只读操作（ssh journalctl/cat/ls/git/..., scp 下载, rsync dry-run）→ exit 0 (allow)
- deploy.sh 严格匹配 → exit 0 (allow)
- 非受保护服务器命令 → exit 0 (allow)

Usage (Claude Code hook):
    echo '{"tool_name":"Bash","tool_input":{"command":"scp file root@47.118.31.230:/opt/towow/"}}' | python3 scripts/deploy-guard.py
"""
from __future__ import annotations

import json
import re
import sys

PROD_IP = "47.118.31.230"
BRIDGE_VPS_HOSTS = ("46.250.229.84",)  # bridge_agent 运行节点；扩容时同步加入
GUARDED_HOSTS = (PROD_IP, *BRIDGE_VPS_HOSTS)

# deploy.sh 严格匹配模式
DEPLOY_SH_PATTERN = re.compile(
    r"^bash\s+scripts/deploy\.sh(\s+--(dry-run|yes))*\s*$"
)

# SSH 只读命令白名单
# 注意：`git` 在白名单内，用于支持 bridge VPS 的合法 `git pull`/`git fetch` 更新路径
# （ADR-030 Level 2 防复发：scp 上传被禁止后，bridge 的唯一更新通道）。
# 这意味着 ssh git push 也会通过——可接受，因为生产节点没有理由 push。
SSH_READONLY_CMDS = {
    "journalctl", "cat", "ls", "head", "tail", "grep",
    "ss", "curl", "dig", "status", "git", "file", "stat",
}

# systemctl 写操作
SYSTEMCTL_WRITE_OPS = {"restart", "stop", "start"}


def get_command() -> str | None:
    """从 stdin JSON 读取 Bash command。"""
    try:
        hook_input = json.load(sys.stdin)
        tool_input = hook_input.get("tool_input", {})
        return tool_input.get("command", None)
    except (json.JSONDecodeError, EOFError, ValueError):
        return None


def is_deploy_sh(cmd: str) -> bool:
    """检查命令是否严格匹配 deploy.sh 调用。"""
    return bool(DEPLOY_SH_PATTERN.match(cmd.strip()))


def has_guarded_host(cmd: str) -> bool:
    """检查命令是否涉及任一受保护服务器。"""
    return any(host in cmd for host in GUARDED_HOSTS)


def which_guarded_host(cmd: str) -> str | None:
    """返回命令中匹配的第一个受保护服务器名（用于差异化 block 提示）。"""
    for host in GUARDED_HOSTS:
        if host in cmd:
            return host
    return None


def is_compound_command(cmd: str) -> bool:
    """检查是否是复合命令（含 &&, ||, ;, |）。"""
    # 简单检测：排除引号内的分隔符
    # 去掉引号内容后检查
    stripped = re.sub(r'"[^"]*"', '', cmd)
    stripped = re.sub(r"'[^']*'", '', stripped)
    return bool(re.search(r'[;&|]{1,2}', stripped))


def check_scp_direction(cmd: str) -> str:
    """判断 scp 方向：'upload' | 'download' | 'none'。

    scp local remote:path → upload (受保护 host 在目标位置，即最后一个参数)
    scp remote:path local → download (受保护 host 在源位置)
    """
    parts = cmd.split()
    if not parts or parts[0] != "scp":
        return "none"

    # 找最后一个非 flag 参数
    args = [p for p in parts[1:] if not p.startswith("-")]
    if len(args) < 2:
        return "none"

    last_arg = args[-1]
    if any(host in last_arg for host in GUARDED_HOSTS):
        return "upload"
    # 受保护 host 在非最后位置 = 下载源
    for arg in args[:-1]:
        if any(host in arg for host in GUARDED_HOSTS):
            return "download"
    return "none"


def check_ssh_command(cmd: str) -> str:
    """判断 SSH 命令类型：'write' | 'readonly' | 'none'。

    支持 sudo 前缀（含 -u USER 语法）：跳过 sudo 及其 flag 后再判定真实命令。
    """
    if "ssh" not in cmd:
        return "none"
    if not has_guarded_host(cmd):
        return "none"

    # 提取引号内的远程命令
    quoted = re.findall(r'"([^"]*)"', cmd)
    if not quoted:
        quoted = re.findall(r"'([^']*)'", cmd)
    if not quoted:
        return "none"

    remote_cmd = quoted[0].strip()
    parts = remote_cmd.split()
    if not parts:
        return "none"

    # 跳过 sudo [-u USER] [-E] [-i] 等前缀，找到真正的命令首词
    idx = 0
    if parts[0] == "sudo":
        idx = 1
        while idx < len(parts) and parts[idx].startswith("-"):
            if parts[idx] == "-u" and idx + 1 < len(parts):
                idx += 2
            else:
                idx += 1

    first_word = parts[idx] if idx < len(parts) else ""

    # systemctl：必须是首词或 sudo 后首词
    if first_word == "systemctl":
        if idx + 1 < len(parts):
            op = parts[idx + 1]
            if op in SYSTEMCTL_WRITE_OPS:
                return "write"
        return "readonly"

    # 只读命令白名单
    if first_word in SSH_READONLY_CMDS:
        return "readonly"

    return "write"


def check_rsync(cmd: str) -> str:
    """判断 rsync 操作类型：'write' | 'dryrun' | 'none'。"""
    if "rsync" not in cmd:
        return "none"
    if not has_guarded_host(cmd):
        return "none"

    # dry-run 标志检测
    if "-n" in cmd.split() or "--dry-run" in cmd:
        return "dryrun"

    # 检查组合标志中的 n（如 -avzn）
    parts = cmd.split()
    for p in parts:
        if p.startswith("-") and not p.startswith("--") and "n" in p:
            return "dryrun"

    return "write"


def block(reason: str, host: str | None = None) -> None:
    """输出阻断信息并 exit 1，按 host 类型差异化提示。"""
    if host == PROD_IP:
        guidance = (
            "请使用标准部署流程：\n"
            "  后端: bash scripts/deploy.sh --yes\n"
            "  Demo 正式: bash scripts/deploy-demo.sh <name> --channel prod --yes\n"
            "  Demo 内测: bash scripts/deploy-demo.sh <name> --channel preview --yes\n"
            "  Edge/Nginx: bash scripts/deploy-edge.sh --yes\n"
            "详见 CLAUDE.md Development Commands。"
        )
    elif host in BRIDGE_VPS_HOSTS:
        guidance = (
            "Bridge VPS 必须走 git pull 更新路径：\n"
            f"  ssh root@{host} 'sudo -u towow git -C /opt/towow pull --ff-only'\n"
            "  scp/rsync 直传会重新制造 orphan worktree。\n"
            "  详见 docs/issues/guard-20260408-0445-bridge-vps-orphan-worktree.md。"
        )
    else:
        guidance = "未识别的受保护服务器目标，请确认 deploy 路径。"

    print(f"BLOCKED: {reason}\n{guidance}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    cmd = get_command()
    if not cmd:
        sys.exit(0)

    # 不涉及任何受保护服务器 → 放行
    if not has_guarded_host(cmd):
        sys.exit(0)

    host = which_guarded_host(cmd)

    # 复合命令且涉及受保护服务器 → 阻断（即使含 deploy.sh，避免被绑架）
    if is_compound_command(cmd):
        block("检测到复合命令中包含受保护服务器操作，禁止绕过标准部署路径", host)

    # deploy.sh 严格匹配 → 放行（仅对 PROD_IP 有意义）
    if is_deploy_sh(cmd):
        sys.exit(0)

    # scp 方向检测
    scp_dir = check_scp_direction(cmd)
    if scp_dir == "upload":
        block("禁止手动 scp 上传到受保护服务器", host)
    if scp_dir == "download":
        sys.exit(0)

    # SSH 命令检测
    ssh_type = check_ssh_command(cmd)
    if ssh_type == "write":
        block("禁止手动对受保护服务器执行写操作", host)
    if ssh_type == "readonly":
        sys.exit(0)

    # rsync 检测
    rsync_type = check_rsync(cmd)
    if rsync_type == "write":
        block("禁止手动 rsync 写入受保护服务器", host)
    if rsync_type == "dryrun":
        sys.exit(0)

    # 其他涉及受保护服务器的命令 → 保守阻断
    block("检测到未识别的受保护服务器操作", host)


if __name__ == "__main__":
    main()
