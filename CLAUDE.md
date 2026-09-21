# Farooq & Co Traders — Project Reference

This file is auto-loaded by Claude Code whenever a session starts in this directory. Read it
before doing anything else. Details behind each section live in `docs/OPERATIONS.md`.

## What this project is

Two live sites on one Hostinger hosting account, owned by the user (theumairzero7@gmail.com,
GitHub: talhaazhar-ta):

- **`farooqandcotraders.online`** — public homepage (`public_html/index.html`).
- **`erp.farooqandcotraders.online`** — a subdomain pointing at `public_html/ERP`, serving a
  **ERP app whose business data now lives on the company MySQL database — the Warehouse tile too, since 2026-09-21** (since 2026-09-20 — see "MySQL database" below and
  `docs/SERVER_DATA.md`, the single current guide). The browser loads everything from the server at page load and saves through a small PHP
  API; each browser's old IndexedDB copy (`farooqco_erp_ledger`) is frozen and no longer used. The static HTML/JS files here are the
  *application code*, not the data. **The switch** is `'data_backend' => 'server'` in the server's `private/erp-config.php`
  (`scripts/data-backend.sh status|on|off`; `off` = each browser keeps its own data again, instantly). (Before 2026-09-20 the ERP was
  client-side only — that history is in `docs/OPERATIONS.md`.)

  **Since 2026-09-20 the ERP requires sign-in.** There is now a small PHP auth backend (accounts and
  sessions only, in its own MySQL database `u943531942_erpauth` — never business data) and a login
  gate in front of the app: an unauthenticated request — `curl`, a fresh browser — gets a `401`
  sign-in page instead of the app. So a plain `curl` health check now reports `401` (that means
  "healthy and gated"), and testing the live app needs a **signed-in real browser**. Note also that
  the Hostinger CDN answers gzip-accepting `curl` with `403` even for the original static site — don't
  read anything into that; use a real browser. Details, the kill-switch (`enforce-off`) and the
  rollout scripts: "Server-side authentication & authorization" below and `docs/OPERATIONS.md`.

Read `public_html/ERP/README.md` and `public_html/ERP/database/SCHEMA.md` for how the ERP itself
is built — 25+ upgrade modules injected into one original HTML file, documented per-module in that
README.

### These are NOT two separate filesystems — confirmed on the server

There is exactly one `farooqandcotraders.online` folder under `/home/u943531942/domains/` — no
second one for `erp.*`. Confirmed via `hosting_listWebsiteSubdomainsV1` and DNS:

```
/home/u943531942/domains/farooqandcotraders.online/
├── DO_NOT_UPLOAD_HERE           (empty marker file — don't put site files at this level)
├── farooq-co-erp-complete-v19.zip   (a full mirror of ERP/, ~1.6MB — not web-exposed, see below)
├── web/package/                 (empty leftover directory, harmless clutter — not investigated further)
└── public_html/                        <- document root for farooqandcotraders.online
    ├── index.html                      <- the homepage
    └── ERP/                            <- document root for erp.farooqandcotraders.online
        ├── index.html, farooq-co-erp.html   <- what's ACTUALLY served (see correction below)
        ├── farooq-erp-data.js               <- required by farooq-co-erp.html at this level
        ├── app/            (a legacy duplicate — nothing on the server links to it, see below)
        ├── erp-upgrade/    (source modules + build tooling — also web-exposed, but unlinked)
        ├── database/, data-exports/, docs/, samples/   (reference files, also web-exposed)
```

