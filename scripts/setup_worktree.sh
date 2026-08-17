#!/usr/bin/env bash
# One-shot setup for a fresh NovaJS git worktree (agents and humans alike).
#
#   scripts/setup_worktree.sh [<commit-to-reset-to>]
#
# 1. Optionally hard-resets the worktree to <commit> (fetching first) —
#    worktrees have been observed spawning on a stale base.
# 2. Links the two children of packages/nova/Nova_Data (a TRACKED
#    placeholder directory) to the canonical, READ-ONLY game data with
#    `ln -sh`. Never copies (macOS resource forks live in xattrs) and never
#    relinks over an existing link.
# 3. `npm ci` — a worktree has no node_modules, and without one tsc/jasmine/
#    scratch scripts silently resolve novaparse/novadatainterface/nova_ecs to
#    the MAIN checkout's packages.
# 4. `npx turbo run build` so dist/ exists for every package.
set -euo pipefail

CANONICAL="${NOVA_DATA_CANONICAL:-/Users/matthew/Projects/novajs-parsing/packages/nova/Nova_Data}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -n "${1:-}" ]]; then
    # ROOT comes from the script's own location, so running the MAIN
    # checkout's copy from inside a worktree would reset main. Only linked
    # worktrees may be reset (their git dir lives under main's .git/worktrees).
    if [[ "$(git rev-parse --git-dir)" == "$(git rev-parse --git-common-dir)" ]]; then
        echo "refusing to reset: $ROOT is the main checkout, not a linked worktree." >&2
        echo "Run the copy of this script inside your worktree (cd there first)." >&2
        exit 1
    fi
    echo "== resetting worktree to $1"
    git fetch --quiet origin 2>/dev/null || true
    git reset --hard "$1"
fi
echo "== at $(git log -1 --format='%h %s')"

DATA="$ROOT/packages/nova/Nova_Data"
for child in "Nova Files" "Plug-ins"; do
    target="$DATA/$child"
    source="$CANONICAL/$child"
    if [[ ! -e "$source" ]]; then
        echo "!! canonical data missing: $source" >&2
        exit 1
    fi
    if [[ -L "$target" ]]; then
        echo "== $child: already linked -> $(readlink "$target")"
    elif [[ -e "$target" ]]; then
        echo "!! $target exists and is not a symlink; refusing to touch it" >&2
        exit 1
    else
        ln -sh "$source" "$target"
        echo "== $child: linked"
    fi
done

echo "== npm ci"
npm ci --no-audit --no-fund 2>&1 | tail -1
echo "== build"
npx turbo run build 2>&1 | grep -E "Tasks:|error" | tail -3

echo "== verify"
ls "$DATA/Nova Files" | head -2 | sed 's/^/   /'
# The sibling packages must resolve INSIDE this worktree, not the main checkout.
for spec in novaparse novadatainterface/base_data nova_ecs/world; do
    pkg="${spec%%/*}"
    resolved="$(cd packages/nova && node -e "console.log(require('path').dirname(require.resolve('$spec')))" 2>/dev/null || true)"
    case "$resolved" in
        "$ROOT"/*) echo "   $pkg -> $resolved" ;;
        *) echo "!! $pkg resolves outside this worktree: '$resolved'" >&2; exit 1 ;;
    esac
done
echo "== ready"
