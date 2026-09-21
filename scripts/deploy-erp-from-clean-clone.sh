#!/usr/bin/env bash
# Deploy the ERP app from a CLEAN CLONE of what is committed on main — the recipe from CLAUDE.md
# ("deploy-erp.sh refuses to run with ANY uncommitted change") turned into one command, so a shared working
# tree with someone else's half-finished edits can never leak into, or block, a deploy.
#
# What it does:
#   1. Pre-flight (read-only): the working tree must be clean, local main must equal origin/main (nothing
#      unpushed), and erp-upgrade/node_modules must exist. Anything else stops it before anything is touched.
#   2. Clones the repo to a temp folder, copies node_modules in, and runs THAT clone's scripts/deploy-erp.sh
#      (build -> every test-*.mjs must pass -> back up live files -> atomic upload -> probe).
#   3. Compares the md5 of the three served files on the server with the build's dist/ copies.
#   4. Tells you what is left: clearing the Hostinger cache for erp.farooqandcotraders.online.
#
# It does NOT deploy PHP (that is scripts/deploy-api.sh) and it never pushes or commits.
#
# Usage:
#   scripts/deploy-erp-from-clean-clone.sh --check   # pre-flight only; changes nothing; exit 0 = ready
#   scripts/deploy-erp-from-clean-clone.sh           # the deploy (10-15 min: run it detached, watch the log)
#
# Detached from a Windows shell (so a tool timeout cannot kill it mid-upload). NOTE the embedded \" around the whole
# bash command: without them PowerShell splits '-c' and the command into two arguments, bash runs just "cd" and the
# launch silently does nothing (hit on 2026-09-21; this exact form was tested with --check):
#   powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath 'C:\Program Files\Git\bin\bash.exe' -ArgumentList '-c','\"cd /d/projectFarooqAndCoTraders && bash scripts/deploy-erp-from-clean-clone.sh\"'"
# Log: .git/deploy-logs/erp-latest.log (tail it; the last line says DEPLOY FINISHED or DEPLOY FAILED).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="u943531942@31.97.219.57"
SSH_PORT=65002
REMOTE_APP="/home/u943531942/domains/farooqandcotraders.online/public_html/ERP/_app"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

cd "$REPO_ROOT"

preflight() {
  local ok=1
  git fetch -q origin || { echo "  x could not reach GitHub (git fetch failed)"; return 1; }
  if [ -n "$(git status --porcelain)" ]; then
    echo "  x the working tree has uncommitted changes — another session or you are still editing:"
    git status --short | sed 's/^/      /'
    echo "    (they would NOT be deployed; wait until they are committed and pushed)"
    ok=0
  else
    echo "  ok working tree is clean"
  fi
  local branch; branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$branch" != "main" ]; then echo "  x you are on '$branch', not main"; ok=0; else echo "  ok on main"; fi
  local ahead behind
  ahead="$(git rev-list --count origin/main..HEAD)"; behind="$(git rev-list --count HEAD..origin/main)"
  if [ "$ahead" != "0" ]; then echo "  x $ahead local commit(s) are not pushed yet — push first"; ok=0; fi
  if [ "$behind" != "0" ]; then echo "  x origin/main has $behind newer commit(s) — pull first"; ok=0; fi
  if [ "$ahead" = "0" ] && [ "$behind" = "0" ]; then echo "  ok local main = origin/main ($(git rev-parse --short HEAD))"; fi
  if [ ! -d public_html/ERP/erp-upgrade/node_modules/jsdom ]; then
    echo "  x public_html/ERP/erp-upgrade/node_modules/jsdom is missing (cd there; npm install jsdom fake-indexeddb --no-save)"; ok=0
  else echo "  ok test dependencies present"; fi
  [ "$ok" = "1" ]
}

echo "==> Pre-flight"
if ! preflight; then echo "NOT READY — nothing was changed."; exit 1; fi
if [ "$CHECK_ONLY" = "1" ]; then echo "READY — run this script without --check to deploy $(git rev-parse --short HEAD)."; exit 0; fi

# One deploy at a time — the same lock deploy-erp.sh uses, so a direct run from this folder is blocked too.
LOCK="$REPO_ROOT/.git/deploy-erp.lock"
if ! mkdir "$LOCK" 2>/dev/null; then echo "Refusing: another deploy holds $LOCK (remove it only if you are sure none runs)." >&2; exit 1; fi

mkdir -p "$REPO_ROOT/.git/deploy-logs"
LOG="$REPO_ROOT/.git/deploy-logs/erp-$(date +%Y%m%d%H%M%S).log"
cp /dev/null "$LOG"; cp "$LOG" "$REPO_ROOT/.git/deploy-logs/erp-latest.log" 2>/dev/null || true
exec > >(tee -a "$LOG" "$REPO_ROOT/.git/deploy-logs/erp-latest.log") 2>&1

TMP="$(mktemp -d)"
finish() {
  local rc=$?
  rmdir "$LOCK" 2>/dev/null || true
  if [ "$rc" = "0" ]; then rm -rf "$TMP"; echo "DEPLOY FINISHED"; else echo "DEPLOY FAILED (exit $rc) — clean clone kept at $TMP; log: $LOG"; fi
  sleep 1   # let the tee process flush the last line into the log
}
trap finish EXIT

COMMIT="$(git rev-parse --short HEAD)"
echo "==> Deploying commit $COMMIT from a clean clone in $TMP"
git clone -q --no-hardlinks "$REPO_ROOT" "$TMP/c"
cp -r "$REPO_ROOT/public_html/ERP/erp-upgrade/node_modules" "$TMP/c/public_html/ERP/erp-upgrade/node_modules"

( cd "$TMP/c" && bash ./scripts/deploy-erp.sh )

echo "==> Comparing the served files with this build (md5)"
cd "$TMP/c/public_html/ERP/erp-upgrade/dist"
# md5sum on Windows Git Bash prints "hash *file" (binary-mode marker), the server prints "hash file": drop a leading '*'
# from the file name on BOTH sides, or a good deploy is reported as MISMATCH (seen 2026-09-21).
norm() { awk '{sub(/^\*/, "", $2); print $1"  "$2}'; }
LOCAL="$(md5sum index.html farooq-co-erp.html farooq-erp-data.js | norm)"
REMOTE="$(ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" "cd '$REMOTE_APP' && md5sum index.html farooq-co-erp.html farooq-erp-data.js" | norm)"
echo "build : "; echo "$LOCAL" | sed 's/^/   /'
echo "server: "; echo "$REMOTE" | sed 's/^/   /'
if [ "$LOCAL" = "$REMOTE" ]; then echo "  md5 MATCH — the server is serving exactly commit $COMMIT."; else echo "  md5 MISMATCH — do not assume the deploy is good; compare above." >&2; exit 2; fi

echo "==> LEFT TO DO: clear the Hostinger cache for erp.farooqandcotraders.online (hosting_clearWebsiteCacheV1 or hPanel)."
