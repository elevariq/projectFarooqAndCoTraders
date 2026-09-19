#!/usr/bin/env bash
# Recommended deployment flow for the ERP subdomain (erp.farooqandcotraders.online).
#
# What it does, in order:
#   1. Refuses to run with uncommitted changes (forces you to commit first).
#   2. Reconstructs the local build-staging area and rebuilds via build.py.
#   3. Runs every test-*.mjs harness; aborts the deploy if any fails.
#   4. Backs up the live files it's about to overwrite (timestamped, on the server).
#   5. Uploads the rebuilt files to ERP/_app/ (Phase 3 login gate: api/gate.php reads the app from
#      there, and the public URLs are rewritten to the gate — they are no longer files at the ERP
#      root) and, for parity, to the legacy app/ copy nothing else links to.
#      It REFUSES to run if _app/ isn't on the server yet (run scripts/gate-rollout.sh migrate
#      first): it must never drop the app back at the ERP root, where nothing protects it.
#   6. Clears the Hostinger CDN/server cache so the change is visible immediately.
#   7. Curls both live URLs to confirm a 200 after deploy.
#
# IMPORTANT (found 2026-09-16): the live document root for erp.farooqandcotraders.online is
# public_html/ERP/ itself — index.html and farooq-co-erp.html sitting directly in that folder,
# not public_html/ERP/app/. The app/ folder was part of the original site pull and nothing on
# the server links to it; it was mistakenly treated as the deploy target in an earlier session,
# so real feature deploys were landing there while the site kept serving the untouched root
# copy. This script now uploads to both, with the root copy as the one that matters.
#
# Usage: scripts/deploy-erp.sh
# Run from the repo root. Requires: git, python3, node, ssh, scp, curl.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERP_DIR="$REPO_ROOT/public_html/ERP"
UPGRADE_DIR="$ERP_DIR/erp-upgrade"
SSH_HOST="u943531942@31.97.219.57"
SSH_PORT=65002
REMOTE_ERP="/home/u943531942/domains/farooqandcotraders.online/public_html/ERP"

cd "$REPO_ROOT"

# One deploy at a time. Two runs share erp-upgrade/dist and the same *.uploading names on the server;
# on 2026-09-20 two overlapping runs made one fail at the final rename ("cannot stat ...uploading").
# The lock lives in .git/ so it never shows up as an uncommitted change.
LOCK="$REPO_ROOT/.git/deploy-erp.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Refusing to deploy: another deploy is already running (lock: $LOCK)." >&2
  echo "If you are sure none is, remove the folder and retry." >&2
  exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

echo "==> Checking for uncommitted changes"
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to deploy: you have uncommitted changes. Commit (and push) first." >&2
  git status --short
  exit 1
fi

echo "==> Reconstructing build inputs"
cd "$UPGRADE_DIR"
mkdir -p mod
cp [0-9]*.js mod/
cp ../app/farooq-co-erp.html ../app/index.html \
   ../app/farooq-co-warehouse-pwa.html ../app/farooq-and-co-homepage.html \
   ../app/farooq-erp-data.js .

echo "==> Building"
rm -rf dist
python3 build.py

echo "==> Running full test suite (any failure aborts the deploy)"
if [ ! -d node_modules/jsdom ]; then
  npm install jsdom fake-indexeddb --no-save
fi
for f in test-*.mjs; do
  echo "--- $f ---"
  node "$f"
done

echo "==> Checking the login-gate layout exists on the server (ERP/_app/ and api/gate.php)"
if ! ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" "test -d '$REMOTE_ERP/_app' && test -f '$REMOTE_ERP/api/gate.php'"; then
  echo "Refusing to deploy: $REMOTE_ERP/_app or api/gate.php is missing on the server." >&2
  echo "Run scripts/gate-rollout.sh migrate first — this script must not put the app back at the ERP root." >&2
  exit 1
fi

echo "==> All tests passed. Backing up live files before overwrite"
TS="$(date +%Y%m%d%H%M%S)"
ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" \
  "mkdir -p /home/u943531942/backups/erp-deploy-$TS && \
   cp '$REMOTE_ERP/_app/index.html' '$REMOTE_ERP/_app/farooq-co-erp.html' '$REMOTE_ERP/_app/farooq-erp-data.js' \
     /home/u943531942/backups/erp-deploy-$TS/ 2>/dev/null; \
   cp -r '$REMOTE_ERP/app' /home/u943531942/backups/erp-deploy-$TS/app"

echo "==> Uploading rebuilt files to ERP/_app/ (what api/gate.php serves — the public URLs are rewritten to it)"
# Upload under temporary names, then rename in one step: a visitor loading the page mid-upload
# would otherwise be served a half-written 3 MB file. (rename is atomic on the same filesystem)
for f in index.html farooq-co-erp.html farooq-erp-data.js; do
  scp -P "$SSH_PORT" -o BatchMode=yes "dist/$f" "$SSH_HOST:$REMOTE_ERP/_app/$f.uploading"
done
ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" \
  "cd '$REMOTE_ERP/_app' && for f in index.html farooq-co-erp.html farooq-erp-data.js; do mv -f \"\$f.uploading\" \"\$f\"; done"

echo "==> Uploading the same build to app/ too (legacy copy, kept in sync for parity)"
scp -P "$SSH_PORT" -o BatchMode=yes \
  dist/farooq-co-erp.html dist/index.html dist/farooq-co-warehouse-pwa.html \
  dist/farooq-and-co-homepage.html dist/farooq-erp-data.js \
  "$SSH_HOST:$REMOTE_ERP/app/"

echo "==> Clearing Hostinger cache (CDN can otherwise serve the old version)"
echo "    NOTE: run this from Claude via the hosting_clearWebsiteCacheV1 MCP tool"
echo "    for erp.farooqandcotraders.online, or clear it manually in hPanel."

echo "==> Verifying"
sleep 2
for url in "https://farooqandcotraders.online/" "https://erp.farooqandcotraders.online/"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url")"
  echo "  $url -> $code   (200 while the gate is dormant; 401 once enforcing — that is the sign-in page)"
done

echo "==> Done. Backup of the previous live files is at /home/u943531942/backups/erp-deploy-$TS on the server."
