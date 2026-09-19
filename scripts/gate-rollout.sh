#!/usr/bin/env bash
# Phase 3 login-gate rollout for erp.farooqandcotraders.online — staged, each stage reversible.
#
#   scripts/gate-rollout.sh status        read-only: what the site and the kill-switch look like right now
#   scripts/gate-rollout.sh migrate       install the gate DORMANT. Nothing changes for anyone: the same
#                                         four URLs still return the same bytes, they just travel through
#                                         api/gate.php now. Auto-restores the old .htaccess if any check fails.
#   scripts/gate-rollout.sh enforce-on    flip the kill-switch: sign-in becomes mandatory.
#   scripts/gate-rollout.sh enforce-off   flip it back: the app is open to everyone again (emergency exit —
#                                         instant, no redeploy).
#   scripts/gate-rollout.sh rollback      undo `migrate` entirely: old .htaccess and root files restored.
#
# Order: migrate -> (clear Hostinger cache) -> verify by hand -> enforce-on -> (clear cache) -> verify.
# The script cannot call the Hostinger MCP: clear the CDN cache for erp.farooqandcotraders.online from a
# Claude session (hosting_clearWebsiteCacheV1) or hPanel after `migrate` and after `enforce-on`.
# See docs/OPERATIONS.md "Phase 3 rollout" for the full checklist and what to look for.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERP_DIR="$REPO_ROOT/public_html/ERP"
SSH_HOST="u943531942@31.97.219.57"
SSH_PORT=65002
DOMAIN_DIR="/home/u943531942/domains/farooqandcotraders.online"
REMOTE_ERP="$DOMAIN_DIR/public_html/ERP"
REMOTE_CFG="$DOMAIN_DIR/private/erp-config.php"
BACKUPS="/home/u943531942/backups"
SITE="https://erp.farooqandcotraders.online"
APP_FILES=(index.html farooq-co-erp.html farooq-erp-data.js)

