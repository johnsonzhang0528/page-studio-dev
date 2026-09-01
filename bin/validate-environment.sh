#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

check() { if "$@" >/dev/null 2>&1; then printf '通過  %s\n' "$*"; else printf '失敗  %s\n' "$*"; fail=1; fi; }

check git --version
check node --version
check "$HOME/.local/bin/claude" --version
check test -f "$HOME/.claude/skills/page-autodev/SKILL.md"
check test -f "$HOME/.claude/skills/archify/SKILL.md"
check test -f "$HOME/.claude/agents/developer.md"
check test -f "$HOME/.claude/workflows/page-autodev.md"
check test -f "$root/project-template/CLAUDE.md"
check test -x "$root/bin/new-project.sh"
check test -x "$root/bin/page-autodev"
check test -f "$root/lib/quality.mjs"
check test -f "$root/lib/gate-findings.mjs"
check node --check "$root/lib/gate-findings.mjs"
check node --check "$root/lib/autodev.mjs"
check test -f "$root/project-template/.ai/GATE_FINDINGS.json"
check test -f "$root/project-template/.ai/RELEASE_RISKS.json"
check test -f "$HOME/.claude/agents/spec.md"
check test -f "$HOME/.claude/agents/planner.md"
check test -f "$root/systemd/page-autodev@.service"

browser="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
if [ -n "$browser" ]; then printf '通過  瀏覽器 %s\n' "$browser"; else printf '失敗  找不到可用瀏覽器\n'; fail=1; fi

exit "$fail"
