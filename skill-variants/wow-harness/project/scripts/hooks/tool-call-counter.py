#!/usr/bin/env python3
"""PreToolUse hook — count tool calls + recite objective every N calls.

[来源: ADR-038 §4 D9 + Manus/IMPACT — Objective Recitation
       — recite at end of context AFTER ~50 tool calls
       — counter resets noise but keeps mid-task drift bounded]

Why this exists:
- PreCompact-only recitation (the existing `precompact.sh`) only fires
  at compaction edges — every N tens-of-thousands of tokens. That's much
  rarer than Manus's "every 50 tool calls" cadence.
- D9 meta-review (memory: project_adr038_meta_review_findings.md) flagged
  this as "形式 30%, 本意 30%". This script closes the gap.
- Frequency: every 50 tool calls (configurable via TOWOW_RECITATION_EVERY)

Behavior:
- Increments .towow/metrics/tool-call-counter.txt on every PreToolUse
- On the Nth call, prints an Objective Recitation fragment (objective +
  unfinished features + Sprint reminder) to stdout — CC injects it as
  context for the upcoming tool call
- Counter is monotone (does not reset across sessions); modulo gives the
  fire condition. This matches the "after every 50 tool calls" semantics.
- Atomic write: uses tmp + rename to survive concurrent sessions

Always exits 0. This is advisory, never blocking.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
COUNTER_FILE = REPO_ROOT / ".towow" / "metrics" / "tool-call-counter.txt"
CURRENT_PROGRESS = REPO_ROOT / ".towow" / "progress" / "current.json"

DEFAULT_RECITE_EVERY = 50
RECITE_EVERY = int(os.environ.get("TOWOW_RECITATION_EVERY", DEFAULT_RECITE_EVERY))


def _read_counter() -> int:
    if not COUNTER_FILE.exists():
        return 0
    try:
        return int(COUNTER_FILE.read_text(encoding="utf-8").strip() or "0")
    except (ValueError, OSError):
        return 0


def _write_counter(value: int) -> None:
    COUNTER_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = COUNTER_FILE.with_suffix(".tmp")
    tmp.write_text(str(value), encoding="utf-8")
    os.rename(str(tmp), str(COUNTER_FILE))


def _format_recitation(count: int) -> str | None:
    """Pull objective + unfinished features from current.json. None if absent."""
    if not CURRENT_PROGRESS.exists():
        return None
    try:
        data = json.loads(CURRENT_PROGRESS.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    objective = data.get("objective", "<未设置>")
    wp_id = data.get("wp_id", "<no-wp>")
    features = data.get("features", []) or []
    pending = [f for f in features if f.get("status") != "passing"]
    no_evidence = [
        f for f in features
        if f.get("status") == "passing" and not f.get("evidence")
    ]

    lines = [
        "",
        f"## Objective Recitation (D9, after {count} tool calls)",
        "",
        f"**WP**: `{wp_id}`",
        f"**原始目标**（D8 immutable）：{objective}",
        "",
    ]
    if pending:
        lines.append("**未完成 features**：")
        for f in pending:
            steps = f.get("steps") or []
            steps_summary = f" — {len(steps)} steps" if steps else ""
            lines.append(f"  - [{f.get('status', '?')}] `{f.get('id', '?')}` {f.get('subject', '')}{steps_summary}")
        lines.append("")
    if no_evidence:
        lines.append("**Passing 但缺 evidence**（D8 stop-check 会拒绝）：")
        for f in no_evidence:
            lines.append(f"  - `{f.get('id', '?')}` {f.get('subject', '')}")
        lines.append("")
    if not pending and not no_evidence:
        lines.append("**所有 features passing 且有 evidence**，准备进入 stop-check。")
        lines.append("")

    lines.append("提醒：保持注意力在原始目标上。如果当前操作偏离此目标，请重新规划。")
    lines.append("[ADR-038 §4 D9 — Manus Objective Recitation pattern]")
    return "\n".join(lines)


def main() -> int:
    count = _read_counter() + 1
    try:
        _write_counter(count)
    except OSError:
        return 0  # advisory, never block

    if count % RECITE_EVERY != 0:
        return 0

    fragment = _format_recitation(count)
    if fragment:
        print(fragment)
    return 0


if __name__ == "__main__":
    sys.exit(main())
