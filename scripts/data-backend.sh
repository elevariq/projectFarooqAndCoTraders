#!/usr/bin/env bash
# THE SWITCH: where does the ERP keep its business data — in each browser ("browser", today's behaviour) or
# on the company server ("server")?  It is one line in the server's private/erp-config.php, read on EVERY
# request, so flipping it takes effect at once with no redeploy — and flipping back is just as fast.
#
#   scripts/data-backend.sh status   what it says now, and whether the server database is ready
#   scripts/data-backend.sh on       'data_backend' => 'server'   (refuses unless the database holds an imported backup)
#   scripts/data-backend.sh off      'data_backend' => 'browser'  (the emergency exit; always allowed)
#
# What "on" does to users: their next page load asks api/data/status.php, sees "server", and loads everything
# from the database instead of the browser. Their old browser copy is left untouched (it is a frozen snapshot
# from the moment of cutover — see docs/OPERATIONS.md → "Cutover"). Anyone already using the app keeps their
# old page until they reload it; the first save from such a page is the browser database's, so do the cutover
# when nobody is entering data.
#
# Before "on": deploy-api.sh and deploy-erp.sh (so the new browser code exists), then import the FRESH backup
# (scripts/import-backup.php --commit).  "on" checks the database is non-empty and initialised.
set -euo pipefail
SSH_HOST="u943531942@31.97.219.57"; SSH_PORT=65002
REMOTE_CFG="/home/u943531942/domains/farooqandcotraders.online/private/erp-config.php"
REMOTE_API="/home/u943531942/domains/farooqandcotraders.online/public_html/ERP/api"
rssh() { ssh -p "$SSH_PORT" -o BatchMode=yes "$SSH_HOST" "$@"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

current() { rssh "php -r '\$c = require \"$REMOTE_CFG\"; echo array_key_exists(\"data_backend\", \$c) ? var_export(\$c[\"data_backend\"], true) : \"(absent = browser)\";'"; }

# what the business database holds (counts only — never the data itself)
db_facts() {
  rssh "php -r '
    \$c = require \"$REMOTE_CFG\"; \$b = \$c[\"biz_db\"];
    \$p = new PDO(\"mysql:host={\$b[\"host\"]};port={\$b[\"port\"]};dbname={\$b[\"name\"]};charset=utf8mb4\", \$b[\"user\"], \$b[\"pass\"], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    \$n = fn(\$t) => (int)\$p->query(\"SELECT COUNT(*) FROM \$t\")->fetchColumn();
    \$mig = \$p->query(\"SELECT doc FROM meta WHERE pk = \\\"migration\\\"\")->fetchColumn();
    echo \"products=\" . \$n(\"products\") . \" customers=\" . \$n(\"customers\") . \" invoices=\" . \$n(\"invoices\") . \" migration_flag=\" . (\$mig ? \"yes\" : \"NO\") . \" version=\" . \$p->query(\"SELECT v FROM data_version WHERE id=1\")->fetchColumn();
  '"
}

set_backend() {  # $1 = server|browser
  local val="$1" ts; ts="$(date +%Y%m%d%H%M%S)"
  rssh "cp -p '$REMOTE_CFG' '$REMOTE_CFG.bak-$ts' && \
    if grep -q \"^[[:space:]]*'data_backend'\" '$REMOTE_CFG'; then sed -i \"s/^\\([[:space:]]*\\)'data_backend'.*\\\$/\\1'data_backend' => '$val',/\" '$REMOTE_CFG'; \
    else sed -i \"0,/^return \\[/s//return [\\n    'data_backend' => '$val',/\" '$REMOTE_CFG'; fi && php -l '$REMOTE_CFG' >/dev/null" \
    || die "could not edit the config (a copy was taken alongside as erp-config.php.bak-$ts — restore it if the site misbehaves)."
  local now; now="$(current)"
  [ "$now" = "'$val'" ] || die "config now says $now, expected '$val'. Restore erp-config.php.bak-$ts."
  echo "==> data_backend is now '$val'   (previous config kept as erp-config.php.bak-$ts)"
}

case "${1:-status}" in
  status)
    echo "data_backend : $(current)"
    echo "database     : $(db_facts)"
    echo "API deployed : $(rssh "[ -f '$REMOTE_API/data/commit.php' ] && echo yes || echo NO")" ;;
  on)
    rssh "[ -f '$REMOTE_API/data/commit.php' ]" || die "the data API is not on the server yet — run scripts/deploy-api.sh first."
    facts="$(db_facts)"; echo "database: $facts"
    echo "$facts" | grep -q "migration_flag=yes" || die "the database has no initialised company data (no meta.migration). Import the backup first: scripts/import-backup.php."
    echo "$facts" | grep -Eq "products=[1-9]" || die "the database has no products — import the backup first."
    set_backend server
    echo "DONE. From now on every page load uses the server database. Emergency exit: scripts/data-backend.sh off"
    echo "Next: open the ERP in a REAL browser, sign in, and check the shops, products and invoices are there." ;;
  off)
    set_backend browser
    echo "DONE. Browsers are back on their own local database on their next page load."
    echo "NOTE: anything saved on the server since the switch is NOT in the browsers' local copies."
    echo "      To keep it: take 'Backup Database' from a server-mode page first, or export on the server." ;;
  *) die "usage: $0 status|on|off" ;;
esac
