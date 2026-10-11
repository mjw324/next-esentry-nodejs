#!/usr/bin/env bash
# Check out a backend ref into its own worktree so two versions can run side
# by side (e.g. origin/main vs perf/optimizations) without touching the main
# checkout.
#
#   bin/worktree.sh <ref> [name]       -> ../esentry-worktrees/<name>
#   bin/worktree.sh --remove <name>
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$HERE/../next-esentry-nodejs"
ROOT="$HERE/../esentry-worktrees"
if [ "${1:-}" = "--remove" ]; then
  git -C "$REPO" worktree remove --force "$ROOT/$2"
  exit 0
fi
REF="$1"
NAME="${2:-$(echo "$REF" | tr '/' '-')}"
mkdir -p "$ROOT"
git -C "$REPO" fetch -q origin
if [ ! -d "$ROOT/$NAME" ]; then
  git -C "$REPO" worktree add --detach "$ROOT/$NAME" "$REF"
fi
(cd "$ROOT/$NAME" && pnpm install --frozen-lockfile --dangerously-allow-all-builds && { git ls-files --error-unmatch pnpm-workspace.yaml >/dev/null 2>&1 || rm -f pnpm-workspace.yaml; })
echo "$ROOT/$NAME"
