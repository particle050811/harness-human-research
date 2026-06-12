#!/usr/bin/env python3
"""SessionStart hook — alert AI on stale Magic Docs at session start.

[来源: ADR-038 §4 D5.2 — FileChanged Hook 监控
       — SessionStart hook returns watchPaths + injects drift fragment]

What this does:
- Runs the magic-doc check from check_doc_freshness on session start
- If any magic doc has drifted from its source, prints a drift fragment
  that CC injects into the session's initial context
- Cheap (~50ms): only checks the regenerator's --check mode

Why SessionStart and not PreToolUse:
- PostToolUse already catches drift INTRODUCED in the current session
- SessionStart catches drift introduced BETWEEN sessions (git pull, other
  worktrees, manual edits) — the harder case to detect

Output protocol:
- stdout: any text becomes a context fragment for the session
- exit 0 always (advisory, never blocking)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def main() -> int:
    regen = REPO_ROOT / "scripts" / "checks" / "regenerate_magic_docs.py"
    if not regen.exists():
        return 0  # nothing to check yet

    try:
        result = subprocess.run(
            ["python3", str(regen), "all", "--check"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=8,
        )
    except (subprocess.TimeoutExpired, OSError):
        return 0  # advisory, never block on errors

    if result.returncode == 0:
        return 0  # no drift, stay silent

    drift_lines = [
        line for line in result.stderr.splitlines()
        if line.startswith("DRIFT:")
    ]
    if not drift_lines:
        return 0

    print("=== ADR-038 D5 Magic Doc Drift Alert ===")
    print()
    print("The following Magic Docs are out of sync with their source-of-truth.")
    print("They are machine-derived metadata files (`docs/magic/*.md`) that auto-track")
    print("counts and structure. Drift means someone edited the source without")
    print("regenerating the magic doc.")
    print()
    for line in drift_lines:
        print(f"  {line}")
    print()
    print("To fix: `python3 scripts/checks/regenerate_magic_docs.py all`")
    print("Or fix the underlying source if the magic doc is the truth.")
    print()
    print("[ADR-038 §4 D5.1 Magic Docs pattern]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
