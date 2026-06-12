#!/usr/bin/env python3
"""Guard Router — file path to guard script mapping + session signal I/O.

ADR-030 Section 3.3: maps edited file paths to relevant guard checks.
Produces per-session signal files consumed by guard-feedback.py (WP-6).

Usage:
    from scripts.guard_router import route, run_guards, write_session_signal, read_all_signals
"""
from __future__ import annotations

import dataclasses
import importlib
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.checks import Finding  # noqa: E402

# ── GUARD_MAP: file path prefix -> guard name list ──
# Fully per ADR-030 Section 3.3. Longer prefixes checked first.
GUARD_MAP: dict[str, list[str]] = {
    # Business code
    "bridge_agent/":                    ["check_bridge_deps"],
    "backend/product/bridge/":          ["check_bridge_deps"],
    "mcp-server/":                      ["check_mcp_parity"],
    "mcp-server-node/":                 ["check_mcp_parity"],
    # check_versions scans all docs for stale version refs → too noisy
    # for PostToolUse (hundreds of P1s per edit). Runs in pre-commit / CI
    # via coherence.py instead.
    # "backend/":                       ["check_versions"],

    # Documentation — only fast, targeted guards in write-time path.
    "docs/issues/":                     ["check_issue_closure"],
    "backend/product/routes/":          ["check_doc_freshness"],
    "docs/ROADMAP.md":                  ["check_doc_freshness"],
    "CLAUDE.md":                        ["check_doc_freshness"],
    # ADR-038 D5.1 Magic Docs — drift-detection for machine-derived metadata
    "docs/magic/":                      ["check_doc_freshness"],
    ".claude/rules/backend-routes.md":  ["check_doc_freshness"],

    # Governance layer (guard protects guard — ADR-030 principle #3)
    ".claude/settings.json":            ["check_hook_installed"],
    ".githooks/":                       ["check_hook_installed"],
    "scripts/context_router.py":        ["check_fragment_integrity"],
    "scripts/context-fragments/":       ["check_fragment_integrity"],
}

# No default guard in write-time path — specificity beats coverage.
# Full checks run in pre-commit / CI.
DEFAULT_GUARDS: list[str] = []

# ── Category -> Skill mapping (ADR-030 Section 3.4) ──
CATEGORY_TO_SKILLS: dict[str, list[str]] = {
    "closure_semantics":    ["lead", "towow-ops"],
    "contract_drift":       ["towow-dev", "towow-eng-test"],
    "bridge_boundary":      ["towow-bridge", "towow-ops"],
    "policy_freeze":        ["lead", "arch", "plan-lock"],
    "doc_integrity":        ["towow-ops"],
    "version_drift":        ["towow-ops"],
    "artifact_linkage":     ["lead"],
    "governance_bootstrap": ["towow-ops"],
}

# Session signal expiry: 1 hour
_SESSION_TTL_SECONDS = 3600


def route(file_path: str) -> list[str]:
    """Return matching guard names for a file path. Longest prefix first, deduped."""
    matched: list[str] = []
    for pattern, guards in sorted(GUARD_MAP.items(), key=lambda x: -len(x[0])):
        if file_path.startswith(pattern) or file_path == pattern.rstrip("/"):
            matched.extend(guards)
    if not matched:
        return list(DEFAULT_GUARDS)
    return list(dict.fromkeys(matched))


def run_guards(file_path: str) -> list[Finding]:
    """Route file_path to guards, dynamically import and run each."""
    guard_names = route(file_path)
    findings: list[Finding] = []
    for name in guard_names:
        module_path = f"scripts.checks.{name}"
        try:
            mod = importlib.import_module(module_path)
        except Exception as exc:
            findings.append(Finding(
                severity="P0",
                message=f"Failed to import guard {module_path}: {exc}",
                file=f"scripts/checks/{name}.py",
                category="governance_bootstrap",
                blocking=True,
            ))
            continue

        run_fn = getattr(mod, "run", None)
        if run_fn is None:
            findings.append(Finding(
                severity="P1",
                message=f"{module_path} has no run() function",
                file=f"scripts/checks/{name}.py",
                category="governance_bootstrap",
            ))
            continue

        try:
            result = run_fn(REPO_ROOT, mode="full")
            findings.extend(result)
        except TypeError:
            result = run_fn(REPO_ROOT)
            findings.extend(result)
        except Exception as exc:
            findings.append(Finding(
                severity="P0",
                message=f"{module_path}.run() raised: {exc}",
                file=f"scripts/checks/{name}.py",
                category="governance_bootstrap",
                blocking=True,
            ))
    return findings


def _guard_dir() -> Path:
    return REPO_ROOT / ".towow" / "guard"


def write_session_signal(findings: list[Finding]) -> Path:
    """Atomically write findings to a per-session signal file.

    Uses tmp + os.rename for crash safety — readers never see partial JSON.
    Returns the path written.
    """
    guard_dir = _guard_dir()
    guard_dir.mkdir(parents=True, exist_ok=True)
    pid = os.getpid()
    target = guard_dir / f"session-{pid}.json"
    tmp = guard_dir / f"session-{pid}.tmp"

    data = {
        "pid": pid,
        "timestamp": time.time(),
        "findings": [dataclasses.asdict(f) for f in findings],
    }
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.rename(str(tmp), str(target))
    return target


def read_all_signals(*, pid: int | None = None) -> dict:
    """Read and merge session signal files.

    Args:
        pid: If given, only read signals from this PID's session file.
             If None, read all sessions (legacy behavior).

    Merge strategy:
      - severity: max (P0 > P1 > P2)
      - blocking: OR
      - required_skills: union
      - findings: concatenated

    Expired sessions (> 1 hour) are cleaned up.
    JSON parse errors cause the file to be skipped.
    """
    guard_dir = _guard_dir()
    if not guard_dir.is_dir():
        return {"severity": None, "blocking": False, "required_skills": [], "findings": []}

    severity_order = {"P0": 0, "P1": 1, "P2": 2}
    now = time.time()

    all_findings: list[dict] = []
    max_severity: str | None = None
    blocking = False
    skills: set[str] = set()

    if pid is not None:
        # Scoped read: only this session's signal file
        paths = [guard_dir / f"session-{pid}.json"]
    else:
        paths = list(guard_dir.glob("session-*.json"))

    for path in paths:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        ts = data.get("timestamp", 0)
        if now - ts > _SESSION_TTL_SECONDS:
            try:
                path.unlink()
            except OSError:
                pass
            continue

        for f in data.get("findings", []):
            all_findings.append(f)
            sev = f.get("severity", "P2")
            if max_severity is None or severity_order.get(sev, 9) < severity_order.get(max_severity, 9):
                max_severity = sev
            if f.get("blocking"):
                blocking = True
            skills.update(f.get("required_skills") or [])

    return {
        "severity": max_severity,
        "blocking": blocking,
        "required_skills": sorted(skills),
        "findings": all_findings,
    }
