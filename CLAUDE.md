# Farooq & Co Traders — Project Reference

This file is auto-loaded by Claude Code whenever a session starts in this directory. Read it
before doing anything else. Details behind each section live in `docs/OPERATIONS.md`.

## What this project is

Two live sites on one Hostinger hosting account, owned by the user (theumairzero7@gmail.com,
GitHub: talhaazhar-ta):

- **`farooqandcotraders.online`** — public homepage (`public_html/index.html`).
- **`erp.farooqandcotraders.online`** — a subdomain pointing at `public_html/ERP`, serving a
  **client-side-only ERP app**. No server backend. All business data (invoices, customers,
  inventory, ledgers) lives in each browser's own IndexedDB (`farooqco_erp_ledger`). The static
  HTML/JS files here are the *application code*, not the data. **As of 2026-09-15 a real MySQL
  database has been provisioned for this project (see "MySQL database" below) but nothing in the
  app currently reads or writes it — its intended role isn't defined yet.**

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
  runtime (there's already `farooq-erp-data.js`, required alongside `farooq-co-erp.html`), it
  must exist at `ERP/` root, not just under `app/`.**
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
purpose: **this will later replace the client-side IndexedDB storage** the ERP currently uses —
i.e. a move from "each browser is the only copy of the data" to a real shared server database.
**This has not happened yet.** No migration plan, schema mapping, or sync/API layer exists yet,
and the ERP app currently still reads/writes only IndexedDB. Treat this as a confirmed future
direction, not a green light to start wiring the app to MySQL without a plan.

| | |
|---|---|
| Database / user | `u943531942_facotraders` (same name for both) |
| Host | `srv1774.hstgr.io` : `3306` (also reachable at `82.197.82.127`) |
| Permissions | Full: Select/Insert/Update/Delete/Create/Alter/Drop/Index/Create+Alter routine/Create+Show view/Trigger/Event/Lock tables/Execute/References/Create temporary tables |
| Remote access whitelist | `203.215.169.140` (this machine's outbound IP) and `%` (anywhere) — set up in hPanel → Databases → Remote MySQL before this session |
| Access from Claude Code | MCP server `dbhub-facotraders-theumairzero7@gmail.com` in the **global** `~/.claude.json` (`@bytebase/dbhub`). **Not in this git repo** — machine-level config, DSN has the password in plaintext, must never be copied into anything committed here. **Confirmed loaded and working after a session restart** (2026-09-15): tools `mcp__dbhub-facotraders-theumairzero7_gmail_com__execute_sql` and `..._search_objects` are callable. |
| Tested | Twice: once via a raw `mysql2` script before the restart, once via the actual MCP `execute_sql` tool after the restart. Both did a full `CREATE TABLE → INSERT → SELECT → UPDATE → DELETE → DROP TABLE` round trip successfully, then cleaned up. Server: MariaDB 11.8.9. Currently **0 tables** — still empty. |

**Full migration plan, decisions needed, and step-by-step approach**: see
`docs/MYSQL_MIGRATION_PLAN.md`. Status: **not started, documentation only** — the user has said
this is for later. Don't start implementing any part of it (schema, API layer, data-access
refactor) without picking this back up deliberately and confirming the open decisions in that
doc first.

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
   reconstruct each time, never commit; the 30 numbered module `.js` files at `erp-upgrade/`
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
cp [0-9]*.js mod/                                    # 00a-preboot.js .. 28-areawise.js
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
5. Uploads the freshly built `index.html`, `farooq-co-erp.html` and `farooq-erp-data.js` to the
   **ERP document root** (`public_html/ERP/`, what the site actually serves — see the correction
   under "These are NOT two separate filesystems" above), then uploads the same build to the
   legacy `app/` folder too, for parity only.
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

**General rules, either site:**
- Never edit live files directly over SSH/FTP as the primary way of making a change — edit
  locally, build/test, commit, push, *then* deploy. The server copy is a deploy target, not a
  workspace.
- Never deploy schema/logic changes that break compatibility with existing browsers' IndexedDB
  records without going through the app's own migration path (`01-db.js`, `20-integrity.js`) —
  there is no server data to "just fix," each user's browser is the only copy of their data.
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
5. Roles are advisory only (hidden actions, not server-enforced) — there is no server.
6. SMS/WhatsApp are configured but not connected to a provider.
7. Client message (2026-09-16, `clientNewReq/clientMesseges.txt`): "Add amount paid here" —
   Amount Paid already appears on the invoice screen and both payment panels (from an earlier
   client change round, `24-client-changes.js`), so this must mean somewhere it's currently
   missing, but the message doesn't say where and no screenshot was attached this time. Waiting
   on the user to check with the client before building anything.
8. Client message (2026-09-16, same file): "Payroll = Employee salary management system" — a new
   feature area with no real requirements yet (no fields, no salary structure, no screenshot).
   Not started — waiting on the client for scope before touching this.

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

## Where to look for more detail

- `docs/OPERATIONS.md` — full access inventory, exact commands used, and the deploy checklist.
- `docs/MYSQL_MIGRATION_PLAN.md` — the IndexedDB → MySQL migration: decisions needed, steps, risks.
- `scripts/deploy-erp.sh` — the recommended ERP deploy flow, runnable directly.
- `.github/workflows/erp-build-test.yml` — CI that build+tests every relevant push.
- `public_html/ERP/README.md` — how the ERP app itself is structured.
- `public_html/ERP/database/SCHEMA.md` — data model.
- `public_html/ERP/docs/FINAL_ERP_REPORT.md` — most recent prior work report.