- **CORRECTION (found 2026-09-16, via a client report that shipped changes weren't showing up)**:
  an earlier session's note above — that `ERP/app/` is "what's actually served" — was wrong. The
  live document root for `erp.farooqandcotraders.online` is `public_html/ERP/` itself: Apache
  serves `ERP/index.html` and `ERP/farooq-co-erp.html` directly (no `.htaccess`, no redirect).
  `ERP/app/` was part of the very first live-server pull (it predates this project) and nothing
  on the server references it — it's an orphaned duplicate. `scripts/deploy-erp.sh` was uploading
  only to `ERP/app/`, so every deploy through it was landing on files nobody's browser ever
  loads, while the real root copy sat untouched since the initial import. Fixed 2026-09-16: the
  script now uploads to the real root first, and to `app/` second only for parity (harmless,
  since nothing serves from there). **If you ever add a new top-level file the app needs at
  runtime, it must exist at `ERP/` root, not just under `app/`.** *(Updated 2026-09-20: the claim
  that `farooq-erp-data.js` is "required alongside `farooq-co-erp.html`" was wrong — nothing loads
  it. And once the Phase 3 login gate is installed, the three app files —
  `index.html`, `farooq-co-erp.html`, `farooq-erp-data.js` — live in `ERP/_app/` and are reached
  only through `api/gate.php`; a NEW runtime file added at the root would be public, so anything
  that must be protected needs its own route in `.htaccess` + `gate.php`'s `GATE_FILES`.)*
- **DNS**: `@` and `erp` are both `ALIAS` records pointing at Hostinger's CDN
  (`*.cdn.hstgr.net`), which routes by hostname to the right document root on this one account.
  `erp` is not a different server or a different account — it's the same SSH login, same
  filesystem, same git repo.
- **Consequence for deploys**: uploading to `public_html/index.html` only affects the homepage;
  uploading to `public_html/ERP/*` only affects the ERP. They're independent *document roots*
  sharing one *account*, so a script that gets a path wrong could touch the wrong site — always
  double-check the target path.
- **Consequence for caching**: both sites sit behind Hostinger's CDN. After deploying, call
  `hosting_clearWebsiteCacheV1` (or clear cache in hPanel) or the CDN can keep serving the old
  version for a while. This is a real edge case that was previously undocumented — the deploy
  script below handles it.
- The `farooq-co-erp-complete-v19.zip` at the domain root (outside `public_html`, so not
  web-served) looks like an intentional single-file "download everything" export made at the same
  time as the last ERP update (matching timestamps) — left alone, just noted here so it isn't
  mistaken for stray/leaked data later. The empty `web/package/` directory looks like harmless
  leftover clutter from an earlier session; also left alone (not sensitive, not costing anything
  meaningful, low priority to clean up — ask the user before deleting anything on the server that
  wasn't created this session).

## MySQL database (provisioned 2026-09-15 — confirmed purpose: eventual replacement for the IndexedDB "file db")

A real server-side MySQL database now exists for this project. The user has confirmed its
purpose: **this replaces the client-side IndexedDB storage** the ERP used — from "each browser is the only copy of the data" to a real
shared server database. **That happened on 2026-09-20** (schema, data API, browser driver, importer, cutover — all built, tested and
live; see `docs/SERVER_DATA.md`). The paragraphs below are the original 2026-09-15 provisioning notes and are kept for the connection
details; where they say "not yet" / "nothing reads or writes it", that is history.

| | |
|---|---|
| Database / user | `u943531942_facotraders` (same name for both) |
| Host | `srv1774.hstgr.io` : `3306` (also reachable at `82.197.82.127`) |
| Permissions | Full: Select/Insert/Update/Delete/Create/Alter/Drop/Index/Create+Alter routine/Create+Show view/Trigger/Event/Lock tables/Execute/References/Create temporary tables |
| Remote access whitelist | `203.215.169.140` (this machine's outbound IP) and `%` (anywhere) — set up in hPanel → Databases → Remote MySQL before this session |
| Access from Claude Code | MCP server `dbhub-facotraders-theumairzero7@gmail.com` in the **global** `~/.claude.json` (`@bytebase/dbhub`). **Not in this git repo** — machine-level config, DSN has the password in plaintext, must never be copied into anything committed here. **Confirmed loaded and working after a session restart** (2026-09-15): tools `mcp__dbhub-facotraders-theumairzero7_gmail_com__execute_sql` and `..._search_objects` are callable. |
| Tested | Twice: once via a raw `mysql2` script before the restart, once via the actual MCP `execute_sql` tool after the restart. Both did a full `CREATE TABLE → INSERT → SELECT → UPDATE → DELETE → DROP TABLE` round trip successfully, then cleaned up. Server: MariaDB 11.8.9. **Since 2026-09-20: 46 tables** (`database/schema-mariadb.sql`, generated by `scripts/gen-mariadb-schema.mjs` — one table per IndexedDB store, full record in a `doc` JSON column plus generated indexed columns). The user has decided the server will be the **only** copy of the business data. **The client's backup `farooq-co-erp-backup-2026-09-20-mu9coyge.json` (exported 05:03 UTC) was imported and verified on 2026-09-20** (409 shops, 136 products, 32 suppliers, 2 invoices, 2 purchases, 2 payments, 102 audit rows; every record identical, 13 money/quantity totals equal, independently re-checked). **That is a rehearsal snapshot, not the live copy: the client's browser is still where the app saves, so this data goes stale.** **LIVE ON THE SERVER since 2026-09-20 (cutover done — `'data_backend' => 'server'`; instant rollback: `scripts/data-backend.sh off`).** Built the same day: a PHP data API (`api/_data.php`, `api/data/*.php`) and a browser driver (`erp-upgrade/01b-server-db.js`, module 1b) that runs the same `FDB` on this database. The switch is one line in the server's `private/erp-config.php` (`scripts/data-backend.sh status|on|off`; absent = browser). **Cutover was done without a fresh backup or re-import, by the user's decision** (the client had only entered 2 invoices, "will be added again"): the database already held the client's 2026-09-20 05:03 UTC import, so the switch was simply flipped and verified live — anything the client's browser held that was newer than that import is not on the server and should be re-entered. (For any future re-import: `scripts/empty-business-db.php` then `scripts/import-backup.php`; it refuses a non-empty database.) **The whole procedure, the design rules (revision-checked atomic saves, "NOT saved — reload" on failure, per-browser keys stay local, never fall back to the browser copy) and the known limits are in `docs/OPERATIONS.md` → "Server-side business data — how it works, and the CUTOVER runbook".** **Nightly verified backups run automatically** (Hostinger cron `65drF1UNgJ`, 02:00 Pakistan, to `~/backups/nightly/`; `docs/SERVER_DATA.md` §4) — on the same account, so keep an off-site copy occasionally. Production deploys (`deploy-api.sh`, `deploy-erp.sh`) and the switch: the permission layer sometimes blocks them; an explicit "run" from the user worked on 2026-09-20, otherwise hand over the `!` command. |

**Full migration plan, decisions needed, and step-by-step approach**: see
`docs/MYSQL_MIGRATION_PLAN.md`. Status: **done and live (2026-09-20)** apart from the follow-ups listed in `docs/SERVER_DATA.md` section 6
(automatic backups, per-store role rules on the server). That plan file is the design record and history; the operating guide is
`docs/SERVER_DATA.md`.

## Access this session has (granted by the user, scope = this project only)

- **SSH**: `ssh -p 65002 u943531942@31.97.219.57` — key-based, no password needed. Full shell on
  the shared hosting account.
- **Hostinger MCP tools** (`mcp__hostinger-hosting__*`, `mcp__hostinger-domains__*`, etc.) —
  authenticated, can manage websites/DNS/databases/etc. on the account.
- **FTP** — credentials exist (see Hostinger panel) but SSH/SCP is what's actually been used so
  far; prefer SSH/SCP over FTP going forward (already authenticated, no extra setup).
- **GitHub CLI (`gh`)** — authenticated as `talhaazhar-ta`, `repo`/`workflow` scopes.

**Important:** this Hostinger account hosts ~20 other, unrelated domains (literarylingo.com,
elevariq.*, roadriders.pk, etc. — see full list via `domains_getDomainListV1` if needed). **Every
action must stay scoped to `farooqandcotraders.online` and its `ERP` subdomain.** Never touch the
other domains/sites on this account.

## What has been done so far

1. Verified access (SSH login, Hostinger API `hosting_listWebsitesV1`) — see chat history /
   `docs/OPERATIONS.md` for the raw output.
2. Pulled the entire live `public_html` (both the homepage and the ERP subdomain, 13MB / 88 files)
   down to this local folder via `scp`, byte-for-byte as it exists on the server right now.
3. Scanned the pulled files for hardcoded secrets/tokens before doing anything with them — none
   found (the folder does include real business data: `data-exports/*.csv`,
   `database/fresh-install-backup.json` — that's why the GitHub repo is **private**).
4. Initialized a git repo here and created **`talhaazhar-ta/projectFarooqAndCoTraders`** (private)
   on GitHub as the baseline commit, pushed to `main`.
5. Investigated why `erp-upgrade/build.py` looked broken (it reads from `erp-upgrade/mod/` and an
   `erp-upgrade/farooq-co-erp.html`, neither of which existed after the initial pull). Turned out
   this is **by design**, not a defect — `erp-upgrade/.gitignore` explicitly ignores `mod/`,
   `dist/`, and those input files. They're a **local, disposable build-staging area** you
   reconstruct each time, never commit; the numbered module `.js` files (00a … 35, plus 01b) at `erp-upgrade/`
   root are the real tracked source. See "How to build the ERP locally" below — this is now a
   known, working, repeatable step, not an open problem.
6. While exercising the build for the first time, fixed three real bugs found along the way
   (commit `c0de02e`): `build.py`'s final status line crashed with `UnicodeEncodeError` on
   Windows' default console encoding (the build itself had already succeeded — the crash just hid
   the success message); `test-docx.mjs` wrote to a hardcoded `/home/claude/build/` path that
   doesn't exist outside wherever this was last built; `test-khata.mjs` overwrote the tracked
   `sample-customer-statement.docx` fixture in place on every run. All three now write into
   `dist/` (gitignored) instead. Verified with a full test run: **1,049 checks across all 20
   `test-*.mjs` harnesses, 0 failures**, and `git status` stays clean afterward.

7. Confirmed the live site's SSL and HTTP status directly (`curl -I`): both domains return `200`
   with valid SSL. Confirmed domain registration/lock/privacy status via
   `domains_getDomainDetailsV1`: active, locked, privacy-protected, expires 2027-09-08 — no action
   needed there.
8. Deployed the three harmless build-tooling fixes (`build.py`, `test-docx.mjs`, `test-khata.mjs`)
   to the live server, **after backing up the originals** to
   `/home/u943531942/backups/pre-sync-<timestamp>/` on the server. Verified with `md5sum` that the
   live files now byte-match local/GitHub exactly. These files aren't executed by the live
   website (they're dev tooling that happens to sit in the public webroot) — this deploy carries
   zero runtime risk to either site.
9. Added `.github/workflows/erp-build-test.yml` — GitHub Actions CI that rebuilds the ERP and runs
   all 20 `test-*.mjs` harnesses on every push/PR touching `erp-upgrade/` or `app/`. From now on, a
   broken module change gets caught on push, before it's ever deployed.
10. Added `scripts/deploy-erp.sh` — the recommended deploy flow as an actual script (see below).

**Current sync status: local, GitHub, and live are fully in sync** (checksums verified for
everything changed this session). Nothing in the live application behavior changed — only
non-executed dev tooling was updated, and only after being backed up.

## How to build the ERP locally

`erp-upgrade/mod/`, `erp-upgrade/dist/`, and 5 input files (`farooq-co-erp.html`, `index.html`,
`farooq-co-warehouse-pwa.html`, `farooq-and-co-homepage.html`, `farooq-erp-data.js`) are
gitignored on purpose — reconstruct them locally from the current `app/` before building:

```bash
cd public_html/ERP/erp-upgrade
mkdir -p mod
cp [0-9]*.js mod/                                    # 00a-preboot.js .. 35-topbar.js (incl. 01b-server-db.js)
cp ../app/farooq-co-erp.html ../app/index.html \
   ../app/farooq-co-warehouse-pwa.html ../app/farooq-and-co-homepage.html \
   ../app/farooq-erp-data.js .
python3 build.py                                     # writes dist/
npm install jsdom fake-indexeddb --no-save           # once per machine
for f in test-*.mjs; do node "$f"; done              # all should say "N passed, 0 failed"
```

`build.py`'s `inject()` strips any previous upgrade payload before re-adding a fresh one (matched
by an HTML comment marker), so feeding it the already-built `app/farooq-co-erp.html` as the
"original" is correct and repeatable — don't go looking for a separate pre-upgrade file that
doesn't exist.

**Never `git mv` anything into `mod/`** — it's gitignored for already-tracked files too, but
`git mv` will force-track it anyway, which is the wrong outcome. Only plain `cp`.

## Recommended deployment flow (local → GitHub → live)

**Homepage (`farooqandcotraders.online`, just `public_html/index.html`)**: trivial, single file.
Edit locally, commit, push, then:
```
scp -P 65002 public_html/index.html \
  u943531942@31.97.219.57:/home/u943531942/domains/farooqandcotraders.online/public_html/index.html
```
Back up the live file first if it's not a brand-new page (`ssh ... cp index.html index.html.bak-$(date +%Y%m%d%H%M%S)`).

**ERP (`erp.farooqandcotraders.online`)**: multi-file, has a build step and a test suite — use
`scripts/deploy-erp.sh`, which implements this exact flow:

1. Refuses to run if there are uncommitted local changes (commit first).
2. Reconstructs `mod/` and the build inputs, runs `python3 build.py`.
3. Runs every `test-*.mjs` harness; **aborts if any test fails** — nothing broken ever reaches
   the backup/upload steps.
4. Backs up the live files to `/home/u943531942/backups/erp-deploy-<timestamp>/` on the server
   before touching anything.
5. Uploads the freshly built `index.html`, `farooq-co-erp.html` and `farooq-erp-data.js` to
   **`public_html/ERP/_app/`** — *since Phase 3 (2026-09-20, once `gate-rollout.sh migrate` has been
   run; see "Server-side authentication")* the app is no longer a static file at the ERP root:
   the public URLs are rewritten to `api/gate.php`, which reads them from `_app/`. Before that
   migration the target was the ERP root itself (what the site served — see the correction under
   "These are NOT two separate filesystems" above). The script refuses to run if `_app/` isn't on
   the server, so it can't put the app back where nothing protects it. It then uploads the same
   build to the legacy `app/` folder too, for parity only.
   *Note:* `farooq-erp-data.js` is not actually loaded by the app (the only mention in
   `farooq-co-erp.html` is a comment; the same master data is embedded inline). It is still
   published and gated, because a public copy of the customer/supplier list is exactly what the
   gate exists to close.
6. Reminds you to clear the Hostinger cache (the script itself can't call the MCP tool — from a
   Claude session, call `hosting_clearWebsiteCacheV1` for `erp.farooqandcotraders.online` right
   after; from a plain terminal, clear it in hPanel).
7. Curls both live URLs and prints the HTTP status so you know immediately if something's wrong.

Full loop for an actual code change:
```
# 1. edit a module, e.g. public_html/ERP/erp-upgrade/17-profit.js
# 2. build + test locally (see "How to build the ERP locally")
# 3. commit with a why-focused message, referencing the module by name
git add public_html/ERP/erp-upgrade/17-profit.js public_html/ERP/app/farooq-co-erp.html public_html/ERP/app/index.html
git commit -m "17-profit.js: fix landed-cost rounding on partial receipts"
git push
# 4. deploy
./scripts/deploy-erp.sh
```

**Git workflow (standing instruction from the user, 2026-09-19): no branches, no pull requests.**
Work directly on `main`. Commit everything (`git add -A`), push to `origin main`, and never open
or merge a PR. "Commit all, push all, merge all" means nothing is left uncommitted, unpushed or
sitting on a side branch at the end of a task. If a stray branch or open PR turns up, fold it into
`main` and push. (The one PR this project ever had, #1 auth Phases 0–2, was merged 2026-09-19.)
Commit messages still carry no Claude attribution — see `docs/OPERATIONS.md`.

**Shared working tree — check before `git add -A` (learned 2026-09-20).** More than one Claude
session (or the user in an editor) can be working in this checkout at the same time. On 2026-09-20 a
parallel session's unfinished "module 35 / top bar" work (edits to `10-mobile.js`, `31-auth.js`,
`34-accounts.js`, `build.py`, two test files, plus new files) was sitting uncommitted while a separate
fix was being committed. `git add -A` would have shipped half of someone else's redesign. So: run
`git status` first; if it lists files you did not touch, stage **only your own** (`git add <paths>`;
for a file that holds both your edit and someone else's, build your version from `HEAD` and stage it
with `git hash-object -w` + `git update-index --cacheinfo`), verify it in an isolated
`git worktree add --detach <dir> HEAD`, and say plainly what you left alone. `deploy-erp.sh` refuses to
run with *any* uncommitted change (it builds from the working tree), so app deploys wait until the
other work is committed; `deploy-api.sh` only needs `public_html/ERP/api` clean.

**Scripts on Windows / Git Bash — two traps met on 2026-09-20.** (1) Git Bash rewrites an argument shaped like
`key=/path` into `key=C:/Program Files/Git/path` before a Windows program (curl, node) sees it; it silently
corrupted a `next=/?app=erp` probe and a healthy deploy was rolled back. Percent-encode the slash (`%2F`)
rather than reaching for `MSYS_NO_PATHCONV=1`, because (2) that switch also stops `/dev/null` being
translated for the Windows `curl`, so `curl -o /dev/null` exits 23 and, under `set -e`, aborts the script
mid-way — which left new files live with no rollback until an `EXIT` trap was added. A third trap (2026-09-20, the milling deploy): **the Hostinger edge drops roughly one TLS handshake in three** from the dev machine (curl exit 35, also on plain `/` and on the untouched old code), and `deploy-api.sh` read one dropped probe as a failed check and rolled a healthy deploy back (it restored correctly — the server was left on the old files). Its probes now go through `pcurl`, which retries only when curl itself fails to connect and never retries an HTTP answer, so a genuinely wrong status still fails and rolls back. If a deploy rolls back with `000` / `curl failed` in the probe lines, that is this, not the code. Any deploy script that
uploads first must restore on **any** unexpected exit, not only on a failed check (see `scripts/deploy-api.sh`).
Also: heredocs with tricky quotes are unreliable in this tool's shell — write a file with the editor tool and
run it.

**General rules, either site:**
- Never edit live files directly over SSH/FTP as the primary way of making a change — edit
  locally, build/test, commit, push, *then* deploy. The server copy is a deploy target, not a
  workspace.
- Never deploy schema/logic changes that break compatibility with existing browsers' IndexedDB
  records without going through the app's own migration path (`01-db.js`, `20-integrity.js`) —
  in server mode each user's browser copy is frozen and unused, so the data is the database (`docs/SERVER_DATA.md`); a change to a store
  needs its table applied to the live database and `deploy-api.sh` run BEFORE the app deploy, or saves to it are refused.
- Confirm with the user before anything hard-to-reverse: changing DNS, deleting anything on the
  server, or any action outside `farooqandcotraders.online`/`erp.farooqandcotraders.online`.
- CI (`.github/workflows/erp-build-test.yml`) runs the same build+test on every push touching
  `erp-upgrade/` or `app/` — a red check on GitHub means don't deploy that commit.

## Open items (from the ERP's own README, still unresolved)

1. Opening balances — legacy Total Sales/Collection/Balance are reference-only; carrying them in
   as real opening balances needs a cutover date from the user.
2. 68 route-corridor shops marked `region_assumed` need a definite region.
3. Five blank catalogue rows (101, 103, 108, 111, 132), 11 zero-value products, 2 duplicate-name
   groups — flagged, waiting on user decision.
4. Suppliers 204/494/575/614 — account type to confirm; 575 is currently switched off.
5. Roles are enforced in the app; on the server data path the server enforces sign-in, CSRF, revisions and an append-only audit log, but not
   per-store role rules yet (`docs/SERVER_DATA.md` section 6).
6. SMS/WhatsApp are configured but not connected to a provider.
7. ~~Client message (2026-09-16): "Add amount paid here"~~ — **Resolved 2026-09-16.** The client
   clarified: shops could receive money but never be *paid* money directly (only via the Customer
   Return flow). Implemented as "Pay a shop" — see "Pay a shop / Payroll (2026-09-16)" below.
8. ~~Client message (2026-09-16): "Payroll = Employee salary management system"~~ — **Resolved
   2026-09-16** as a deliberately minimal MVP (no real requirements were ever given). See below.

9. **Stock lying at the mill (Punjab) — built 2026-09-20, LIVE since 2026-09-21 (the Stock-value "Lying at mills" line went live in the 2026-09-21 ~01:35 deploy below); the open questions are DECIDED with recommended answers below. The plain-language story (who does what, how each form is filled) is `docs/MILLING_WORKFLOW.md`.** The feature itself is in
   `main` (see "Stock lying at the mill" below). Decision taken with the user on 2026-09-20: **go with it as built**, and keep these two
   points written down until the client answers:
   a. *Where does the wheat come from?* Today the wheat sent to a mill is taken out of one of **our warehouses' stock**, so the stock must
      be there first (a purchase into a warehouse) or the job is refused ("Only N bags … are available"; unless "allow negative stock" is
      on). The voice notes say the Punjab stock is "bought" and "given by weight" — if the client buys wheat and it goes to the mill
      **without ever entering one of our warehouses**, that job cannot be entered honestly today. Ask the client. If yes, the change is
      small: a "wheat did not come from our stock" choice on the job (skips the issue stock movement and its stock check, keeps the
      weight and the mill's account entry) — do not simply switch negative stock on to get round it, that hides real shortages elsewhere.
   b. *Should goods lying at the mill count in the totals?* Today they are **not** in the Dashboard "All bags available", Inventory or
      Stock value (module 37) totals, because they are not in a warehouse; they are shown only on Inventory & supply → **Stock at mills**
      (bags, kg, and worth at the job's cost per bag). If the client wants "everything we own, including what is in Punjab" on the
      dashboard, add a line for it there (a separate "At mills" figure, not folded into warehouse stock — the bags cannot be sold from a
      warehouse shelf until they arrive).
   **DECIDED 2026-09-21 (recommended answers, kept until the client says otherwise — reasoning in `docs/MILLING_WORKFLOW.md`):** (a) wheat comes from our own books — record the wheat purchase first, then the milling job (keeps payables, cost and stock honest; no code change); (b) goods at the mills are shown BESIDE the stock value, never inside it — **built** (see "(9)" in the second pass below); (c) arrivals are recorded by the roles that can record purchases (`PURCHASE_CREATE`), warehouse staff hand over the slip; (d) the job carries the agreed rates as on the paper khata; (e) one job per handover of wheat; (f) the 1–8 % loss band stays a warning only. Not built, recommended next: a dated running in / out / balance statement per mill (the paper page's آمد / نکاس / باقی).
   c. **Deploy order (the one thing that can break a first save):** *(DONE. Table `milling_arrivals` created on the live database 2026-09-20 (by Claude, with the user's explicit permission; 7 columns, same shape as `milling_jobs`). `scripts/deploy-api.sh` 2026-09-20 ~23:14 server time (backup `~/backups/api-20260920231437`; its first attempt rolled itself back correctly on a dropped probe, see the Windows/Git Bash traps). `scripts/deploy-erp.sh` 2026-09-21 (backup `~/backups/erp-deploy-20260921003630`; commit `e7e4bf1`; the three files in `_app/` are md5-identical to that commit's build, `_app/farooq-co-erp.html` cfb35743…). Both were run from a clean clone of `main` (`git clone --local` + a `node_modules` junction) because another session's uncommitted files make the script refuse to run in the main folder — see "Shared working tree". Hostinger cache: the Hostinger MCP tools were disconnected, so it was NOT cleared from Claude — clear it in hPanel if the old build still shows. Rollback of the app: copy the three files from that backup back into `ERP/_app/`; of the API: `scripts/deploy-api.sh rollback`.)*  the new store `millingArrivals` needs its table on the live database
      (`milling_arrivals`, generated into `database/schema-mariadb.sql`) and `scripts/deploy-api.sh` run **before** `scripts/deploy-erp.sh`;
      otherwise the first arrival is refused as an unknown store ("NOT saved"). Production commands are handed to the user (`!` prefix).
   d. Nobody has seen the new screens on the live site or a physical phone (real headless Chrome only), and the arrival save has not been
      run against the real MySQL API (no PHP on the dev machine; `test-server-db.mjs` covers the driver against a mock).

(The build-pipeline question from earlier sessions is resolved — see "How to build the ERP
locally" above — and isn't a decision the user needs to make.)

## Edge cases and improvements found this session

- **CDN caching** (see architecture note above) — a deploy can appear not to have worked if the
  cache isn't cleared after. Handled in the deploy flow now; wasn't documented before.
- **No CI before this session** — a broken module change could previously only be caught by
  manually remembering to run the test suite. Fixed by adding GitHub Actions CI (item 9 above).
- **Hostinger's own automated-backup status is unverified** — hPanel has a Website → Backups
  section (seen in the panel screenshot the user shared) but no Hostinger MCP tool exposes it for
  inspection or scheduling. **Check this manually in hPanel** — if it's not enabled, turning it on
  is a cheap extra safety net on top of the deploy script's own pre-deploy backups.
- **Both domains share one filesystem/account** — documented above under architecture. The
  practical risk is a copy/paste error in an SSH/SCP path affecting the wrong site; both deploy
  paths are now spelled out explicitly to reduce that.
- **`git mv` into a gitignored directory silently force-tracks it** — hit and fixed this session
  (see `docs/OPERATIONS.md`); recorded so it isn't repeated.
- **Business-logic bugs in the 30 ERP modules themselves** (the actual invoice/inventory/reports
  code, ~1MB of JS) have **not** been audited in this session — that's a separate, much larger
  piece of work on live financial software real people depend on, and deserves its own explicitly
  scoped review rather than being bundled into an infra/deployment session. Flagged for the user
  to decide whether/how to scope that separately.

**2026-09-16, deploy target bug** — the client reported the Area-filter and Statement-of-Account
features (added earlier the same day) weren't visible live. Root cause and fix are written up in
full under "These are NOT two separate filesystems" above (`ERP/app/` was never the served path);
summary: `scripts/deploy-erp.sh` was uploading only to the unused `ERP/app/` copy, so real deploys
never reached the site. Fixed the script, corrected the docs, and manually pushed the missed
changes to the real path as an immediate fix before the script fix was verified.

**2026-09-16, edge-case review of the same two features** — asked to review `06-wiring.js`'s
payment Area filter and `29-statement-of-account.js` for edge cases before moving on. Found and
fixed, each covered by a new regression check in `test-statement-of-account.mjs` (33 checks now):
- **An area/party-type combination with zero matches silently fell back to showing every
  shop/supplier** (both screens) — the Area/Party dropdown looked filtered while the list
  underneath wasn't, a real correctness risk on a money screen. Now shows an explicit empty state
  instead of the wrong list.
- **That empty state was a dead end on the Statement of Account screen** — the first version
  replaced the whole filter bar with a plain message, so there was no control left on screen to
  pick a different Area or Party type. Fixed by always keeping the filter bar present.
- **A crash**: `29-statement-of-account.js` was the only call site in the whole codebase that
  chained `.en` straight onto `global.regionOf(...)` without checking the result first; every
  other of the dozen call sites guards it, because it returns falsy for a region id that no
  longer exists (e.g. a shop still pointing at a deleted region). Would have blanked the whole
  page for that shop. Fixed to match the established guarded pattern.
- **An inactive region, if it was the one a pre-filled shop belonged to, silently became "All
  areas" in the dropdown** while the shop list stayed filtered to just that one shop — a visible
  mismatch. Now the currently-selected region stays choosable (marked "(inactive)") even if it's
  been switched off, on both screens.
- **An inverted From/To range on the Statement of Account screen produced a wrong balance with no
  warning** — `ERP.Ledger._roll()` (02-services.js) silently drops transactions between the two
  dates instead of erroring when From is after To. Every other statement entry point in the app
  only offers preset periods (always valid); this was the first screen to expose raw date fields.
  Now refused with a clear message, both on screen and if Print/Excel is clicked while invalid.
- **No cap on the on-screen ledger table** — unlike the existing customer khata page (paginated),
  the new screen rendered the entire history in one unbounded table. A long-lived account with
  thousands of entries could freeze the tab. Capped the on-screen table at the most recent 300
  rows with a note; Print/PDF and Excel are unaffected and always cover the full period.
- One inconsistency (not a functional bug): `payAreaOptions()` in `06-wiring.js` didn't escape
  the region id in the `value=` attribute, unlike the matching helper already in
  `28-areawise.js` and in the new `29-statement-of-account.js`. Fixed for consistency.

## Pay a shop / Payroll (2026-09-16)

Two more client-requested items, resolved the same day as the edge-case review above.

**"Pay a shop"** — client clarified item 1 ("amount paid isn't here"): a shop could always
*receive* a payment, but could only ever be *paid* money via the Customer Return flow (tied to
processing a product return, treatment=REFUND) — there was no direct "pay this shop money" action,
even though suppliers already had one ("Pay supplier"). The data model already fully supported it
(`isRefund: partyType==='CUSTOMER' && direction==='OUT'`, already used internally by the return
flow) — it just had no standalone entry point. Added:
- `ERP.Payments.refund(o)` (`02-services.js`) — a thin, validated wrapper around the same
  `Payments._write(..., 'OUT')` the return-refund path already used. No new ledger math.
- `PANELS.refund` ("Pay a shop", `06-wiring.js`) — same shape as "Receive payment", including its
  own independent Area filter (reusing the shared `areaSelectOptionsFor`/`customersInAreaFor`
  helpers, refactored out of the Area-filter fix above so both panels share one implementation).
- Wired in next to "Receive payment" on the shop's own khata page, the customer profile page, and
  as a quick action on the Statement of Account screen (which also gained a matching "Receive
  payment" quick action, and "Pay this supplier" for the supplier side).
- Two real bugs found and fixed while tracing this, both in code paths this feature newly
  exercises for the first time:
  - `ERP.DocModel.receipt()` (`04-documents.js`) computed the closing balance and contact info
    from payment *direction* alone (`incoming = direction==='IN'`), so a customer refund
    (direction OUT) looked up a *supplier* balance using the customer's id, and dropped the
    phone number. Fixed to branch on `partyType` instead. Also: the totals block unconditionally
    said "Amount received" even on a "PAYMENT VOUCHER" for an outgoing payment (paying a
    supplier, now also a shop) — fixed to say "Amount paid" / "ادا شدہ رقم" for OUT payments.
  - `PANELS.paysup` ("Pay supplier"), opened from a *specific* supplier's own profile page, never
    pre-selected that supplier — the base app's own button sets `WATARGET` (a `let` binding
    lexically scoped to the base script, not a `window` property), but this panel definition
    (added by the upgrade, replacing the base app's original one) only ever read `PAY_FOR`.
    Fixed to fall back to `WATARGET` when `PAY_FOR` isn't set. (A test that tried to reproduce
    this by setting `window.WATARGET` from outside the page proved nothing, since that only
    creates an unrelated shadow property — the real bug had to be reproduced via the actual
    button click, which is what the regression test now does.)

Covered by `test-pay-a-shop.mjs` (37 checks).

**Same request came again 2026-09-20/21 — "Pay a shop" on the Payments screen itself.** The client's voice note ("you have *amount
received* up above… but we also give some customers cash, they take it to the bank") was about the **Payments** screen, where only
"Receive payment" existed; "Pay a shop" lived only on a shop's khata/profile and the Statement of Account. Now, in `06-wiring.js` §8:
"Pay a shop" sits beside "Receive payment" in the Customer payments header, and a new **Paid to shops** list (date, shop, region,
method, amount, reference, Voucher button; `Payments.refunds()` — payments to shops were previously on no list except the raw
"Receipts & vouchers" log) sits above Supplier payments. Both header buttons go through `data-fcpayopen`, which clears `PAY_FOR` /
`REFUND_FOR` first so a shop chosen earlier on some other page can't be pre-selected on a money screen. `test-pay-a-shop.mjs` is 64
checks (S1–S17 the screen, B1–B9 below). Second pass: the Pay-a-shop panel now shows "→ after this payment: X" as you type (and "the shop will
owe you X" when a payment flips the account); `Payments._write` stored `balanceAfter` **subtracted for a payment to a shop** (it should add —
paying a shop raises what it owes; nothing reads the field, older refunds keep the wrong stored value, fixed for new ones). Looked at in real
headless Chrome (desktop + 390px phone). **Module 38 (another session) replaces `PAGES.payments` wholesale** — keep the S-checks' hooks
(`data-fcpayopen`, `#fcPaidToShops`, `data-fcreceipt`) there. Open policy question, not decided: `PAYMENT_CREATE` (Sales role has it) does not gate
either payment panel, so anyone can record cash paid OUT to a shop; gate `Payments.refund` if the owner wants that limited. No API/schema change → app deploy only.

**Payroll** — client's item 4 was one line ("Payroll = Employee salary management system") with
no fields, salary structure, or screenshot, even after a follow-up. Built as a deliberately
minimal MVP rather than guessing at a real HR/accrual model:
- Two new IndexedDB stores (`employees`, `salaryPayments` — `01-db.js`, `DB_VER` 9→10),
  deliberately separate from `salesmen` (area sales-coverage is a different concern from who's on
  payroll) and from `payments` (a salary is never a customer/supplier balance movement).
- `ERP.Employees` (CRUD, archive-not-delete, same shape as `ERP.Staff`/salesmen) and `ERP.Payroll`
  (`pay()`, `paymentsFor()`, `totalPaid()`, `lastPaymentDate()`, `paidThisMonth()`) in the new
  `30-payroll.js`.
- **Deliberately a payment log, not a balance/liability system** — there is no "amount owed"
  concept anywhere in it. Nothing was specified about pay periods, proration, deductions or
  advances, and a wrong balance on a payroll screen would be worse than no balance at all.
- One screen (`PAGES.payroll`, new "Payroll" entry under Finance): an employee table (name, role,
  monthly salary, paid-this-month status, total paid, active/archived) with Add/Edit/Pay
  salary/Statement actions; selecting "Statement" expands a detail card below with summary cards
  and the full dated payment history — the same shape as the customer/supplier ledger, by design.
- **Explicitly not built** — flagged for the client to specify before any of it is attempted:
  attendance, deductions/advances, tax, printable payslips, pay-period accrual.

Covered by `test-payroll.mjs` (48 checks, including a full restart/persistence check). *(Superseded 2026-09-21 — see "Payroll — a real monthly salary system" below; the "no balance owed" decision no longer holds.)*

## Payroll — a real monthly salary system (2026-09-21)

**The 2026-09-16 MVP below was a payment log only ("no balance owed, by design").** The client asked again on 2026-09-21 by voice note
("the employees who take their salary from here… whoever takes it the first time, we write them down afterwards, and the salary is also
managed in this"), so `30-payroll.js` was rewritten as a monthly system. **No new store, no schema change, no API change → app deploy
only** (`deploy-erp.sh`). The live database held 0 employees / 0 salary payments / 0 expenses when this was built, so nothing was migrated
(older records still read correctly: an entry with no `kind` is a SALARY for the month of its date; a person with no start month starts in
the month of their first entry, else the local month they were added).

- **Per person, per month:** DUE = salary + bonus − deduction · PAID = salary payments + advances *for that month* · REMAINING = DUE − PAID
  (negative = "paid ahead"). The month is the month the money is FOR (`periodMonth`), not the day it was handed over. Salary accrues from the
  person's **start month** to their **last month** (set when archived — the current month is still owed) and only up to the current
  month; a future month shows "Not due yet" (planned salary shown, due 0). The statement's "Still owed" = Σ of every month's remaining,
  so an advance beyond a month simply carries forward.
- **Four kinds of entry**, all in `salaryPayments` (`kind`): SALARY and ADVANCE move cash; BONUS adds to what is owed, DEDUCTION takes from
  it (no cash, no method). The salary **keeps history** (`rates:[{from:'YYYY-MM', salaryP}]`; a raise "counts from" a chosen month and never
  rewrites earlier ones; `monthlySalaryP` = today's rate).
- **First payment adds the person** (the "we write them down afterwards" part): Pay salary → "＋ New person" → name/role/phone/salary; the
  employee and the entry are saved in ONE transaction; "Pay salary" starts on a blank employee choice (nobody pre-selected on a money screen).
- **Refused, so the screen cannot quietly go wrong:** a SALARY payment above what is left for its month (says "record the extra as an
  Advance"; a month that has not started says the same), a deduction above the month's pay, a second person with the same name (any case/
  spacing), `< > "` in a name, non-numeric/zero/absurd amounts, impossible dates, months outside 2000–2100, unknown methods. Errors show
  **inside the still-open panel** (`Payroll.check` is the pure, synchronous half of `pay`).
- **Reverse** (never delete): struck through, kept, reason in the audit log; not counted anywhere. Documents: salary sheet and per-person
  statement (Print/PDF via `ERP.Viewer`, Excel), and a **slip** per entry with the employee's signature line.
- **Server safety** (same pattern as the mill guard): every entry claims its client operation id (double-click = one entry) and touches
  `meta` row `salguard:<employeeId>`, so a second window working from an old copy is refused ("NOT saved — reload") instead of paying a
  month twice. Reversal touches it too. New people are written after commit, so a failed save never shows on screen.
- **Profit report changed (shared core, 17-profit.js):** `totals.salaries` = cash salary + advances paid in the period (by payment date, like
  expenses; bonus/deduction/reversed excluded) and **"After expenses" now subtracts it** — otherwise net profit was overstated once payroll is
  used. Cards/Excel say so. **Staff pay goes through Payroll, not the Expenses screen** (the expense panel says so; a "Salaries" expense
  *plus* a payroll payment would count twice — the category itself was left in the list because old data may use it).
- **Gate:** `PAYROLL_MANAGE` (owner only unless given to a role) on the screen (module 34) and now also inside `Payroll.pay/reverse` and the
  employee panel — browser-side, like every role here.
- **Tests:** `test-payroll.mjs` (124 checks, pinned clock: math, refusals, history, leaving/restoring, first-payment person, legacy records,
  reversal, roles, profit, documents, the screen and both panels driven through the DOM, restart) and `test-server-db.mjs` section K (9
  checks: server rows, the guard, a stale window refused for a payment and for a reversal, double-click, failed commit). Mutation-checked
  with 12 deliberate breakages (no guard row, no overpay rule, no role gate, no operation claim, history ignored, reversed counted as live,
  bonus counted as cash, no deduction limit, no duplicate check, new person not created…) — each turns a check red. Looked at in real headless
  Chrome, desktop 1320px + 390px phone.
- **Not built:** tax, attendance, hourly overtime, loans in instalments (give each advance, deduct in the month you want), pro-rating a part
  month (use a Deduction), payslips by e-mail/WhatsApp, a "pay everyone" bulk action, per-role limits on amounts. **Not seen by anyone on
  the live site or a physical phone.** Open question for the client: do they want "pay everyone for the month" in one go?

## Edge-case review of "Pay a shop" and Payroll, plus a live mobile bug (2026-09-16)

Asked to review both features above for edge cases before moving on. Found and fixed:

- **Button-style inconsistency**: on a shop's own account page (`16-khata.js`), "Receive payment"
  was the prominent filled button while the new "Pay this shop" was a plain outline button, even
  though they're meant to be equally available actions now. Both are `btn pri` now.
- **Payroll**: "Pay salary" clicked from an *archived* employee's row silently pre-filled a
  *different* employee instead, with no indication — the exact "wrong person paid" mistake the
  Area-filter fixes were about. Archived employees now stay selectable (marked "(archived)") when
  specifically pre-filled, instead of being silently swapped out. `test-payroll.mjs` grew to 50
  checks.
- **A live bug reported by the client mid-session, with a phone screenshot** (unrelated to either
  new feature — module `10-mobile.js`, untouched until this fix, hadn't been touched all day): the
  mobile bottom navigation ("Home / Sales / New / Stock / More") appeared cramped at bottom-left
  with the desktop sidebar rail still visible on top of it, instead of a full-width bottom bar.
  Root cause, two bugs stacking:
  - The bar's hide-on-desktop rule lived only inside `@media(max-width:760px)`, so outside that
    exact width there was no fallback default at all — fixed with an unconditional `display:none`
    plus a higher-specificity override for the mobile+visible case.
  - Nothing in `10-mobile.js` ever hid the desktop sidebar rail on mobile; it relied entirely on
    the base app's own `max-width:900px` rule, which the sidebar's persisted collapsed/"mini"
    state was defeating in practice. Reasserted with `!important`, scoped to `.fc-mobile`, and the
    content area's margin is now reset to use the full width on mobile too.
  - **This has no jsdom-testable surface** — jsdom does not render CSS/layout at all, only the DOM
    structure (`test-mobile.mjs` already covers that the bar exists, has the right tabs, and
    click-navigates correctly — all still passing). The actual visual fix was diagnosed by reading
    the CSS cascade against the client's screenshot and needs a live phone to fully confirm.

## Server-side authentication & authorization (2026-09-16)

The client-side-only account system (`22-users.js`'s PIN accounts, `19-collection-rbac.js`'s
`ERP.RBAC`) was never a real security boundary — no login was mandatory, an account with no
PIN was a free pass, `Session.role()` fell back to `'OWNER'` with nobody signed in, and the
whole business database was **world-readable with no credentials at all**
(`database/fresh-install-backup.json`, `data-exports/*.csv`, etc. — all `200`, no auth).
Branch `feature/auth-server-enforced`, PR #1. Rolled out in phases, of which the first three
are done and live:

- **Phase 0 (live)**: per-directory `.htaccess` denies on `database/`, `data-exports/`, `docs/`,
  `samples/`, `erp-upgrade/`, the orphaned `app/` duplicate, and `*.md`/`*.json`/`*.sql`/`*.prisma`
  at the ERP root. The app's own runtime files (`index.html`, `farooq-co-erp.html`,
  `farooq-erp-data.js`, `logo.png`) are untouched and still served — each directory got its own
  deny file specifically so a mistake there couldn't take down the app root.
- **Phase 1 (deployed)**: a PHP 8.3 API under `public_html/ERP/api/` (same-origin with the ERP,
  works transparently through the base64 `srcdoc` launcher). Backed by a **new, dedicated**
  MySQL database `u943531942_erpauth` — deliberately separate from `u943531942_facotraders`,
  which stays empty and reserved for the eventual IndexedDB→MySQL business-data migration (see
  below). Schema in `database/auth-schema.sql`: `auth_users`, `auth_sessions`,
  `auth_login_attempts`, `auth_role_permissions` (seeded from the exact `ROLES` map in
  `19-collection-rbac.js`, so the server is now the source of truth for what each role can do),
  `auth_audit`. Endpoints: `login.php` (bcrypt, per-username+per-IP rate limiting, account
  lockout after 5 failures, one generic error message so accounts can't be enumerated),
  `logout.php`, `me.php`, `ticket.php` (offline grace-period reissue), `change-password.php`,
  `users.php` (owner-only account CRUD). Every response sends `Cache-Control: no-store` — the
  Hostinger CDN in front of this domain must never cache an authenticated response.
  `scripts/auth-bootstrap.php` creates the first OWNER account over SSH only (refuses to run over
  HTTP, refuses if any account already exists).
- **Phase 2 (live)**: new module `erp-upgrade/31-auth.js` (`AUTH_MODE = 'observe'`). A server
  sign-in becomes the source of truth for `ERP.Session`/`ERP.RBAC` — permission checks fail
  **closed** once a server identity exists — but nobody is forced to sign in yet; with no server
  session the app renders exactly as it did before this module existed. A "Company sign-in" link
  sits next to the existing account chip. Includes an offline grace-period ticket (HMAC-signed
  server-side, but the signature can't be verified client-side since the secret never reaches
  the browser — only the ticket's own claimed expiry is enforced; documented in the module header
  as the same category of limit as `22-users.js`'s own PIN comment). There WAS a 15-minute idle lock
  here; **it was removed 2026-09-21 at the owner's request** (no idle lock on the screen, no idle
  sign-out on the server — `docs/SERVER_DATA.md` §9). The sign-in screen that still comes back when a
  session really ends (12 h cap, account switched off, signed out elsewhere) re-verifies against the
  server if online, or a cached PBKDF2 password verifier if offline.
- **Phase 3 — the login gate: LIVE and ENFORCING since 2026-09-20.** Sign-in is mandatory: the app
  and the customer/supplier master data embedded in it are no longer downloadable by anyone.
  (Correction to what this file and `31-auth.js` used to say: Phase 3 was **not** "flip `AUTH_MODE`
  to `'enforce'`" — nothing ever branched on that value, so the enforcement was built new.)
  - **How it works.** The app files live in `ERP/_app/` (denied to the web). `ERP/.htaccess` rewrites
    `/`, `/index.html`, `/farooq-co-erp.html` and `/farooq-erp-data.js` to `api/gate.php` (+
    `api/_gate_login.php`). Signed out ⇒ `401` and a sign-in page (`401 "Sign in required."` for the
    data file); signed in ⇒ the file, sent `private, no-cache` with an ETag (revalidates as a tiny
    `304`; a matching `If-None-Match` can't bypass the check). **Fails closed**: enforcing + database
    unreachable, or a broken/unreadable config ⇒ `503` retry page — never the app.
    **The sign-in page is a real HTML `<form method="post" action="api/auth/login.php">`, not a
    `fetch`** (changed 2026-09-20 after "the browser doesn't offer to save the password"; **live since
    2026-09-20** via `scripts/deploy-api.sh`, backup `api-20260920093527`): password
    managers — Chrome, Safari, Firefox, phone keychains — only reliably offer to save when a form is
    genuinely submitted and the browser then navigates; a fetch-then-reload gave them no clear
    "it worked" signal. `login.php` now answers two ways with the same rules: the app's own JSON
    fetch (unchanged), and a native form post (`application/x-www-form-urlencoded`: `username`,
    `password`, hidden `next`) → `303` to `next` on success, or to `next?signin=<bad|empty|locked|rate|down>`
    on failure (the page turns the code into a message and tidies the address). `next` is vetted by
    `auth_safe_next()` (`_session.php`): only a local path, everything else collapses to `/` (no open
    redirect, no header injection). A form post the browser marks `Sec-Fetch-Site: cross-site` is
    refused (login CSRF); the check is deliberately header-only, not Host/Origin, because behind the
    CDN those could be rewritten and lock everyone out.
  - **The kill-switch.** `'enforce_login' => true` in the server's `private/erp-config.php` (currently
    **true**). Absent/false = dormant: the gate serves the files to anyone and never touches the DB.
    Only a real boolean `true` enforces (`"yes"` doesn't — a typo can't lock people out). Read on every
    request, so flipping it is instant with no redeploy: **`scripts/gate-rollout.sh enforce-off`** is the
    emergency "let everyone back in" (or edit that one line by hand over SSH).
  - **The client (`31-auth.js`).** The server says it is enforcing (`enforce` on `me.php`/`login.php`)
    and `Auth.mode` follows. Enforce mode adds a once-a-minute **heartbeat** (visible tab, unlocked
    screen only): a `401` locks the screen behind a sign-in *without a reload* (no lost work) instead of
    quietly carrying on as the local Owner; a network failure only locks once the offline grace ticket
    has also expired. "Sign out" reloads to the gate; the module-22 "switch user" chip is display-only.
    `me.php` also issues a fresh offline ticket (a gate sign-in never sees `login.php`'s response, so
    without it a device that lost signal would lock at once).
  - **Staff accounts and screen access (module 34).** Admin → **Company accounts** (at the very
    bottom of the left menu, or under *More* on a phone, or via the avatar menu). Everyone signed in
    sees **My account** there — that is where a person **changes their own password** (moved
    2026-09-20 from a text link in the top bar); the staff list below it is **owner only**
    (`ACCOUNTS_MANAGE`, and a non-owner's browser never even requests it). Owner: add someone with a temporary
    password (the server forces a change at first sign-in), change a role, reset a password, switch an
    account off/on (a switched-off person is signed out within a minute). All rules stay server-side
    (`api/auth/users.php`: owner only, CSRF, the last owner can't be demoted or switched off, audit-
    logged). Screens are tied to permissions: Payroll `PAYROLL_MANAGE` and the Company accounts
    staff list `ACCOUNTS_MANAGE` (given to no role ⇒ owner only, like `LANDED_COST_*`; no server table change),
    Milling `PURCHASE_CREATE`, Statement of Account `COLLECTION_VIEW`. This is a browser-side
    convenience, not a data boundary. Invoice search is not separately gated (part of Sales).
  - **Live state, verified 2026-09-20 in a real Chrome session (the tester's own browser, already
    signed in as the owner).** A signed-in session loads the app in enforce mode (heartbeat running,
    Sign out shown, chip disabled). Cookie-less requests — repeated, cache-busted, and right after a
    signed-in load — get `401` + the 4,419-byte sign-in page for `/`, `/index.html`,
    `/farooq-co-erp.html`, `401` for the data file, `403` for `/_app/…`, and none of the app or its
    data, so **the CDN is not sharing signed-in copies**. Served files are byte-identical to the local
    build (SHA-256 checked in the browser) and brotli-compressed (~1 MB on the wire on a first load;
    repeat loads are `304`s). **Never tested by anyone: a fresh signed-OUT sign-in through the sign-in
    page with a real password** — do it once in a private window. **Two server accounts exist: `owner`
    (password changed, working) and `test` (a Manager, created by the owner, never signed in).**
    Everyone else who used the ERP via the old module-22 PIN accounts is locked out until the owner
    adds them.
  - **Operating it.** `scripts/gate-rollout.sh`: `status`, `migrate` (installs the gate dormant, keeps
    the original root copies so `rollback` is instant), `finalize` (after a REAL-BROWSER check: removes
    the shadowed root copies), `enforce-on` (refuses until `finalize` is done and the enforce-mode
    client is deployed), `enforce-off`, `rollback`. `scripts/deploy-erp.sh` uploads to `_app/`
    atomically (`*.uploading` then rename), refuses to run before `migrate`, and takes a lock
    (`.git/deploy-erp.lock`) so two runs can't overlap. Backups on the server:
    `/home/u943531942/backups/gate-20260920005913/` (the successful migrate),
    `.../gate-20260920004319/` (first attempt), `.../erp-deploy-<timestamp>/` (each app deploy), and
    `private/erp-config.php.bak-<timestamp>` (each kill-switch flip), `.../api-<timestamp>/` (each
    `scripts/deploy-api.sh`). **PHP changes (`public_html/ERP/api/**`) are NOT shipped by
    `deploy-erp.sh`** — use `scripts/deploy-api.sh` (backs up, lints on the server, probes the live
    endpoints without needing a password, restores itself on any failure; `rollback` argument undoes
    it). Checklist:
    `docs/OPERATIONS.md` → "Phase 3 rollout (login gate)".
  - **Lesson from the first rollout attempt (2026-09-20) — read before probing this host.** The first
    `migrate` was rolled back after a *gzip-accepting curl* got a **403 from the Hostinger CDN edge**
    (`Server: hcdn`). It was a false alarm: that edge refuses gzip-accepting **curl** requests on the
    ORIGINAL static site too (the owner's own curl on the restored layout still got 403; an untouched
    `/logo.png` control is refused the same way), while real browsers get `200` + brotli. **A curl probe
    with `Accept-Encoding: gzip` says nothing about what browsers get on this host; the only
    authoritative test is a real browser** (the Claude-in-Chrome extension, or a human). The rollout
    script therefore uses plain-HEAD probes for blocked/alive questions and a control-relative
    `browser_check` (INCONCLUSIVE if the control is refused too), and the `migrate → real-browser
    check → finalize` split exists for this reason.
  - **Tests.** `test-gate.mjs` (86 checks: the real PHP under `php -S` against SQLite — signed in/out,
    session expiry/idle/deactivation, fail-closed incl. broken config, kill-switch, `If-None-Match`
    bypass, the sign-in page's own script, and the native form sign-in incl. open-redirect / header-
    injection / cross-site / lockout / DB-down cases), `test-auth-client.mjs` (64, sections H/I = enforce
    mode), `test-accounts.mjs` (51), `test-sidebar.mjs` (20); all mutation-verified. `test-gate.mjs` skips itself (exit 0) if
    there is no `php` on the machine; CI has PHP. **Not covered by any test**: the `.htaccess` rewrites
    under real Apache/LiteSpeed and the CDN — those are verified live by the rollout steps.
  - **Known limits (deliberately not "fixed" — say so before relying on them).**
    (a) *The gate protects the app files and the master data inside them.* **Since 2026-09-20 the business data is on the server**
    (`docs/SERVER_DATA.md`) and reachable only by a signed-in session; a signed-in browser can still read everything the API returns (roles are
    enforced in the app, not per store on the server). The old per-browser IndexedDB copies still exist on each device, frozen.
    (b) *Lockout as a denial of service*: 5 wrong passwords lock an account for 15 min from any IP, and
    `owner` is a guessable username — with a mandatory gate a stranger can keep the owner out.
    `enforce-off` is the escape hatch; a real fix (per-IP+user throttling instead of a hard account
    lock) changes the login semantics and wants its own decision.
    (c) *The Warehouse app inside the launcher has no heartbeat/lock* — protected at load by the gate,
    but it keeps running if the session ends mid-use (only the ERP watches the session); its next save
    says "sign in again". (It is on the company database since 2026-09-21 — see below.)
    (d) *Reloading a gated page with no signal fails* (a signed-in-only page can't be cached); an app
    that is already open keeps working offline within the grace ticket.
    (e) A page restored from the browser's back/forward cache after signing out shows its old screen
    until its next heartbeat — cosmetic, the data is local anyway.
  - **Left to do.** (1) The private-window sign-in test above. (2) The owner adds real staff under
    Company accounts, and switches off or deletes the `test` account if it was only a test.
    (3) Decide on limit (b). (4) Bring the Warehouse app under the session watch, if it matters.

**Credentials**: the DB password for `u943531942_erpauth` and the ticket-signing secret are
generated fresh (never extracted from the existing `dbhub` MCP credential) and live only in
`private/erp-config.php` on the server and locally, gitignored — `private/erp-config.sample.php`
is the committed template. The bootstrapped OWNER account (`username: owner`) started with
`must_change_password` set; the password-change screen was built the same day (see below) and the
owner has since changed it (checked 2026-09-20).

**Verified this session**: full existing test suite (24 harnesses, 1,196 checks) unaffected;
new `test-auth-client.mjs` (25 checks) covers observe-mode fallback, login/logout, fail-closed
permissions, a valid vs. an expired offline ticket, and both unlock paths of the sign-in screen (the idle lock itself was removed 2026-09-21) — all via a
mocked `fetch`, never depending on the live server. All 8 PHP files linted against the live
server's actual PHP 8.3 binary before upload. Live smoke test via a real browser: public data
now `403`, `_bootstrap.php`/`_session.php` return `403` on direct request, a full login round
trip as the bootstrapped OWNER worked end-to-end and correctly rebound `ERP.Session`/`CURRENT_USER`,
and a real bug found in that same smoke test (the "Company sign-in" link didn't disappear once
signed in) was fixed and redeployed before this was called done.

**Open decisions from this rollout — both confirmed by the user, 2026-09-16, no change needed**:
`LANDED_COST_MANAGE`/`LANDED_COST_VIEW`/`EXPENSE_MANAGE` stay OWNER-only in
`auth_role_permissions`, matching today's client-side behavior exactly. (The second decision — that
Phase 3 stay deferred until Phase 2 had run clean for a few days — was honoured, then superseded:
Phase 3 went live on 2026-09-20, see above.)

**Password-change screen added (2026-09-16, same day as Phase 2)**: the gap flagged right after
Phase 2 shipped — a `must_change_password` flag existed with no UI to act on it — is closed.
`31-auth.js` now shows a mandatory, non-dismissable "Change your password" overlay right after
signing in when the server says the account must change it (set on every bootstrapped/owner-reset
account), and a voluntary "Change password" link next to the account chip otherwise (replacing
"Company sign-in" once actually signed in — *since 2026-09-20 that link is gone; the button is under
Company accounts → My account*). Changing the password also clears the cached offline
PBKDF2 verifier, since it was derived from the old password. Covered by 10 new checks in
`test-auth-client.mjs` (35 total in that file now).

**The `test-users.mjs` flake noted in the auth-rollout session above is now fixed (2026-09-16/17)**.
It resurfaced during the Milling Jobs deploy — this time failing **consistently** (every standalone
run on this machine, not the "1 in 3-4" rate originally seen; confirmed by the milling work's own
git-stash isolation that it was still present with zero milling-related changes in the tree, so it
remained a pre-existing issue, just now hitting a much higher rate under local machine load). Since
it was now reliably blocking `scripts/deploy-erp.sh`'s test gate, it was fixed rather than deferred
again. Root cause matched the diagnosis already on file: U22's click on a no-PIN account fires an
async `Session.signIn()` whose `closeSignin()` completion could resolve after a fixed `sleep(300)`
had already moved on to U23's PIN-account click, wiping that freshly-rendered `#siPin` input out
from under it. Fixed in the test only (no application code touched) by replacing that fixed sleep
with a small `waitUntil(condition, timeoutMs)` poll that waits for the actual settled state —
session id changed and the dialog closed — before proceeding, so a slow resolve can no longer leak
into the next step regardless of machine speed. Verified with 8 consecutive standalone runs, all
clean, plus a full-suite rerun (26/26 harnesses green).

## Sidebar collapse/expand button (2026-09-20)

Reported: "the bar opening/closing button — the one left of the page title — isn't working". Cause (a
long-standing base-app limitation, not a regression): at a window width **≤ 1200px** the base CSS
forces the sidebar down to the narrow icon rail on its own, and the button (`#mini`) only toggled
`body.mini`, which sets the *same* 68px — so on most laptop windows it visibly did nothing and the
labels could never come back. Fix, in `10-mobile.js`: between 901 and 1200px the button now
**expands/collapses** the rail (`body.fc-wide`, remembered in `localStorage` `farooqco_rail_wide`; a
capture-phase handler that stops the click so the base handler doesn't also fire); **above 1200px
the base behaviour is untouched**; **at ≤ 900px the button is hidden** (the hamburger owns the drawer
there, and the collapse button can't do anything). The button's label/tooltip follows the state.
`test-sidebar.mjs` (20 checks, mutation-verified) proves the handler/state/CSS text in jsdom — jsdom has
no layout. **Deployed 2026-09-20 ~14:23** (`erp-deploy-20260920142312` — the same build as the top bar and
the server driver). The pixels have **not been confirmed in a real browser**: check a ~1100px window (the
button should expand/collapse the labels) and ~1400px (unchanged base behaviour).

## Milling jobs — toll milling (2026-09-16)

A new client requirement, analysed from `clientNewReq/` (a gitignored working folder — see commit
`d0f6d50`): Farooq & Co hand wheat to a flour mill and get flour bags plus chokar (bran) back, with
some grain lost in grinding, and settle the difference in the mill's own account. This was a
**second-hand reading** of the client's message (the photo it referenced, `new.jpeg`, was never
actually in that folder) — confirmed against the ERP's own data rather than guessed: 25 of 32
suppliers are flour mills, there is a `گندم 49 کلو` (wheat) product and two `چوکر` (chokar/bran)
products, and a supplier record is literally named "Zam Zam chokar khata" with `categoryInferred:
"Bran ledger account"` and a running balance. Deliberately **not** built: saved yield recipes /
enforced conversion ratios (loss is calculated and shown, never enforced), an in-house/no-mill
production mode, and editing a posted job (only Cancel, which reverses the stock — same as every
other posted document in this app). Flagged for the client to confirm: whether the mill genuinely
*buys* the wheat (net settlement, the default) or only charges a grinding fee while the wheat stays
Farooq & Co's property (the job's own `settle: 'FEE_ONLY'` toggle covers this without a rebuild).

New module `erp-upgrade/32-milling.js`, `DB_VER` 10 → 11 (`millingJobs`, `millingJobItems`). A
"Milling job" is entered on its own screen ("Milling" under Inventory & supply): pick a mill (an
existing supplier), list wheat issued and flour/chokar received back, each line in bags **and**
kilograms — weight auto-fills from the product's existing `kg` field (already set on 100 of 136
products) and stays editable for the real weighbridge figure. Four new stock-movement kinds
(`MILL_ISSUE_OUT`, `MILL_RECEIPT_IN`, and their reversal pair) go through the one existing
`ERP.Inventory.apply` write path — nothing new invented there. The only change to shared core logic
in the whole feature: `Inventory.apply`'s moving-average-cost condition now also fires on
`MILL_RECEIPT_IN`, not just `PURCHASE_IN`, since flour arriving from a mill is genuinely new costed
stock; covered by a regression check that an ordinary purchase's moving average is bit-identical to
before that change.

**The real architectural gap this closed**: `ERP.Ledger.supplier` previously derived a mill's
balance from exactly four sources (purchases, payments out, supplier returns, opening balance) —
there was no way to debit or credit a mill's account for anything else, even though customers
already had this via `ERP.Adjustments` (`16-khata.js`). `32-milling.js` patches
`ERP.Ledger.supplier` the same way `16-khata.js` patches `ERP.Ledger.customer`, adding up to three
rows per posted job (wheat issued reduces payable, flour/chokar received and the milling fee
increase it) so the mill's Statement of Account, the payables total and printed statements all pick
up milling jobs automatically, with no changes needed to any of those screens.

Covered by `test-milling.mjs` (80 checks: validation, the full posting cycle, stock movements, the
ledger patch including a `FEE_ONLY` job and a cancellation, the moving-average-cost regression, the
printable document, and a full DOM-driven entry-screen walkthrough including the "mill goes inactive
mid-draft stays selectable" edge case). Full existing suite (25 other harnesses) reruns clean.

**Client's own paper ledger seen and cross-checked (2026-09-16, `clientNewReq/new.jpeg`, gitignored —
real business figures)**: a stock-book page headed for a named flour mill, with the same four-column
شکل (تعداد/وزن/ریٹ/رقم) rows summing to a large total, a deduction, and a net payable — confirming
Net Settlement as the right default over a grinding-fee-only model (the totals are commodity-value
figures in the tens of millions, not service-charge figures). Two things flagged for the client
rather than guessed from the photo: some تفصیل product names on that page weren't confidently
legible (byproduct grades — broken grain, sweepings — rather than clean SKU matches), and the top
half of that page is a continuous آمد/نکاس/باقی (in/out/running-balance) weight ledger per mill,
which the job-by-job model here doesn't reproduce as a single running column (each job carries its
own weights; the mill's Statement of Account rolls them up, but not as one balance line the way the
paper page shows it) — a scoped follow-up if the client specifically wants that view, not a rebuild.

**Edge-case review (2026-09-16, same day)**: reviewed the module for the same class of edge cases
the Area-filter/Statement-of-Account and Payroll reviews earlier this session found real bugs in.
Two found and fixed:
- **Removing every line on a side left a dead-end empty table**, with no row left to type into
  except a separate "Add line" click — inconsistent with `27-landed-ui.js`'s own dynamic line list,
  which always keeps at least one row present after a removal. Now does the same.
- **A save-in-flight race**: Save is clicked (async), the entry is then abandoned (Cancel) and a
  second, different draft started before the first save resolves. The save's completion handler was
  unconditionally resetting the screen back to the list — which would have silently discarded
  whatever had already been typed into that second draft. Now captures the specific draft object
  being saved and only clears it from the screen if it is still the live one when the save lands.
  Verified this matters by reverting the fix and confirming the new regression check fails, then
  restoring it.

Also added a Cancel action to the job detail card itself (previously only on the list row),
matching how `30-payroll.js` duplicates its primary action in both places. Reviewed and confirmed
**not** bugs, matching existing house precedent: a cancelled job's stock reversal is unguarded
against going negative if the goods were already resold onward — same as `PURCHASE_REVERSAL_OUT` on
a purchase edit; a zero rate is accepted on a NET job's line the same way `needRate` validation
allows it everywhere else in the app (a deliberate free/promotional line, not a milling-specific
gap).

## Stock lying at the mill — Punjab stock (2026-09-20)

Client voice notes (two, pasted into a session; the second confirmed "it is fine just like this" for the existing job and added the
Punjab part): the mill in Punjab is handed wheat **by weight**, makes flour plus two or three by-products, and the finished goods are
often **left lying there** — "if 30,000 bags are made, we add it to our stock, noting that 30,000 bags are lying in Punjab; whatever
arrives here we deduct from that; whatever balance remains with them, the account is settled". The ERP needs a section that shows how
much weight was given, what was made, and exactly which products are still at the mill before they arrive.

**What the module did before (checked against the notes):** wheat out by weight, several products back, loss shown, net settled into the
mill's khata — all right. But every "received" line went **straight into our warehouse when the job was saved**, so goods lying at the
mill could not be represented at all. That was the gap.

- **A job now says where its finished goods are** — `receiveMode`: `AT_MILL` (the new-job default on screen: the produced goods are
  recorded, the mill's account is credited exactly as before, but **no warehouse stock is added**) or `DELIVERED` (added to the warehouse
  now — how every job worked before). A stored job **without the field means `DELIVERED`**, so existing data and the service default are
  unchanged; only the screen defaults to `AT_MILL`.
- **Arrival = one load reaching a warehouse** (`ERP.Milling.receiveArrival`, `MAR-…`, new store `millingArrivals`, lines embedded, DB_VER
  11→12). It adds the bags to the chosen warehouse and takes them off the balance at the mill. **Moves goods, not money** — the value was
  put on the mill's account when the job was posted, so an arrival never touches the supplier khata. Cost per bag on the stock movement =
  the job's own rate for that product (so the warehouse's moving average follows). It reuses the existing `MILL_RECEIPT_IN` /
  `MILL_RECEIPT_REVERSAL_OUT` movement kinds (refType `MILL_ARRIVAL` / `MILL_ARRIVAL_CANCEL`), so **nothing in shared core (`02-services.js`)
  changed** and stock value (module 37) reads arrivals like any receipt.
- **The balance at the mill is computed, not stored**: per mill + product, produced (posted `AT_MILL` jobs' RECEIVE lines) − arrived
  (posted arrivals), in bags and kg, valued at the job's cost per bag. `ERP.Milling.atMill / atMillBalance / atMillTotals`.
- **Rules:** an arrival can never be more bags than are at the mill (same product on two lines is added first); goods at a different mill
  don't count; no job ⇒ "Record the milling job that produced it first". **A job whose goods have already arrived cannot be cancelled**
  (names the bags; cancel the arrivals first) — otherwise the balance would go negative. Cancelling an arrival puts the bags back at the
  mill and takes them out of the warehouse again (unguarded against negative stock, like every other reversal here). Double-click safe
  (`clientOpId`). Weights are not guarded (a load can weigh a little differently from what the mill wrote); the kg column just shows the
  difference.
- **Screens:** Inventory & supply → **Stock at mills** (`PAGES.millstock`): cards (wheat given, made, arrived, still at the mill + worth),
  the per-product table, the list of loads (latest 100, Excel has all), a mill filter that falls back to "All mills" if its mill no longer
  holds anything, **Goods arrived** (mill → warehouse → date → vehicle/bilti → products with "N bags at the mill" beside each, weight
  auto-fills from the bag size, a before/after table, refuses too many on screen and in the service), Print per load, Cancel, Excel.
  The job entry gets "Where are the finished goods?"; the job list marks "Goods at the mill"; the printed job says where they are.
  Recording/cancelling needs `PURCHASE_CREATE`, like the jobs; viewing is open. Browser-side roles only, as elsewhere.
- **Form look + icons (same day):** the boxes in the job and arrival line tables (product, bags, weight, basis, rate) sat outside `label.f`, so they showed as plain browser boxes; they now match the app's fields (38px, 8px corners, themed border, violet focus, right-aligned numbers, "Bags"/"kg" hints; the phone already stacks them as labelled cards). Module 32's icon helper read `window.icon`, which does not exist (the base app's is `window.I`), so every icon on the Milling screens was silently blank — fixed here (modules 28/29/30 still have the same line). Looked at in real headless Chrome, desktop + 390px phone.
- **Tests:** `test-milling-atmill.mjs` (99 checks: the flow with three by-products, both mills, every refusal, cancel rules, legacy jobs,
  the screens driven through the DOM, the two documents, restart, the client's 30,000-bag example, full names), mutation-checked with eight
  deliberate breakages (an at-mill job still stocking the warehouse, no bag limit on an arrival, job cancel ignoring arrivals, an arrival not
  adding stock, product names back to `en||ur`, no guard row, no over-receipt warning, impossible dates accepted — each turns it red).
  `test-server-db.mjs` section J (7 checks) runs it on the server driver. `test-milling.mjs` (80) is unchanged and still green.
  **Test pitfall found here:** `document.body.textContent` also contains the source of every inlined `<script>`, so a check for a sentence
  that exists in a module passes even if nothing is drawn — read only rendered text (`test-milling-atmill.mjs` has `shownIn(win)`, which clones
  the body and drops `script`/`style`). Older tests that check body text for a phrase the module itself contains may be passing falsely.
- **Second pass (2026-09-21) — found by asking "what is still wrong", all fixed and tested:**
  (1) **Product names.** The dropdowns showed `en || ur`, but this catalogue's English name is often a fragment ("50 kg" for flour; the real name
  is the Urdu "سوجر 50 kg"). `fullName()` in 32: Urdu first (the app's convention), English after it only when it adds something; where one is
  contained in the other only the fuller one shows; the bag weight is appended only when the name does not already say it. **On screen each
  part sits in its own Unicode bidi isolate** (`isoName`, U+2068…U+2069) — plain Urdu-with-digits dropped into an LTR list reorders itself
  ("50 سوجر kg"); error messages and Excel use the plain text. The stored `productSnapshot` (`en||ur`) is unchanged, so print documents are as before.
  (2) **Stock at mills was not permission-gated** — `PAGES.millstock` was missing from the `ACCESS` map in `34-accounts.js`, so any role could open
  it; now `PURCHASE_CREATE`, like Milling (`test-accounts.mjs` covers it).
  (3) **Two windows working from old copies could both receive the same bags into different warehouses** — the server accepted both (they share
  no revision-checked record; proven by `test-server-db.mjs` J before the fix). Now every arrival, and every cancel of a job whose goods are at the
  mill, reads and rewrites one small shared row per mill (`meta` store, key `millguard:<millId>`, value = counter; `touchGuard` in 32), so the
  stale second save is refused ("NOT saved — reload"). Costs one tiny row per mill; nothing else reads those keys (`meta` is `k`/`v`).
  If negative at-mill stock ever appears anyway (old data, a job edited around it), the screen shows a warning banner naming product and excess.
  (4) A save with an impossible date (`2026-02-31`, text) or a warehouse that does not exist is refused (jobs and arrivals).
  (5) The mill's statement says "Finished goods made at the mill" (not "Received from mill") while the goods are still there.
  (6) A load that weighs more than the mill wrote leaves 0 bags and a negative kg: the table shows "weight difference", never a stock figure.
  (7) The job list Excel has a "Finished goods" column; the "Still at the mill" card is neutral (it is not a debt).
  (8) **`deploy-erp.sh` aborted after a fully successful upload** (2026-09-20): its last "Verifying" curl hit the same dropped-TLS-handshake
  as `deploy-api.sh` (exit 35) under `set -e`. The verify loop now retries and can no longer fail a good deploy.
  (9) **Goods lying at the mills shown beside the stock value, never in it** (`37-stock-value.js`, `SV.atMills()`): a "Lying at mills (not yet here)"
  card on the Stock value screen (links to Stock at mills; shows "with them: Rs …"), a second line on the dashboard card, a phrase on the Inventory strip,
  a separate line in the print/PDF totals and notes, two rows in the Excel summary. Whole-company view only — a warehouse / category / search filter
  shows none. Bags leave that figure exactly as they enter the warehouse figure (no double count; the warehouse side is blended into the row's moving
  average, so it matches only to whole-paisa rounding). Tests: `test-milling-atmill.mjs` V1–V11 (110 checks in the file now); `test-stock-value.mjs` unchanged.
  **Deployed 2026-09-21 ~01:35** (see "Payment search" → Deployed).
- **DEPLOY ORDER (new store):** `millingArrivals` is a new table. **Apply `database/schema-mariadb.sql`'s `milling_arrivals` table to the live
  database and run `scripts/deploy-api.sh` BEFORE `scripts/deploy-erp.sh`**, otherwise the first arrival is refused as an unknown store
  ("NOT saved"). A job saved with the new field needs nothing on the server (the `doc` JSON holds it).
- **Decision 2026-09-20: go with this as built; the two open questions are item 9 under "Open items" above (a: wheat not from our stock, b: goods at the mill in the dashboard/stock totals) — answer them before changing anything.**
- **Not built / to confirm with the client:** the wheat is taken from one of *our* warehouses' stock; if wheat is bought and sent to the mill
  without ever being in a warehouse, the issue is refused for lack of stock (unless negative stock is allowed) — say so and a "not from our
  stock" option can be added. Goods lying at the mill are **not** in the Dashboard / Stock-value totals (they are not in a warehouse); the
  Stock-at-mills cards show their worth separately. No per-load weight-difference report; no "as at a past date" view; no edit of a posted
  arrival (cancel and re-enter). **Not seen by anyone on the live site or a phone.**

## Change shop on an invoice (2026-09-19)

Business need: an invoice made out to the wrong shop must move to the right one — the shop and
nothing else. A shop's khata is *derived* from invoices, so this is an account move, not a label
fix. Previously the edit screen's Shop picker only rewrote `customerId`: receipts/allocations
stayed with the old shop (new shop got the debit, old shop kept the credit), and the edit route
re-validates stock against bags the invoice already took, so it failed once stock hit zero.

- `ERP.Invoices.changeCustomer(id, newCustomerId, {reason})` (`02-services.js`), one transaction:
  refreshes the invoice's shop snapshots (`Invoices.customerFields`, shared with `buildRecord`),
  sets `previousBalance` from the **new** shop as of the day before the invoice date, moves the
  receipts that belong *wholly* to this invoice (recomputing each one's stored `balanceBefore`/
  `balanceAfter`, which the printed receipt shows) and any dispatch notes linked to it, drops stale
  hand-typed shop/owner/code/contact/address/region/previousBalance overrides from the print
  sheet (kept in its revision history), writes an audit entry. Lines, amounts, number, date and
  stock are untouched — nothing is re-validated or re-deducted, no new number is spent.
- `Invoices.reassignCheck(id[, newId])` reports what would block it without writing. Refused (with
  a message naming the receipt/return): a receipt also applied to other invoices or partly left on
  account; any customer return (its credit note/refund is a fact about the old shop); a cancelled
  invoice. A reversed receipt does not block. Sales orders are deliberately left as they were.
- `Invoices.save` now rejects changing the shop on a **posted** invoice (drafts are still free);
  the edit screen locks the Region/Shop pickers for posted invoices with a hint.
- UI: "Change shop" panel (`PANELS.changeshop`: Area → Shop starting on a blank choice, balance
  before→after preview, optional reason), opened from the invoice list row and the document
  viewer. Gated by the existing `TRANSACTION_CORRECT` permission (Owner/Manager/Accountant) — no
  server-side permission change needed. Relax it in `04-documents.js`/`05-ui-builder.js` if wanted.
- Integrity page: new `Health.allocationCheck()` warns about any receipt applied to an invoice that
  belongs to a different shop — exactly what the old edit route could have left in live data. It
  only detects; there is no auto-repair (reverse and re-enter the receipt, or Change shop).
- Deliberately unchanged: stock movement notes and the source Sales Order keep the old shop name
  (history, not accounting); moving is repeatable (a wrong move can be moved back).
- `test-invoice-change-shop.mjs` (90 checks, mutation-tested: ten deliberate breakages each turn it red).
- **Pre-existing bug found, NOT fixed (unrelated)**: only ONE draft invoice can ever exist — the
  `invoices` store has a unique `invoiceNumber` index and drafts save with `invoiceNumber: ''`, so
  saving a second draft fails with "Transaction failed". Needs its own fix (e.g. store no number
  for drafts, or a non-unique/partial index) and a decision on existing data.

## Invoice search — finding old invoices (2026-09-19)

Client request: "add a search option to find old invoices easily by Invoice Number, Customer Name,
Date, or Product Name or any other." The Sales & invoices screen already had a search box, but it
couldn't really find *old* invoices: one substring test over a glued-together string (no Urdu letter
folding, no multi-word matching), the invoice **date was never in the searched text** (and the
`LIST.custom` date range the code half-supported had no controls at all), and it scanned the whole
line-items table once per invoice per keystroke and drew every invoice as a DOM row.

- New module `33-invoice-search.js` (`ERP.InvoiceSearch`) is the engine; the screen stays in
  `05-ui-builder.js` §37–39 (`ERP.InvoiceList` is now just remembered state + `results()`/`reset()`/
  `goPage()`); `06-wiring.js` got four small event edits (page reset, Clear, pager).
- **Index**: one normalised text index per invoice, built in a single pass over `S.invoiceItems`
  and dropped on `Mirror.refresh` (same approach as `11-search.js`, whose `ERP.Search.normalize`
  supplies the Urdu/English folding). Fields kept separate so "Search in" can scope to: invoice /
  order / dispatch / reference no., customer & phone, product, amount, notes & other.
- Every space-separated word must be found (AND, any order); substring match, deliberately *not*
  fuzzy (a filter list must be predictable — the Ctrl+K palette is the forgiving one). Phone numbers
  and invoice numbers also match with dashes/spaces removed. A customer is matched by both the name
  **printed on the invoice** (snapshot) and the shop's **current** name (looked up by id at search
  time, not cached, so a rename is seen immediately).
- **Dates typed into the box become a date filter**, not text: `12/09/2026`, `2026-09-12`,
  `12 Sep 2026`, `Sep 12, 2026`, `Sep 2026`, `09/2026`, `2026-09`, also in Urdu digits. Numeric
  dates are **day-first** (month-first only when day-first is impossible); the screen states how it
  read the date. A typed date replaces the date preset. Month-only numeric forms must stand alone
  so the tail of a number like `INV-2026-12` is not misread as December 2026.
- New controls: Search-in scope, Sort (newest/oldest/highest total/lowest total/highest balance
  due), date presets + Last 30 days / 3 months / 12 months / **Custom range** (From/To), Total
  from/to, Clear filters, **50 rows per page** (KPI cards and CSV still cover every match), and a
  "matched product lines" hint under the invoice number when a product search is why a row appears.
- Inputs that can never match (From after To, minimum above maximum) show a warning and an empty
  list instead of a quietly wrong one — the same principle as the Statement of Account date check.
- **Pre-existing bug found and fixed while reviewing this (`02-services.js`, `Reports.range`)**: it
  built dates with `toISOString()` (UTC) from local-midnight `Date`s, so anywhere east of Greenwich
  — i.e. Pakistan, the client — "Yesterday" was two days ago, "This week" started on a Sunday and
  "Last month" ran Jul 31–Aug 30 instead of Aug 1–31. Only the invoice list and the two period
  pickers in `06-wiring.js` (~lines 527/547, statement/export periods) call it; all now get correct
  local dates. Regression-tested in `test-invoice-search.mjs` under UTC, Asia/Karachi, Pacific/Auckland
  and America/Los_Angeles, and mutation-checked (old code restored → 4 checks fail with exactly that
  symptom). Other places that build dates from `toISOString()` were not audited.
- Covered by `test-invoice-search.mjs` (115 checks: every field, scope, all date forms incl. the
  day-first ambiguity and Urdu digits, ranges, presets, sorting, paisa totals, index freshness after
  cancel/new invoice, "never scans line items per invoice", and the real screen controls, CSV and
  paging). Full suite reruns clean.
- **Not verified in a real browser**: the layout (two filter rows, mobile wrap) was only checked
  through jsdom, which doesn't render CSS. Two Chrome-driven attempts failed because the automation
  browser cannot open *any* localhost page (even a plain directory listing shows Chrome's error
  page) — an environment limit, not an app fault. Eyeball it on a phone and a desktop after deploying.
- Not done: fuzzy/typo matching in this list, saved searches, searching the hand-edited print text
  (`12-invoice-editor.js`), Urdu month names in typed dates.

**Deployed live 2026-09-19** (Change shop + Invoice search, together; commits `6bebbcd`..`f8b2e0c`) via
`scripts/deploy-erp.sh` — full suite green first, Hostinger cache cleared for the ERP subdomain, and
verified byte-identical on the server and over HTTPS. No IndexedDB schema change, so no browser-data
migration was involved. **Rollback**: the previous live files are on the server in
`/home/u943531942/backups/erp-deploy-20260919233433/` — copy `index.html`, `farooq-co-erp.html`,
`farooq-erp-data.js` from there back into `public_html/ERP/`, then clear the cache again.

## Edit a purchase (2026-09-20)

Client request: "add an Edit option in Purchase Invoices too, like the one done in sales invoice." A
purchase is three things at once — the bags that came into stock, the supplier's bill, and any money paid
with it — so an edit re-states all three in one transaction (`ERP.Purchases.save`, same `FDB.tx` as a new
purchase). **`Purchases.save` already had an edit branch that no screen could reach, and it was wrong in
four ways** that this work fixed: it paid the supplier *again* on every edit (a second voucher for the full
"paid" figure); it gave every line a **new id** (supplier returns and landed-cost entries point at line ids,
so both were orphaned); it overwrote `createdAt`/`createdBy`/`description`; and it could push stock below
zero silently.

- **Where.** An **Edit** button on every row of the Purchases screen (column renamed *Actions*; injected in
  front of the row's "Invoice" button in `06-wiring.js`, matched by purchase number) and on the purchase
  document viewer (`data-fcv="edit"`, routed by `kind === 'PURCHASE'`). Opens the same builder as "Receive
  stock", pill reads "Editing PUR-…". Gated by `ERP.Purchases.canEdit`: `PURCHASE_CREATE` **or**
  `TRANSACTION_CORRECT` (Owner/Manager/Accountant; not Sales or Warehouse). Client-side only, like all roles.
- **Service API** (`02-services.js`): `toDraft(pu)` (inverse of `save`; blank *Received* = whole line arrived,
  a part delivery is spelled out; the overall discount is recovered as header discount − line discounts),
  `editErrors(draft, existing, totals)` (all the refusals below), `paidFor`, `paymentsFor`, `returnedQty`,
  `landedOn`, `supplierLockReason`, `canEdit`.
- **Stable line ids.** A line the edit keeps stays the *same record* (draft lines carry `purchaseItemId`),
  overwritten in place — only dropped lines are deleted — so supplier returns, landed-cost adjustments and
  `returnedQty` stay attached. A line that has bags returned or landed costs spread over it may change in
  quantity/rate but cannot be removed, change product/warehouse, or show fewer received than were returned.
- **Money is only ever added.** What is paid comes from the payment *allocations* (the truth), not the header's
  `paidAmount`. Raising *Amount Paid* writes one voucher for the difference; saving twice writes nothing; lowering
  it is refused ("reverse that voucher from Payments"); more than the bill is refused. Saving heals a header that
  a reversed voucher had left stale (`Payments.reverse` never refreshed purchases — pre-existing, left alone).
  The extra voucher is dated the **purchase date**, same as the sales edit does for an invoice.
- **Stock guard on the net change.** Old received bags come out, new go in; per product+warehouse the
  *difference* must fit what is on the shelf now (unless `allowNegativeStock`). So an edit that touches only a
  note or rate never fails just because the bags were since sold, but cutting a load below what has been sold is
  refused, naming the figures. Movements written are the existing `PURCHASE_REVERSAL_OUT` + `PURCHASE_IN` pair.
- **Supplier can change only while nothing is attached** (no voucher paid against the purchase, no supplier
  return on it): the bill then moves between the two suppliers' accounts. Otherwise the picker is locked with the
  reason shown. There is **no "Change supplier" action** like sales' "Change shop" — not built.
- **Cost.** `17-profit.js`'s `Purchases.save` wrapper now also re-averages a product an edit removed from the
  purchase (otherwise its average kept counting a purchase that no longer contained it). If *no* purchase is left
  for that product/warehouse the old average is kept (edge of an edge; not reset).
- Double-clicked Save is refused as a duplicate (`clientOpId#revision`, as for sales). The audit entry carries
  the figures before and after.
- **Second pass (same day) — bugs found by re-reading the neighbouring code, all fixed and tested (L-section):**
  (1) `Purchases.receiveMore` added stock but never set `stockApplied`, so an edit of a purchase that had a later
  delivery skipped the reversal and **counted those bags twice** — the reversal and the stock guard now go by what
  each line actually *received*, not by the flag, and `receiveMore` sets the flag; (2) `Payments.reverse` never
  refreshed a purchase, so after a voucher was reversed the Purchases list and the document still said "Paid" —
  new `Purchases.refreshPaymentState`, called from `reverse` (pre-existing bug, and exactly the step the edit
  screen tells the user to take); (3) the stock reversal is dated as the **original** delivery, the new receipt
  on the corrected date; (4) a line whose product no longer exists keeps its saved wording instead of going blank;
  (5) the builder now shows a since-deactivated warehouse as "(inactive)" instead of a different one (**this also
  fixes the same latent problem on the sales edit**); (6) the card says "Edit purchase" / the button "Save changes".
- **Not built / not changed:** there is still **no way to cancel or delete a purchase** (Edit is the only
  correction tool); "Change supplier" as its own action; tax has no input on the builder (a line's stored tax is
  carried through unchanged); **sales profit is not recalculated by a purchase edit** — each sale line's cost is
  fixed on the day of the sale (by design, module 17), so editing an old purchase's rate changes stock cost going
  forward, not past sales; a voucher's printed "balance before/after" is a snapshot and is not rewritten by an edit.
- `test-purchase-edit.mjs` (93 checks: round trip, changes, money, lines, part deliveries, the stock guard,
  supplier returns, landed costs, supplier change, double submit, restart persistence, and the real screens
  incl. the role gate), mutation-checked with five deliberate breakages (pay twice, new line ids, no edit
  rules, createdAt overwritten, supplier never locked — each turns it red). `test-server-db.mjs` section H (6
  checks) runs the same edit on the **server driver**: kept line overwritten in place, dropped line deleted,
  one extra voucher, and a second window editing from a stale copy is refused. **Not seen by anyone yet:** the
  new Edit button and edit screen in a real browser / on a phone (jsdom has no layout), and an edit against the
  real MySQL API (`php` is not installed on this machine; `test-gate.mjs` also skips for that reason).
- **Deployed live 2026-09-20** (commits `4a5c75f` + `1ef0ddd`) by the user running `scripts/deploy-erp.sh` (full suite green
  inside the script first); Hostinger cache cleared for the ERP subdomain from a Claude session. Verified in the user's
  signed-in Chrome: the file the gate serves is byte-identical to the local `dist/` build (1,872,122 bytes, SHA-256 checked
  in the page), the app frame has the new API on the server backend, and both real purchases (PUR-2026-000001/2) show Edit
  next to Invoice under an *Actions* column. The edit form was seen opening live ("Save changes", the paid hint) but **no
  real purchase has been edited yet** and nothing was saved during verification — try a harmless edit (a note) on one first.
  Rollback: `/home/u943531942/backups/erp-deploy-20260920155305/` (copy the three files back into `ERP/_app/`, clear cache).

## The top bar and the phone dashboard (2026-09-20)

Client-facing complaint: on a phone the header was ~180px tall with the page title squeezed to a
sliver (even on desktop it wrapped to two lines). Root cause: modules 06/11/22/31 each injected a chip
or link "before the bell" — *inside the bell's block-level wrapper* — so they stacked vertically.

- New module **`35-topbar.js`** (`ERP.TopBar`) owns the bar; `10-mobile.js` no longer styles it.
  One 58px row at every width (verified in real Chrome, 320px→1440px, no horizontal overflow; light and
  dark): hamburger · title · search · (theme) · bell · avatar. Safe-area inset respected.
- **Removed, deliberately:** the *warehouse picker* (no code anywhere read it — the real warehouse
  filters are the dropdowns on Inventory etc.; a control saying "All warehouses" that does nothing is
  worse than none) and the *"Connected · Last synced 2 minutes ago"* pill (hard-coded text, inert
  button — it never reported anything). Removed at run time by 35 (the base markup and its 3 boot lines
  are left alone so the base script cannot throw).
- **The avatar is now a real account menu** (initials of the signed-in person, not a hard-coded "FA").
  It holds the elements other modules create — **moved, not copied**, so ids and behaviour are unchanged:
  `#fcUserChip` (header, "switch user"), `#fcDbChip` (the Saved status), `#fcCompanyLink`,
  `#fcSignOutLink` — plus Company accounts and a Dark/Light-mode row (the bar's own theme switch is
  hidden ≤600px). If the database chip is ever `warn`/`bad` the **avatar gets a coloured dot**, so a
  storage problem cannot hide inside a closed menu. **Never wrap the text of `#fcCompanyLink` /
  `#fcSignOutLink` in child elements** — module 31 recognises their click by `e.target.id`; their icons
  are CSS masks for that reason.
- Search is the box on a desktop and an icon button everywhere ≤900px (it used to vanish entirely between
  761 and 900px). The sidebar-collapse button is hidden ≤900px (the drawer replaces it). The bell's red
  dot only shows while some product is low or out of stock.
- Phone dashboard (`10-mobile.js`): KPI figures two-across instead of one long column; a notice with a
  button (`.banner > .r`) puts the button under the text; card titles stay on one line.
- Tests: `test-topbar.mjs` (34 checks, mutation-checked with four deliberate breakages),
  `test-accounts.mjs` (51) and `test-auth-client.mjs` (64) updated for the moved password change.
  jsdom has no layout — the visual result was checked with headless Chrome screenshots, not by the tests.
- Not done: the Profit & margin block on a phone is still four stacked period cards (tall, but readable);
  the warehouse PWA and the invoice editor were not touched.
- **Deployed live 2026-09-20** (commit `cacde9b`) by the user running `scripts/deploy-erp.sh` (the auto-mode
  classifier blocks it from a Claude session). Verified afterwards: the file the gate serves
  (`_app/farooq-co-erp.html`, md5 `86f5fba4…`, 1,854,120 bytes) is byte-identical to the local `dist/`
  build, which contains `35-topbar.js`; Hostinger cache cleared; the user confirmed the new bar in their
  own browser. The deployed build also carries module 1b (server data driver, switch OFF) from another
  session, so the **repo's `app/` and `_app/` copies (my earlier build) lag the deployed bytes** — harmless,
  the next deploy rebuilds from the module sources; re-sync them from `dist/` when convenient.
  **Never seen by anyone on the live site:** a physical phone / iOS Safari / a notched device, the live
  Sign out and Company sign-in rows, the Company accounts "My account" card, and the reduced menu a
  non-owner gets (tests only, with a mocked server).

## The UI kit — no more browser chrome (2026-09-20)

Request: "all scroll bars, drop downs, popups, alerts and other chrome default UIs — replace with our theme."
New module **`36-ui-kit.js`** (`ERP.UI`, also `window.FcUI`). Everything the browser used to draw now wears the
app's colours (derived from `--violet`, `--surface`, `--line`… with fallbacks, so dark mode follows for free):
scrollbars (WebKit pseudo-elements; `scrollbar-color` in Firefox), dropdown lists, the date / month calendar,
`confirm` / `prompt` / `alert` dialogs, `[title]` tooltips, checkboxes / radios, the file button, number
spinners, search-clear, autofill wash, selection colour, `color-scheme`, and the phone address-bar colour
(`theme-color`, also set on the launcher around the ERP when same-origin).

- **The rule that keeps it safe: the real control stays in the page.** A `<select>` is still the real select
  (value, `change`, `.focus()`, re-rendering, every test unchanged) — only the popup is ours; a date input keeps its
  typeable segments — only clicking its calendar icon opens ours. Nothing is wrapped or moved, so existing CSS selectors
  (`label.f select`, `.fld select`…) keep matching. Escape hatch: `data-fc-plain` on a field leaves it to the browser.
  `<select multiple>` / `size>1` are left native.
- **Dropdowns**: search box when there are more than 8 options (shop and product pickers hold hundreds), keyboard
  (arrows, Home/End, type-ahead, Enter, Esc, Tab), option groups; on a phone (`≤640px` or coarse pointer) it is a bottom sheet.
- **Dialogs are Promises**, not synchronous: `ERP.UI.confirm(q, {detail, okText, cancelText, tone})`,
  `ERP.UI.prompt(q, {label, placeholder, required…})` (→ `string`, `''` = left blank, `null` = cancelled), `ERP.UI.alert`.
  `tone: 'danger'` = red button and the SAFE button starts focused. All 13 `confirm()`/`prompt()` calls in the modules were
  converted (`test-ui-kit.mjs` G2 fails if a native call comes back). The base app's own "Clear all data" `confirm()` is
  intercepted in `36` (ask ours, then re-run the original click with its `confirm` answered).
  **Test seam:** if a host has REPLACED `window.confirm/prompt/alert` with a non-native function (every existing
  `test-*.mjs` does: `w.confirm = () => true`) that replacement is used and no dialog is drawn. A browser's own function is
  the only thing the kit supersedes.
- **Price editor (`21-settings.js`) is the one behaviour change**: a panel's `save()` must answer synchronously (an error string
  keeps the panel open), so a modal can't sit inside it. "Selling below purchase price" now shows in the panel ("Nothing has been
  saved yet. Press Save again to keep these prices anyway") and saving the *same figures* again confirms; changing them asks again.
- The emergency overlays in `01b-server-db.js` ("Your last change was NOT saved") use the app's tokens with literal fallbacks
  (they must still work if the app CSS never loaded).
- **Warehouse app**: `build.py` injects the same file into `farooq-co-warehouse-pwa.html` and re-embeds it in the launcher
  (`pwa:` blob; before, only the `erp:` blob was rebuilt). The kit reads whichever token names the host has; `.sel>select` keeps
  the PWA's own chevron.
- **Cannot be themed by any page, left native on purpose:** the OS file chooser, the print dialog, the browser's "Leave site?"
  prompt (`beforeunload`, module 01/12). Firefox: the browser's own date field is left alone (the calendar hook needs
  `::-webkit-calendar-picker-indicator`; `CSS.supports` decides — `FcUI.dateHook` overrides for tests).
- Tests: `test-ui-kit.mjs` (160 checks: bare kit page + the real ERP + the PWA + the launcher blobs; an exit hook fails the run if a
  promise never settles; mutation-checked with five deliberate breakages). **Verified in a real headless Chrome** (driven over the
  DevTools protocol with real mouse and touch events, light + dark, desktop + 390px phone): computed scrollbar 11px / 99px radius,
  real click opens the list, real tap opens the sheet, calendar icon opens ours while a segment click still types, tooltips on hover,
  dialogs, checkboxes on Master data. **Not seen by anyone:** a physical iPhone / Android (whether `preventDefault` on the
  emulated mousedown really stops the native picker on iOS Safari is unverified), Firefox, Safari desktop.
- Pre-existing, not changed: in dark mode the filter pills on list screens have light borders (`--ink-2` in the base CSS — identical
  with the kit removed).
- **Deployed live 2026-09-20** (commit `18cd42f`) by the user running `scripts/deploy-erp.sh` (full suite green inside it; the permission
  layer refused it when a Claude session tried, so it was handed over); Hostinger cache cleared for the ERP subdomain from a Claude
  session. Verified: the gated files on the server are byte-identical to a fresh build of that commit in an isolated worktree
  (`_app/farooq-co-erp.html` md5 `05314bbd…`, 1,942,630 bytes; `_app/index.html` md5 `85286e05…`), site answers 401 (gated, healthy).
  Rollback: `/home/u943531942/backups/erp-deploy-20260920205449/` (copy the three files back into `ERP/_app/`, clear cache).
  **Not yet seen on the live site by anyone:** the themed dropdowns / calendar / dialogs in the user's signed-in browser, a physical
  phone, Firefox. Run a `deploy-erp.sh` from the repo root (`cd /d/projectFarooqAndCoTraders && ./scripts/deploy-erp.sh`); it takes
  over 2 minutes, so from this tool it moves to the background — do not start a second run (the lock refuses it, correctly).

## Areas (regions) — add, rename, delete (2026-09-20)

Client request: "editing / adding / deleting region name isn't available right". Three causes, all fixed in
`18-master-data.js` (+ two one-line edits):
- **Regions could only be *added* where people looked.** The base app listed them on the Shops page (a chip row) and in
  Settings, add-only, through its own old "Add region" panel; the full Edit / Archive screen ("Areas & salesmen") was a
  different, buried page, and nothing anywhere could delete. Worse, since Settings was rebuilt in sections (module 21) the old
  **Regions and Warehouses cards are not shown in Settings at all** — 21 only files cards that are direct children of the old
  page and those two sit in a nested column — so the Shops-page chip was the only control left. (The Warehouses card, with its
  Rename / Remove / Add, is still missing from Settings; not touched, not asked for.)
- **Delete did not exist.** `Areas.remove(id, {moveTo})`: refuses unless the caller says where the area's shops go (a different,
  *active* area), then moves the shops, takes the area off its salesmen, marks it deleted and writes the audit entry in ONE
  `FDB.tx` (all or nothing; on a failed save the in-memory copies are put back). Owner/Manager only (`MASTER_DATA_ARCHIVE`), in the
  button and in the service. Delete panel = `PANELS.deletearea`; button on every Areas row and on the new Settings card.
- **A plain delete would not have stuck — this is the non-obvious part.** The base app re-seeds its built-in areas on every
  boot, each browser keeps a saved copy (`farooqco_erp_v1`), and `mergeMasterFromDb` only ever adds/overwrites, never removes. So a
  removed area came back the next time any *other* device opened the app and was written straight back to the server. A deleted
  area is therefore kept as a hidden marker `{deleted: true, active: false, deletedAt}` in the same `regions` record; it travels
  through every channel the area did, so it wins everywhere. `Areas.all()/active()/byId()` and `REGS()` (05) hide it;
  `Areas.raw()` and `global.REGIONS` still hold it. Verified by mutation: a hard delete makes `test-areas.mjs` fail because the
  built-in `rg-drosh` reappears after a restart in a fresh browser. The invoice-list Region filter still offers a deleted area,
  marked "(deleted)", so old invoices stay findable.
- **History is untouched.** Invoices, payments etc. store `regionId` + a text `regionSnapshot`, so a deleted area's past documents
  still read correctly. `Reports.byRegion` (02) now labels a group with the area's *current* name when it exists (so a rename shows
  up), else the snapshot.
- Also fixed in `Areas.save`: an **Urdu-only name got the id `rg-`** (a second one collided); names are now trimmed, a blank field
  falls back to the other language (as the base panel did), the **Urdu** name is duplicate-checked too, only a name that is *being
  changed* can clash (an older duplicate no longer blocks editing the other field), a new id that is taken — including by a deleted
  area — gets a fresh unique one, and the base app's saved copy is refreshed (`dbSave`). The base `PANELS.region` ("Add region") now
  delegates to the same code. New top-level **Regions card in Settings** (General & business) with Rename / Delete / Add / a link to
  Areas & salesmen; the Shops page gets a "Manage areas" chip.
- Tests: `test-areas.mjs` (see the count below; service rules, the three screens, salesmen, audit, failed-save rollback, role gate, and a restart
  in a browser with no saved copy); the whole suite reruns clean. Looked at in real headless Chrome (desktop + 390px phone).
  **Not seen by anyone on the live site**, and a delete has not been run against the real MySQL API (`php` is not on this machine) —
  the save is one write per shop moved (at most a few hundred) + the region + the audit row, far under the API's 5,000-operation limit.
  The full suite (all harnesses; `test-gate` skips without PHP) passed on a build of `HEAD` + only these files.
- Limit worth knowing: two windows open at once — one deletes, the other still shows the old list — is the general stale-window case
  (the server's revision check refuses the stale save and says "reload"); nothing area-specific was added for it. (Now tested, see below.)
- **Second pass (same day) — edge cases found by auditing the first, all fixed and tested:**
  (1) **Names are written into pages unescaped** (the base `u()` helper, and `data-row="…"` attributes, do not escape), so an area name
  containing `<`, `>` or `"` would run as markup on every screen that shows areas — `Areas.save` now refuses those characters.
  (2) The Urdu duplicate check now folds letter variants the way search does (`ERP.Search.normalize`: ي/ی, ك/ک, ہ/ه, diacritics, punctuation),
  so the same name typed with Arabic letters is still a duplicate. (3) Two deletes of one area at once: the second is refused
  (`Areas._deleting`), nothing done or audited twice. (4) **A screen that remembered the deleted area was left filtered to nothing under an
  "All areas" label** (Area-wise report, Statement of Account, collection sheet, the base Shops-page filter): new `Areas.onDelete(fn)`
  hook; 18 resets the collection sheet and the base `FIL.region` (a script-level `const`, readable by bare name from another script,
  not through `window`), and 28 / 29 reset their own private state. Deleting a *different* area leaves the choice alone.
  (5) The **warehouse PWA** copied every region from the shared record and would have offered deleted and archived ones
  (`app/farooq-co-warehouse-pwa.html`, one line). (6) **Server mode was untested** — `test-server-db.mjs` section I (8 checks, on the mock that
  follows `api/_data.php`'s rules): the delete arrives with the marker, all shops moved and the audit row; a fresh device, a device with an
  old saved copy, and a window opened before the delete can none of them write the area back (the last is refused "NOT saved"); a delete whose
  commit fails leaves the server untouched and the screen as it was. Mutation-checked: a real removal instead of the marker fails five of
  them (I6 shows the built-in area written back to the server as revision 1), and each of the other safeguards fails its own checks.
- `test-areas.mjs` is now 59 checks. **Still not built (say so if asked):** an *undo* for a delete (the audit row lists the moved shop ids, but
  there is no button; re-adding the name makes a new area, the shops must be moved back), a bulk "move all shops to another area" without
  deleting (merging two areas is delete-with-move today), and the **Warehouses card** missing from Settings (same root cause as Regions;
  its handlers `data-whedit` / `data-whdel` / `data-whadd` still exist in the base app).

## Stock value — what the goods in the warehouses are worth (2026-09-20)

Client request: "right now the goods we have in the warehouse, how much money's worth of it is lying there for us…".
Answered as **bags on hand × the cost per bag the ERP already keeps** — what the stock *cost*, not what it might sell for. **Nothing
new is stored: no table, no API and no schema change**, so this is an app deploy only (`deploy-erp.sh`); nothing to apply on the
server first.

- New module **`37-stock-value.js`** (`ERP.StockValue`: `build({warehouseId, category, q, noSell})`, `docModel`, `sheets`, `today`). Shown in
  three places: a **Stock value (at cost)** card on the Dashboard (right after "All bags available"; keyboard-reachable), a value strip
  on Inventory (total + each warehouse), and its own screen **Inventory & supply → Stock value** (KPI cards, split by warehouse and by
  category, every product biggest-value-first, warehouse/category/search filters, Print/PDF, Excel). On-screen product table capped at
  300 lines; print/Excel are complete. Needs **`FINANCIAL_REPORT_VIEW`** (Owner, Manager, Accountant — already in the server's
  `auth_role_permissions`, no change there) because it reveals purchase cost; Sales and Warehouse roles get a locked notice and the
  card/strip are simply absent. Browser-side gate like every role. The dashboard and Inventory call `build({noSell:true})` — they only
  need cost, so the selling-price work (price list, last invoiced rate) is skipped on every paint.
- **Where a row's cost per bag comes from, in this order** (each labelled on screen and in Excel):
  1. **recorded** — the row's own `avgCostP`, kept by purchases and milling receipts.
  2. **carried in** — the bag-weighted average of the cost written on the `OPENING_STOCK` / `ADJUSTMENT_IN` / `TRANSFER_IN` movements
     that brought stock into that row. A **transfer moves bags but not cost** (and "Add stock" never feeds the average — see the
     finding below), yet the cost *is* on the movement, so it is read from there. Not called an estimate.
  3. **from other warehouse** — a row with stock and no cost anywhere on its own movements borrows the same product's cost elsewhere
     (the rule `Inventory.costOf` uses when costing a sale). Not called an estimate.
  4. **estimated** — only where no purchase or movement carries a cost, the product's own `buy` price; flagged and totalled separately.
  5. **no cost** — left out of the total (never counted as zero-and-hidden) with a warning naming the products/bags.
  Damaged bags are not in the main figure (their own card, with "N have no cost" if applicable). Negative stock (only if the owner allows
  it) is left out and flagged. Selling-price value is secondary: the price set on the product, else the last non-cancelled invoiced
  rate, else "not priced" (the column pair is hidden while nothing is priced). When *nothing* has a cost yet the headline reads "—
  cost not recorded yet", never "Rs. 0". It is the position **right now** (no "as at last month": the app keeps balances, not a daily
  stock history). "Today" is the **local** date (`toISOString()` would say yesterday in Pakistan until 05:00).
- **FOUND, NOT FIXED — decide before relying on margins from opening stock:** the **Add stock** screen has a *Cost* field ("e.g. opening
  stock count, own production"), but `Inventory.apply` only feeds a row's moving average from `PURCHASE_IN` / `MILL_RECEIPT_IN`. A cost
  typed there is saved on the movement and nothing else, so a later **sale out of that stock is costed by `Inventory.costOf`
  (02-services `costSnapshot`) from the row's empty average → another warehouse's average → the product's `buy` price → 0** — never the
  typed cost. Stock value reads the movement, so *it* is right; the margin reports are not. Making
  `ADJUSTMENT_IN`/`OPENING_STOCK` with an explicit cost feed the average is a shared-core change that moves profit figures, so it wants
  its own decision. (Also noted while here: `Cost.weightedAverage` counts purchase lines only, so transferred-in bags are not part of
  a destination row's purchase-kept average.)
- **Real data at the time (2026-09-20)**: the server held 3 inventory rows, one with stock (20 bags × Rs 3,000) and **0 of 138 products
  with any buy/sell price set** — so today's headline is small and the selling-price figure reads "No selling prices set yet" until
  purchases/prices are entered. That is the data, not a fault.
- **Edge cases covered** (`test-stock-value.mjs`, 99 checks, **mutation-checked with 15 deliberate breakages**): every cost source and
  their precedence, two lots averaged by bags, a no-cost receipt, stock in a warehouse that no longer exists ("Unknown warehouse (id)"),
  a remembered warehouse/category filter whose target is gone (resets to All — otherwise the dropdown says All while the list is
  filtered), keyboard Enter on the dashboard card, the local-date rule under a faked 22:30 UTC clock in Asia/Karachi, five roles on a
  restarted window. Looked at in **real headless Chrome** (desktop 1320px + 390px phone, light + dark), which caught two layout bugs
  jsdom cannot see: the base `.tbl` forces `min-width:1050px` (tables ran off their cards — `table.sv-tbl{min-width:0}` overrides it)
  and the base styles a `<b>` inside a `.banner` as a block (a sentence split in two — headline in `<b>`, detail in `<p>`).
- **Found, not fixed here (unrelated, pre-existing)**: the base app exposes its icon function as `window.I`, **not** `window.icon`, yet
  modules 28/29/30/32 define `function I(n){ return global.icon ? global.icon(n) : ''; }`, so their icons silently never rendered
  (Area-wise, Statement of Account, Payroll, Milling). Module 37 uses `global.I`. Another session had these files open when this was
  written — check `git log` before assuming it is still open.
- Not built: a value line on each warehouse card of Inventory; valuation as at a past date; per-batch (FIFO) valuation; a "value if sold"
  margin.
- **Deployed live 2026-09-20 ~22:25** (commit `3f3eb1d`, in the same deploy as the two Areas commits `f5623ce`/`3f3eb1d`). It was made from a
  **clean local clone of `HEAD`** so another session's uncommitted "Pay a shop from the Payments screen" work (`06-wiring.js`,
  `test-pay-a-shop.mjs`) was NOT included — the user asked for exactly that, once. `scripts/deploy-erp.sh` refuses a dirty tree and keeps
  its lock in `.git/`, so from a busy checkout: `git clone --no-hardlinks <repo> <tmp>` (plain `--local` fails on hard links here), copy
  `erp-upgrade/node_modules` in, run the script from the clone. Full suite green inside the script (34 harnesses). **The script's own final
  `curl` failed with exit 35 (SSL handshake in this shell) and aborted it AFTER the uploads** — nothing wrong on the server: `_app/` and
  `app/` md5s (`index.html` `0f21c248…`, `farooq-co-erp.html` `32b6cb52…`, `farooq-erp-data.js` `bf0bf077…`) equal the clone's `dist/`, no
  `.uploading` leftovers, the gate answers `401`, the homepage `200`, the data file `401`. **The Hostinger cache was NOT cleared** (the
  hostinger-hosting MCP server timed out on connect) — clear it in hPanel, or with `hosting_clearWebsiteCacheV1` once it connects. No API or
  schema change, so no `deploy-api.sh`. Rollback: `/home/u943531942/backups/erp-deploy-20260920222516/` (copy the three files back into
  `ERP/_app/`, clear cache). **Not yet seen on the live site by anyone in a signed-in browser, or on a physical phone.**

## Payment search — the Payments screen's search bar (2026-09-21)

Client request: "search bar of payment and invoice". The invoice list already had the 2026-09-19 search; the **Payments screen did not**:
its box said "Search shop or reference…" but the base app only indexed `"<shop> <method>"` per row — a cheque/transaction reference, receipt
number, amount or date could never be found, Urdu letter variants and word order mattered, the Paid-to-shops list and the reversed vouchers were
not filtered at all, and the "Receipts & vouchers" log stopped at the latest 200 payments with no way to reach older ones.

- New module **`38-payment-search.js`** (`ERP.PaymentSearch` engine + `ERP.PaymentList` screen state). Same rules as the invoice search on purpose
  (its date parsing, Urdu/English folding, AND-of-words, "search in", custom From–To, amount range come from `ERP.InvoiceSearch.util`, exported
  from 33 for this): index per payment = receipt/voucher no., party (printed name AND the shop's *current* name/phone/owner/region, looked up at
  search time), reference, invoice/purchase numbers it was applied to, amount, date, notes & other. Filters: kind (received / paid to shops / paid
  to suppliers), method, region (a supplier has none, so it drops out while one is chosen), dates, amount, sort. Impossible inputs (From after To,
  min above max) are said on screen. CSV = every match.
- **It replaces `PAGES.payments`** (it loads after 06-wiring.js and does not call the earlier wrapper). `06-wiring.js`'s `paidToShopsSection` and
  its `PAGES.payments` wrapper are now **dead code** — the screen is drawn from 38. Kept from that work: `data-fcpayopen` (start a payment with no
  shop pre-selected — its click handler is still in 06), `#fcPaidToShops`, `data-fcreceipt`, the "No payments to shops yet" text.
  The screen: 4 figures (Paid out now counts shops as well as suppliers), search + filter bars, Customer payments, Paid to shops, Supplier payments,
  and a **Reversed receipts & vouchers** list (only when there are some; counted in no total). Each list shows 100 rows and a "Show more" button —
  nothing is unreachable; a receipt/voucher number column was added because people now search by it.
- **Invoice list** (`33-invoice-search.js`): also finds the invoice a receipt paid — a cheque/transaction **reference** from "Everything", the receipt
  number and method through the new **"Receipt / payment ref."** choice. The receipt number is deliberately *not* in "Everything": `REC-2026-000001`
  has the same shape as `INV-2026-000001`, and it made searching the tail of an invoice number also return other invoices (`test-invoice-search`
  N3 caught it). The same collision exists in the Payments box in a milder form (an invoice number's tail also matches a receipt's) — both rows say
  their number, so it is visible why they match.
- Auto-allocation surprise worth knowing: a receipt entered with no invoice chosen is applied to the shop's *oldest unpaid invoices*, so "payments
  for invoice X" also lists those, not just ones the person ticked.
- Tests: `test-payment-search.mjs` (104 checks: engine, every filter, the real controls, paging, CSV, focus kept while typing, the invoice-list
  addition); mutation-checked with six deliberate breakages (each turns it red). `test-pay-a-shop.mjs` S1–S17 still pass unchanged against the new
  screen. Looked at in real headless Chrome (desktop 1320px + 390px phone). **Not seen on the live site or a physical phone.** App deploy only
  (`deploy-erp.sh`) — no table, no API change.
- Not done: search inside the printed receipt text; per-shop payment search on a shop's own page; fuzzy/typo matching (the Ctrl+K palette does that).
- **Second pass (2026-09-21, "any edge case left?") — found by tracing the neighbouring code, fixed and tested (`test-payment-search.mjs` X1–X22, 126 checks now, each new behaviour mutation-checked):**
  (1) **`PANELS.paysup` ("Pay supplier") could pay the wrong mill.** `PAY_FOR` is shared with "Receive payment" — after "Payment" on an invoice it holds a
  SHOP's id, no supplier option matched, the browser silently showed the FIRST supplier and the banner said "Payable: 0"; a stale `PAY_FOR`/`WATARGET` from
  another screen did the same. Now only a supplier that is really in the list is pre-selected, otherwise the choice is blank ("— Choose a supplier —"), Save
  refuses without one, and the "Payable" banner follows the chosen supplier (it was static). The Payments screen's button goes through `data-fcpayopen="paysup"`
  (clears `PAY_FOR`, and `WATARGET` — a lexical `let` of the base script — before opening). The routes that should pre-select still do (a supplier's own
  page, Statement of Account → "Pay this supplier"). This is a change in `06-wiring.js`.
  (2) A payment recorded while a search/filter hides it looked unsaved: the screen now says "The payment you just recorded, REC-…, is saved but hidden by the
  search or filters above" with a Clear button (answered by touching any control). (3) The Print button of the old toolbar came back. (4) The index also notices a
  reversal made in another window (a reversal changes no record count). (5) **Invoice list:** a row found through a receipt/cheque now says "Paid by REC-… (CHQ-…)"
  under the invoice number, as a product hit already did (`hitsFor` returns `pays`; rendered in `05-ui-builder.js`).
  Checked in real headless Chrome with real mouse and keyboard: the themed dropdown drives the Kind filter, typing keeps focus, "Show more" does not jump the scroll.
- Reviewed, found correct, no change: the other sessions' `Payments._write` `balanceAfter` fix and the Pay-a-shop balance preview (3a5f708), the milling second
  pass (`meta` guard row — the `meta` table exists in `schema-mariadb.sql`), stock-value "Lying at mills" (d3d9017). Full suite: 38 harnesses, 0 failing.
- **Deployed live 2026-09-21 ~01:35 — everything of all sessions in one deploy** (`main` = `f55a6fc`, local = origin, nothing stashed, no PRs, both other sessions confirmed
  "nothing pending"): payment search + Payments screen (38), the invoice "Paid by" hint, the Pay-supplier fix, Pay a shop on the Payments screen + balance preview +
  `balanceAfter` fix, and the Stock-value "Lying at mills" line. Run from a clean clone of `main` (`git clone --no-hardlinks` + `node_modules` copied in) so nobody's
  edits in the shared folder could leak in; full suite green inside the script (36 harnesses; `test-gate` skips without PHP). Backup of the previous live files:
  `/home/u943531942/backups/erp-deploy-20260921013522` (rollback = copy its three files back into `ERP/_app/`, clear cache). Verified: `_app/index.html` md5 `9200ad20…`,
  `_app/farooq-co-erp.html` md5 `01dad76a…` (contains module 38), `_app/farooq-erp-data.js` md5 `bf0bf077…` are identical to the clone's `dist/`; `app/farooq-co-erp.html`
  identical; no `*.uploading` leftovers; the ERP answers `401` (gated, healthy), the homepage `200`. Hostinger cache cleared for `erp.farooqandcotraders.online`
  (`hosting_clearWebsiteCacheV1`, accepted). No API or schema change, so no `deploy-api.sh`. **Still not seen by anyone in a signed-in browser or on a physical phone:**
  the Payments screen (search box, filters, Show more, Print), the Pay-a-shop and Pay-supplier panels, the "Paid by" hint, the "Lying at mills" card — check them once live.

## The Warehouse app is on the database, and there is no idle lock (2026-09-21)

Request: "shift the warehouse app too to db, I want my whole system on the db" and "remove the option that when the system is idle the
password is asked again". Full design, decisions and limits: **`docs/SERVER_DATA.md` §8 and §9** (the current guide). In short:

- **Warehouse app.** Before, the launcher's *Warehouse* tile kept a stock map in the browser (`farooqco_erp_v1`) that the office app overwrote
  from its own tables — a bag received/dispatched there never reached the real stock, and its offline queue was never persisted. Now, with
  `data_backend` = `server`, the page reads the company database and saves through the SAME driver as the office (`01b-server-db.js`) plus
  a small module of its own, **`erp-upgrade/39-warehouse-server.js`** (`window.FcWH`). `build.py` injects modules 1, 1b and 39 in front of
  the page's own script (`inject_warehouse_data`); the page source is `app/farooq-co-warehouse-pwa.html` (it now has a server path beside the
  old browser path — the switch off, or no server API, gives exactly the old behaviour).
  - *Receive* = a `RECEIVE` stock document `RCV-…` (bags only, no money). *Dispatch* = a `DISPATCH` document `DSP-…` naming the shop, with an
    optional link to the shop's invoice: if that invoice already took the bags out of stock the dispatch does NOT take them out again (the
    office's own rule). Stock rows and number counters are re-read from the server before every save; a lost race is refused whole. No offline
    entry. Entries are attributed to the signed-in person (`status.php` now returns `user.name`).
  - Server API additions (deploy `deploy-api.sh` BEFORE the app): `read.php?stores=…&recent=N` (newest N rows, 1–1000) and `name`/`username`
    in `status.php`'s `user`. Driver additions (`01b`): `FDB.server.{hot,onStale,loadPartial,rows,user}`.
  - **Tests:** `test-warehouse-server.mjs` (66 checks: the real page in jsdom on the shared `test-mock-server.mjs`, every entry made by clicking
    the page; **it runs the office's `StockDocs` and the warehouse page side by side and compares every record** — that is the drift guard;
    14 deliberate breakages each turn it red). `test-mock-server.mjs` is the mock factored out of `test-server-db.mjs`. `scripts/test-data-core.php`
    has 3 new checks for `recent` (run on the server).
  - **Office rule to remember:** a warehouse receipt adds bags; if the office also enters the supplier's purchase with the bags received they are
    counted twice — enter the bill with **Received = 0** (bill only).
  - **Not verified live by a person:** a real receive/dispatch through the Warehouse tile on the live site (no live write was made — it would put
    a document in the real books); the layout on a physical phone. Not built: receiving against a purchase, per-role rules for who may dispatch,
    a session watch in the Warehouse page.
- **Deployed live 2026-09-21** (commits `e6a49ad` idle lock, `038a59c` Warehouse). Order: `deploy-api.sh` (~06:12 local; backup
  `~/backups/api-20260921051241`; anonymous probes all held) → `scripts/test-data-core.php` on the server against the real database
  (45/45 incl. the 3 `recent` checks; copy in `~/tools/`) → server config `idle_ttl_min` set to `0` (backup
  `private/erp-config.php.bak-20260921001519`; verified the config loads: idle 0, absolute 720, enforce true, backend server) →
  `deploy-erp.sh` (full 39-harness gate green; backup `~/backups/erp-deploy-20260921060504`; `_app/index.html` md5 `f36f6f58…`,
  `_app/farooq-co-erp.html` md5 `3f184e63…`, `_app/farooq-erp-data.js` md5 `bf0bf077…`, all identical to the build; `app/index.html`
  identical; no `.uploading` leftovers; ERP `401` gated, homepage `200`) → Hostinger cache cleared for `erp.farooqandcotraders.online`.
  The first `deploy-erp.sh` attempt stopped in its own test gate on a `test-ui-kit` load flake ("a promise never settled" while the
  machine was busy); nothing had been uploaded; that harness passed 3/3 alone and the rerun on a quiet machine passed everything.
  Run it detached (a wrapper script started with `Start-Process`) so the tool's 10-minute timeout cannot kill it mid-upload.
  Rollback: app = copy the three files from that backup into `ERP/_app/`; API = `scripts/deploy-api.sh rollback`; idle limit back =
  `'idle_ttl_min' => 120` in the server config. **Not seen live by a person:** a real receive/dispatch through the Warehouse tile (no live
  write was made on purpose), the signed-in Warehouse screens in a browser (the Chrome extension was not connected), a phone.
- **No idle lock.** Removed the 15-minute screen lock (`31-auth.js`) and the server's idle sign-out (`_session.php`: none unless
  `'idle_ttl_min' => N` with N > 0 is in the server config; the live config was set to `0`). Still asking again: the 12 h session cap
  (`absolute_ttl_min`), an account switched off, or signing out elsewhere — the app shows "Your session has ended" without a reload.
  `test-auth-client.mjs` F1/F1b, `test-gate.mjs` O6/O6b/O6c (the gate test needs PHP — it skips on this machine).

## UI/UX pass — one frame for both apps, a sidebar that reads, a real bell, long lists in pages (2026-09-21)

Request: "act as a UI/UX expert" — the company name written twice, the Warehouse app built differently from the office app, its
menu button in the wrong place, group names blending into the buttons, repeated icons, emojis, the bell answering with a toast, the dark
purple Warehouse stock box, long lists, uneven margins, responsiveness. **No data, table or API change; the only PHP touched is one CSS
string in `api/_gate_login.php` (the sign-in page's logo).** App deploy (`deploy-erp.sh`) + `deploy-api.sh` for that string.

- **The logo is shown WHOLE (revised 2026-09-21).** The first version of this pass cropped `logo.png` to its F-and-wheat monogram (an "emblem":
  `scale(2.15)` inside a round `overflow:hidden` box, `alt=""`) so the company name was not written twice. **The client said it looked zoomed and
  "the full logo isn't visible", so the crop is gone**: every place uses `object-fit:contain`, no transform, `alt="Farooq & Co Traders logo"` —
  module 40 (the base `.mark img` already did this; the `.emblem` class and `brand()` are removed), `app/farooq-co-warehouse-pwa.html` (`.logo`),
  `app/index.html` (`.mark`, `#bar .m`, now 32px), `api/_gate_login.php` (`.mark`; **needs `deploy-api.sh` / a one-file upload**). The name is
  again written beside the logo; that is accepted. `test-shell.mjs` B15/F5 fail if a crop (`scale(2.15)`, `.mark.emblem`) comes back.
- **Sidebar (module `40-nav.js`).** Every one of the 24 screens has its OWN icon (`ERP.Nav.ICONS`; 15 used to share — three wallets, three people,
  three charts, three mills…); new icons are added to the base icon set `P`, which the bridge now exposes (`window.P`). Each group is a caps label +
  hairline + chevron **button** that folds it (remembered per device in `farooqco_nav_closed`; the group holding the open screen cannot be folded
  and a link to a screen in a folded group re-opens it); in the narrow icon rail the headers give way to a divider per group (nothing hidden);
  a group whose links are all hidden for the role is hidden. It wraps `paintNav` (does not replace it), so module 19's per-role hiding still applies.
  The phone tab bar's Sales icon follows (`receipt`).
- **Bell (module `41-notifications.js`).** A popover under the bell (bottom sheet + scrim on a phone) built from the books each time: no saving / no
  stock / low stock / orders waiting / shops owe / we owe / goods lying at mills; each row goes to the screen that fixes it (Inventory opens already
  filtered — `go()` resets `FIL`, so the filter is set after it and `paint()` again). Counts use the same definition as the Inventory badge and the
  dashboard card. The red dot follows what was SEEN (`farooqco_notif_seen`, a signature of the listed items). Replaces the toast; the Warehouse app
  has its own panel with the same look.
- **Warehouse app = the office frame.** Fixed flush rail, one 60px top bar, the page — same tokens, nav item size, group headers, avatar row, icon-rail
  collapse, tab bar on phones. The menu button is at the LEFT of the top bar (as in the office; the old "Hide menu" at the foot of the rail is gone);
  above 1100px it folds to icons (`body.mini`), between 1025 and 1100px it opens the labels (`body.wide`), below that the tab bar takes over. The dark
  purple stock card, product hero and dispatch "maths" panel are light cards now (dark ones were inconsistent with every other card, made the
  bars near-invisible at 0 and vanished in dark mode); the dark "Dispatch stock" button on the product page is a normal button. **The rail no longer
  shows a fixed "Kashif Raza / Inventory Access"** — it shows whoever is signed in (`FcWH.user`), else "Warehouse". Found and fixed on the way:
  the `shop` icon did not exist (shop rows had an empty box), the search box's icon sat on a line of its own (`.field>label` beat `.srch`), the Urdu
  part of a product name was a full-width block at the far side of its cell, dark-mode icon tiles were dark-on-dark, tab bar labels wrapped.
- **Long lists.** ERP (module `42-layout.js`): any list of `[data-row]` items (tables and card grids) over 48 shows the first 48 and a "Show 48 more /
  Show all N" bar; search and filters still work over the WHOLE list (rows past the limit are hidden by class `fc-lim`, never by inline `display`, so
  CSV export — which skips only inline-hidden rows — still exports everything; `beforeprint` expands the list). The dashboard "needing attention"
  table (136 rows), Inventory (408), Customers (409) were the long ones. Lists with their own paging (invoice list, Payments) do not use `data-row`.
  Warehouse: `pageOf`/`moreBar` (40 per page) on the stock list, by-warehouse, history, Find, the Receive picker, the Dispatch shop/product pickers;
  the stock list also gained All / Low stock / No stock chips (the bell's destination).
- **Spacing / responsiveness (module 42).** Buttons-only rows under a page title ("Edit products", "Pricing settings", "Add stock/Transfer/Adjust" were three
  separate right-aligned strips) are folded into the title row; stacked blocks (`.ledger/.card/.banner/.bar`) are 16px apart (they touched, 0–2px, on most
  screens); a labelled field in a filter bar is inline (`Amount from [ ]`); `.sec-t` with buttons wraps (Inventory overflowed a phone); bare tables get a
  scroll wrapper (Landed costs / Expenses overflowed a phone by 120px); the profit table fits; search placeholder no longer cut mid-word; dark-mode
  notices (`.banner.info/warn/err` had fixed dark text colours) are readable.
- **No emoji.** The WhatsApp invoice text and the closing-line option lost their emoji (plain labels: "Invoice:", "Bill Total:", "Paid:"…; a closing line the owner
  already customised is kept as typed); the text-glyph buttons (✕ ✎ ↑ ↓) are SVG icons. Arrows used as prose ("before → after") are typography and stay.
  `test-shell.mjs` E1–E5 fail if an emoji comes back. Also fixed: modules 27/28/29/34 read `window.icon` (does not exist), so their icons were blank.
- **Tests:** `test-shell.mjs` (80 checks: unique icons, groups/fold/remember/active-group rule, the bell — panel not toast, names, filter link, seen-dot, Esc,
  phone sheet, empty state — action row, paging + search over the whole list + print, bare tables, emoji scan, and the Warehouse frame/paging/filter/bell).
  Looked at in real headless Chrome: 1320/1100/1080/820/390px, light + dark, both apps. **Not seen by anyone on the live site or a physical phone.**
- **Deployed live 2026-09-21** (commits `2eee81a`..`685eea1`). `api/_gate_login.php` (sign-in page logo) was uploaded by hand as ONE file — `scp` to
  `_gate_login.php.uploading`, `php -l` on the server, atomic `mv`, then the same anonymous probes as `deploy-api.sh` (401 gate with the emblem CSS, form post 303,
  me/data endpoints 401) — because `scripts/deploy-api.sh` uploads 18 files with 18 back-to-back `scp` logins and the server **reset the connection part-way
  twice (each time rolling itself back correctly), then refused SSH for a few minutes**; a tar-over-one-ssh variant was reset too. So the server throttles rapid
  new SSH logins: pause a few minutes, upload only what changed, and never fire the script in a retry loop. `scripts/deploy-erp.sh` (detached wrapper, full
  40-harness gate green) then uploaded; backup `~/backups/erp-deploy-20260921095236`; `_app/` md5s equal the build (`index.html` `0a9539cc…`, `farooq-co-erp.html`
  `be3306b7…`, `farooq-erp-data.js` `bf0bf077…`), no `.uploading` leftovers; Hostinger cache cleared. Checked in the owner's signed-in Chrome: the live app has
  5 folding groups, 24/24 distinct icons, the emblem, and the bell panel lists real items (136 no stock, 3 shops owe, 3 suppliers owed) with no toast.
  **Practical trap:** several test loops started at once (background loops + monitors) made a 10-minute suite take over an hour — run ONE loop, in the
  foreground in two chunks, or let `deploy-erp.sh` do it. Rollback: app = copy the three files from that backup into `ERP/_app/`, clear cache; sign-in page = the
  previous `_gate_login.php` is in `~/backups/api-20260921094019/api/`.
- **Not done:** the ERP has no "mark all read"/snooze on notifications (derived, not stored); the `.tbl` of Inventory is still a wide table that scrolls
  inside its card; the Documents/Audit lists are capped by their own `slice`, not paged; the base `<title>` still says "Warehouse ERP".

## Receive payment: "Amount Received", and no shop chosen for you (2026-09-21)

Client: "at Receive payment there is *Amount Paid* written, change it to *Amount Received*."
- **The label** is in `PANELS.payment` (`06-wiring.js`). **Module 24's relabeller was rewriting `Amount received` / `Amount Received` back to
  `Amount Paid` on every repaint** (a 2026-09-14 client change), so those two mappings were removed from `LABELS` in `24-client-changes.js`; changing
  the panel alone would not have stuck. "Pay a shop", "Pay supplier" and the invoice/purchase builders still say **Amount Paid** (money going out, or
  the invoice's own paid figure). `test-pay-a-shop.mjs` L1–L3 read the label after the relabeller has run.
- **Edge case fixed in the same pass:** with no shop pre-selected, "Receive payment" and "Pay a shop" silently selected the FIRST shop in the list
  (the banner showed its balance), so a receipt or payout could go to the wrong shop. Same rule as Pay supplier and Change shop: the Shop list now
  starts on **"— Choose a shop —"**, the banner says "Choose the shop to see what it owes", Save refuses ("Choose the shop."), "Choose invoices" says
  "Choose the shop first", and changing the Area keeps an already-chosen shop when it is still in that area (else back to the blank line).
  Opening from a shop's own page/khata still pre-selects that shop. `test-pay-a-shop.mjs` N1–N8 (mutation-checked); U3/U4/S9/S10 and
  `test-statement-of-account.mjs` F3–F7 updated for the extra blank option.

## Where to look for more detail

- **`docs/SERVER_DATA.md` — the current guide to the server-side data system (how it works, what users see, everyday operations, backups, how to change it, known limits). Start here for anything about where the data lives.**
- `docs/MILLING_WORKFLOW.md` — how Milling and Stock at mills work in real life (the story, each form, who does what, decisions on the open questions).
- `docs/OPERATIONS.md` — full access inventory, exact commands used, and the deploy checklist.
- `docs/MYSQL_MIGRATION_PLAN.md` — the IndexedDB → MySQL migration: decisions needed, steps, risks.
- `scripts/deploy-erp.sh` — the recommended ERP deploy flow, runnable directly.
- `.github/workflows/erp-build-test.yml` — CI that build+tests every relevant push.
- `public_html/ERP/README.md` — how the ERP app itself is structured.
- `public_html/ERP/database/SCHEMA.md` — data model.
- `public_html/ERP/docs/FINAL_ERP_REPORT.md` — most recent prior work report.