rssh() { ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" "$@"; }
rscp() { scp -P "$SSH_PORT" -o BatchMode=yes "$@"; }
# Every probe imitates a real browser: a browser User-Agent and gzip accepted. This is not cosmetic — on
# 2026-09-20 the first `migrate` passed its checks and left the site returning 403 to EVERY real browser,
# because the checks were bare curl requests (no Accept-Encoding) and the CDN answered those differently.
BROWSER_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
code() { curl -s -I -m 90 -A "$BROWSER_UA" -H 'Accept-Encoding: gzip, deflate, br' -o /dev/null -w '%{http_code}' "$1"; }   # HEAD: status only
bcurl() { curl -s -m 300 -A "$BROWSER_UA" --compressed "$@"; }     # full GET the way a browser makes it
die()  { echo "ERROR: $*" >&2; exit 1; }

# browser_check URL EXPECTED_MD5 — GET the way a browser does (UA + gzip). Passes only on HTTP 200 AND identical bytes.
browser_check() {
  local url="$1" want="$2" tmp st got same; tmp="$(mktemp)"
  st="$(bcurl -o "$tmp" -w '%{http_code}' "$url?verify=$RANDOM")" || st="000"
  got="$(md5sum < "$tmp" | cut -d' ' -f1)"; rm -f "$tmp"
  if [ "$want" = "$got" ]; then same="identical bytes"; else same="DIFFERENT bytes"; fi
  if [ "$st" = "200" ] && [ "$want" = "$got" ]; then
    echo "  OK    ${url#$SITE} (browser-style: gzip + browser UA -> 200, $same)"; return 0
  fi
  echo "  FAIL  ${url#$SITE} (browser-style request -> HTTP $st, $same)"; return 1
}

show_urls() {
  local u
  for u in / /index.html /farooq-co-erp.html /farooq-erp-data.js /_app/index.html /api/auth/me.php /README.md; do
    printf '  %-26s %s\n' "$u" "$(code "$SITE$u")"
  done
}

kill_switch_state() {
  rssh "php -r '\$c = require \"$REMOTE_CFG\"; echo array_key_exists(\"enforce_login\", \$c) ? var_export(\$c[\"enforce_login\"], true) : \"(absent = dormant)\";'"
}

cmd_status() {
  echo "Kill-switch (enforce_login): $(kill_switch_state)"
  echo "Public URLs (dormant: 200 for the first four; enforced: 401 for them; /_app must be 403 either way):"
  show_urls
  echo "Server layout:"
  rssh "cd '$REMOTE_ERP' && ls -la _app 2>&1 | head -8; ls api/gate.php 2>&1; grep -c 'gate.php' .htaccess 2>&1 | sed 's/^/gate rules in .htaccess: /'"
}

cmd_migrate() {
  cd "$REPO_ROOT"
  [ -z "$(git status --porcelain)" ] || die "uncommitted changes — commit first."
  local f
  for f in .htaccess _app/.htaccess api/gate.php api/_gate_login.php api/_bootstrap.php api/_session.php api/auth/login.php api/auth/me.php; do
    [ -f "$ERP_DIR/$f" ] || die "missing local file $f"
  done

  if ! rssh "test -f '$REMOTE_ERP/index.html' && test -f '$REMOTE_ERP/farooq-co-erp.html'"; then
    die "the app files are not at the ERP root — it looks like this was already migrated. Use 'status'. (migrate is a one-time step; for later PHP/.htaccess changes, scp them by hand.)"
  fi

  local TS BK; TS="$(date +%Y%m%d%H%M%S)"; BK="$BACKUPS/gate-$TS"
  echo "==> Backing up what will change to $BK"
  rssh "mkdir -p '$BK' && cd '$REMOTE_ERP' && cp -p .htaccess index.html farooq-co-erp.html farooq-erp-data.js '$BK/' && cp -pr api '$BK/api' && echo '$BK' > '$BACKUPS/gate-latest.txt'"

  echo "==> Creating _app/ and copying the LIVE app files into it (exact bytes on the server, not a rebuild)"
  rssh "mkdir -p '$REMOTE_ERP/_app' && cd '$REMOTE_ERP' && cp -p index.html farooq-co-erp.html farooq-erp-data.js _app/"
  rscp "$ERP_DIR/_app/.htaccess" "$SSH_HOST:$REMOTE_ERP/_app/.htaccess"

  echo "==> Uploading the gate and the two updated endpoints (dormant until .htaccess routes to it)"
  rscp "$ERP_DIR/api/gate.php" "$ERP_DIR/api/_gate_login.php" "$ERP_DIR/api/_bootstrap.php" "$ERP_DIR/api/_session.php" "$SSH_HOST:$REMOTE_ERP/api/"
  rscp "$ERP_DIR/api/auth/login.php" "$ERP_DIR/api/auth/me.php" "$SSH_HOST:$REMOTE_ERP/api/auth/"

  echo "==> Linting every PHP file with the server's own PHP before anything is routed to it"
  rssh "cd '$REMOTE_ERP/api' && for f in *.php auth/*.php; do php -l \"\$f\" >/dev/null || { echo \"LINT FAILED: \$f\"; exit 1; }; done; echo lint ok" \
    || die "PHP lint failed on the server; .htaccess NOT changed. (The two updated endpoints are already in place and backward compatible; restore from $BK if you want them gone.)"

  echo "==> Routing the public URLs through the gate (dormant)"
  rscp "$ERP_DIR/.htaccess" "$SSH_HOST:$REMOTE_ERP/.htaccess"

  echo "==> Verifying: same status and IDENTICAL bytes for each app URL, /_app denied"
  local bad=0 url want got st
  for f in "${APP_FILES[@]}"; do
    url="/$f"
    want="$(rssh "md5sum '$REMOTE_ERP/_app/$f' | cut -d' ' -f1")"
    got="$(curl -s -m 300 "$SITE$url?verify=$RANDOM" | md5sum | cut -d' ' -f1)"
    if [ "$want" = "$got" ]; then echo "  OK    $url (plain request)"; else echo "  FAIL  $url (bytes differ, plain request)"; bad=1; fi
    browser_check "$SITE$url" "$want" || bad=1
  done
  want="$(rssh "md5sum '$REMOTE_ERP/_app/index.html' | cut -d' ' -f1")"
  got="$(curl -s -m 300 "$SITE/?verify=$RANDOM" | md5sum | cut -d' ' -f1)"
  if [ "$want" = "$got" ]; then echo "  OK    /"; else echo "  FAIL  / (bytes differ)"; bad=1; fi
  local wire; wire="$(bcurl -o /dev/null -w '%{http_code} %{size_download}' "$SITE/?sz=$RANDOM")"
  echo "  INFO  browser-style GET / -> HTTP ${wire%% *}, ${wire##* } bytes on the wire (a 3 MB app should be well under 1 MB gzipped)"
  [ "${wire%% *}" = "200" ] || { echo "  FAIL  browser-style GET / is not 200"; bad=1; }
  [ "$(code "$SITE/_app/index.html")" = "403" ] && echo "  OK    /_app/index.html is 403" || { echo "  FAIL  /_app/index.html is not 403"; bad=1; }
  [ "$(code "$SITE/api/auth/me.php")" = "401" ] && echo "  OK    /api/auth/me.php still answers 401 (API healthy)" || { echo "  FAIL  me.php not 401"; bad=1; }

  if [ "$bad" != 0 ]; then
    echo "==> A check failed — restoring the previous .htaccess NOW" >&2
    rssh "cp -p '$BK/.htaccess' '$REMOTE_ERP/.htaccess'"
    die "migrate aborted and undone (site is back on plain static files; root copies were never removed)."
  fi

  echo "==> Gate is routing correctly. Removing the now-unreachable public copies at the ERP root"
  echo "    (so enforcing can't be undermined by a stray static copy if the rewrite ever stopped applying)"
  rssh "cd '$REMOTE_ERP' && rm -f index.html farooq-co-erp.html farooq-erp-data.js"
  echo "==> Re-verifying with the root copies gone (proves the rewrite is what serves the app)"
  bad=0
  for url in / /index.html /farooq-co-erp.html /farooq-erp-data.js; do
    [ "$(code "$SITE$url?v=$RANDOM")" = "200" ] && echo "  OK    $url 200" || { echo "  FAIL  $url"; bad=1; }
  done
  if [ "$bad" != 0 ]; then
    echo "==> Root copies gone and the app URLs failed — putting them back NOW" >&2
    rssh "cd '$REMOTE_ERP' && cp -p _app/index.html _app/farooq-co-erp.html _app/farooq-erp-data.js . && cp -p '$BK/.htaccess' .htaccess"
    die "migrate undone."
  fi
  echo
  echo "DONE — gate installed DORMANT. Backup: $BK"
  echo "Next: clear the Hostinger cache for erp.farooqandcotraders.online, open the app in a browser and use it"
  echo "for a minute, then run: scripts/gate-rollout.sh enforce-on"
}

# The shell text that edits the server config: back it up, replace the enforce_login line if there is one,
# otherwise insert it right after `return [`, then syntax-check. Kept as a plain generator so it can be run
# against a scratch copy of the config on a dev machine (that is exactly how it is tested).
config_edit_cmd() {  # $1 = config path, $2 = true|false, $3 = backup suffix
  cat <<CMD
cp -p '$1' '$1.bak-$3' && if grep -q "^[[:space:]]*'enforce_login'" '$1'; then sed -i "s/^\([[:space:]]*\)'enforce_login'.*\$/\1'enforce_login' => $2,/" '$1'; else sed -i "0,/^return \[/s//return [\n    'enforce_login' => $2,/" '$1'; fi && php -l '$1' >/dev/null
CMD
}

set_enforce() {  # $1 = true|false
  local val="$1"
  echo "==> Backing up the server config, then setting enforce_login => $val"
  rssh "$(config_edit_cmd "$REMOTE_CFG" "$val" "$(date +%Y%m%d%H%M%S)")" \
    || die "could not edit the config (it was backed up alongside as erp-config.php.bak-*)."
  local now; now="$(kill_switch_state)"
  [ "$now" = "$val" ] || die "config now says '$now', expected '$val'. Restore the .bak-* copy next to it."
  echo "    kill-switch is now: $now"
}

cmd_enforce_on() {
  [ "$(code "$SITE/_app/index.html")" = "403" ] || die "the gate isn't installed (run migrate first)."
  # migrate copies the LIVE app bytes into _app/ — which predate the enforce-mode client. Enforcing with that
  # old client would work but has no heartbeat, no Sign out and a live user-switch chip.
  rssh "grep -q 'SESSION HEARTBEAT' '$REMOTE_ERP/_app/farooq-co-erp.html'" \
    || die "the app on the server doesn't have the enforce-mode client yet — run scripts/deploy-erp.sh first."
  local n; n="$(rssh "php -r '\$c = require \"$REMOTE_CFG\"; \$d=\$c[\"db\"]; \$p=new PDO(\"mysql:host={\$d[\"host\"]};port={\$d[\"port\"]};dbname={\$d[\"name\"]}\",\$d[\"user\"],\$d[\"pass\"]); echo \$p->query(\"SELECT COUNT(*) FROM auth_users WHERE is_active=1\")->fetchColumn();'")"
  echo "==> $n active server account(s) exist. Everyone else is locked out the moment this flips."
  set_enforce true
  echo "==> Verifying signed-OUT visitors now get the sign-in page and none of the app or its data"
  local bad=0 url r
  for url in / /index.html /farooq-co-erp.html /farooq-erp-data.js; do
    r="$(code "$SITE$url?v=$RANDOM")"
    [ "$r" = "401" ] && echo "  OK    $url 401" || { echo "  FAIL  $url -> $r (expected 401)"; bad=1; }
  done
  if [ "$bad" != 0 ]; then
    echo "==> A gated URL is not 401 — reopening (enforce_login => false) so nobody is left half-locked" >&2
    set_enforce false
    die "enforce-on aborted and undone."
  fi
  echo
  echo "DONE — sign-in is now MANDATORY. Clear the Hostinger cache, then in a browser: sign in, use the app,"
  echo "and re-run 'status' — the URLs must STILL be 401 for a signed-out curl (proves the CDN isn't sharing"
  echo "signed-in copies). Emergency exit: scripts/gate-rollout.sh enforce-off"
}

cmd_enforce_off() { set_enforce false; echo "DONE — the app is open to everyone again. Clear the Hostinger cache."; show_urls; }

cmd_rollback() {
  local BK; BK="$(rssh "cat '$BACKUPS/gate-latest.txt'")" || die "no gate backup recorded."
  echo "==> Restoring the pre-gate layout from $BK"
  rssh "cd '$REMOTE_ERP' && cp -p '$BK/.htaccess' .htaccess && cp -p _app/index.html _app/farooq-co-erp.html _app/farooq-erp-data.js . && echo restored"
  echo "==> The gate files stay in place but are inert. Public URLs now:"
  show_urls
  echo "Clear the Hostinger cache. (If you rolled back after enforce-on, also set enforce_login false or remove it.)"
}

case "${1:-}" in
  --browser-check) SITE="$2"; browser_check "$2$3" "$4" ;;   # test hook: <site> <path> <md5>
  --print-config-edit) config_edit_cmd "$2" "$3" "${4:-test}" ;;   # test hook: prints the remote command, runs nothing
  status)       cmd_status ;;
  migrate)      cmd_migrate ;;
  enforce-on)   cmd_enforce_on ;;
  enforce-off)  cmd_enforce_off ;;
  rollback)     cmd_rollback ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 2 ;;
esac
