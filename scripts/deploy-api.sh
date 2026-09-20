#!/usr/bin/env bash
# Deploy the PHP auth/gate files (public_html/ERP/api/**) to the live server — safely.
#
# scripts/deploy-erp.sh ships only the app files (_app/). The PHP lives here instead, and it is the live
# sign-in path, so this script treats it accordingly:
#   1. refuses to run if public_html/ERP/api has uncommitted changes (what is uploaded must equal what is committed);
#   2. backs up the server's whole api/ folder to /home/u943531942/backups/api-<timestamp>/;
#   3. uploads the files, then lints EVERY php file with the server's own PHP;
#   4. exercises the live endpoints WITHOUT needing any password:
#        - the sign-in page is served (401 while enforcing) and is a real <form> posting to login.php;
#        - a browser-style form post with empty fields is answered with a 303 to ?signin=empty;
#        - the app's own JSON sign-in with empty fields is still a 400 JSON answer;
#        - me.php still answers (401 signed out);
#        (none of these records a failed attempt, so they cannot lock anyone out)
#   5. on ANY failure it puts the backed-up files back and exits non-zero.
#
# Usage: scripts/deploy-api.sh            (run from anywhere in the repo)
#        scripts/deploy-api.sh rollback   (restore the most recent api backup)
# NOTE: probes are plain requests (no gzip) on purpose: the Hostinger CDN answers gzip-accepting curl with
# 403 even on the original site (see CLAUDE.md). A real-browser check is still the final word.
set -euo pipefail

# Git Bash on Windows rewrites arguments shaped like key=/path into key=C:/Program Files/Git/path, which mangled
# this script's form-post probe on 2026-09-20 (the server rightly rejected the bogus "next" and the check failed).
# No-op everywhere else.
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERP_DIR="$REPO_ROOT/public_html/ERP"
SSH_HOST="u943531942@31.97.219.57"
SSH_PORT=65002
REMOTE_ERP="/home/u943531942/domains/farooqandcotraders.online/public_html/ERP"
BACKUPS="/home/u943531942/backups"
SITE="https://erp.farooqandcotraders.online"
FILES=(_bootstrap.php _session.php _gate_login.php gate.php auth/login.php auth/me.php auth/logout.php \
       auth/ticket.php auth/change-password.php auth/users.php)

rssh() { ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" "$@"; }
rscp() { scp -P "$SSH_PORT" -o BatchMode=yes "$@"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

restore_from() {  # $1 = backup dir on the server
  echo "==> Restoring the previous api/ files from $1" >&2
  rssh "cp -pr '$1/api/.' '$REMOTE_ERP/api/'" || die "RESTORE FAILED — copy $1/api/ back into $REMOTE_ERP/api/ by hand."
}

if [ "${1:-}" = "rollback" ]; then
  BK="$(rssh "ls -1dt $BACKUPS/api-* 2>/dev/null | head -1")"
  [ -n "$BK" ] || die "no api backup found."
  restore_from "$BK"; echo "Restored from $BK."; exit 0
fi

cd "$REPO_ROOT"
# Only the PHP folder matters here (this script uploads nothing else), so unrelated uncommitted work elsewhere in
# the repo — e.g. app-module edits in progress — must not block it. What is uploaded must equal what is committed.
[ -z "$(git status --porcelain -- public_html/ERP/api)" ] || die "uncommitted changes under public_html/ERP/api — commit first."
for f in "${FILES[@]}"; do [ -f "$ERP_DIR/api/$f" ] || die "missing local file api/$f"; done

TS="$(date +%Y%m%d%H%M%S)"; BK="$BACKUPS/api-$TS"
echo "==> Backing up the server's api/ to $BK"
rssh "mkdir -p '$BK' && cp -pr '$REMOTE_ERP/api' '$BK/api'"

echo "==> Uploading ${#FILES[@]} files"
for f in "${FILES[@]}"; do rscp "$ERP_DIR/api/$f" "$SSH_HOST:$REMOTE_ERP/api/$f"; done

echo "==> Linting every PHP file with the server's own PHP"
if ! rssh "cd '$REMOTE_ERP/api' && for f in *.php auth/*.php; do php -l \"\$f\" >/dev/null || { echo \"LINT FAILED: \$f\"; exit 1; }; done; echo lint ok"; then
  restore_from "$BK"; die "PHP lint failed on the server — previous files restored."
fi

echo "==> Exercising the live endpoints (no password needed; nothing here records a failed attempt)"
bad=0
page="$(curl -s -m 60 "$SITE/?probe=$RANDOM")"; pst="$(curl -s -m 60 -o /dev/null -w '%{http_code}' "$SITE/?probe=$RANDOM")"
if echo "$page" | grep -q 'action="api/auth/login.php"' && echo "$page" | grep -q 'method="post"'; then
  echo "  OK    the sign-in page is a real form posting to login.php (HTTP $pst)"
elif [ "$pst" = "200" ]; then
  echo "  OK    the gate is dormant, so the app is served directly (HTTP 200) — sign-in page not applicable"
else echo "  FAIL  / is HTTP $pst and is not the expected sign-in form"; bad=1; fi

loc="$(curl -s -m 60 -o /dev/null -w '%{http_code} %{redirect_url}' -d 'username=&password=&next=%2F%3Fapp%3Derp' "$SITE/api/auth/login.php")"
if [ "$loc" = "303 $SITE/?app=erp&signin=empty" ]; then echo "  OK    a form post is answered with a 303 back to the page with ?signin=empty"
else echo "  FAIL  form post answered '$loc' (expected '303 $SITE/?app=erp&signin=empty')"; bad=1; fi

j="$(curl -s -m 60 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' "$SITE/api/auth/login.php")"
if [ "$j" = "400" ]; then echo "  OK    the app's JSON sign-in path still answers 400 JSON for empty fields"
else echo "  FAIL  JSON sign-in path answered HTTP $j (expected 400)"; bad=1; fi

m="$(curl -s -m 60 -o /dev/null -w '%{http_code}' "$SITE/api/auth/me.php")"
if [ "$m" = "401" ] || [ "$m" = "200" ]; then echo "  OK    me.php answers (HTTP $m)"; else echo "  FAIL  me.php answered HTTP $m"; bad=1; fi

if [ "$bad" != 0 ]; then restore_from "$BK"; die "a live check failed — previous files restored. Backup kept at $BK."; fi
echo
echo "DONE — api/ deployed. Backup: $BK   (undo with: scripts/deploy-api.sh rollback)"
echo "Clear the Hostinger cache, then check in a REAL private window: sign in, and the browser should now offer to save the password."
