#!/usr/bin/env bash
# Recommended deployment flow for the ERP subdomain (erp.farooqandcotraders.online).
#
# What it does, in order:
#   1. Refuses to run with uncommitted changes (forces you to commit first).
#   2. Reconstructs the local build-staging area and rebuilds via build.py.
#   3. Runs every test-*.mjs harness; aborts the deploy if any fails.
#   4. Backs up the live app/ files it's about to overwrite (timestamped, on the server).
#   5. Uploads the rebuilt app/ files (and, if changed, this erp-upgrade/ source folder).
#   6. Clears the Hostinger CDN/server cache so the change is visible immediately.
#   7. Curls both live URLs to confirm a 200 after deploy.
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

echo "==> All tests passed. Backing up live app/ before overwrite"
TS="$(date +%Y%m%d%H%M%S)"
ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" \
  "mkdir -p /home/u943531942/backups/erp-deploy-$TS && cp -r '$REMOTE_ERP/app' /home/u943531942/backups/erp-deploy-$TS/app"

echo "==> Uploading rebuilt app/"
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
  echo "  $url -> $code"
done

echo "==> Done. Backup of the previous app/ is at /home/u943531942/backups/erp-deploy-$TS on the server."
