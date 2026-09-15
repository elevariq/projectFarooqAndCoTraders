# Farooq & Co Traders — Project Reference

This file is auto-loaded by Claude Code whenever a session starts in this directory. Read it
before doing anything else. Details behind each section live in `docs/OPERATIONS.md`.

## What this project is

Two live sites on one Hostinger hosting account, owned by the user (theumairzero7@gmail.com,
GitHub: talhaazhar-ta):

- **`farooqandcotraders.online`** — public homepage (`public_html/index.html`).
- **`erp.farooqandcotraders.online`** — a subdomain pointing at `public_html/ERP`, serving a
  **client-side-only ERP app**. No server backend, no server database. All business data
  (invoices, customers, inventory, ledgers) lives in each browser's own IndexedDB
  (`farooqco_erp_ledger`). The static HTML/JS files here are the *application code*, not the data.

Read `public_html/ERP/README.md` and `public_html/ERP/database/SCHEMA.md` for how the ERP itself
is built — 25+ upgrade modules injected into one original HTML file, documented per-module in that
README.

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

No changes have been made to the live site — this was all local tooling/documentation work. Live,
local, and GitHub match as of the initial snapshot commit; GitHub additionally has the two fix
commits above (`main` branch, pushed).

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

## Workflow for future changes (plan)

1. **Before touching anything live**: `git pull` locally to make sure the local copy matches
   GitHub; if there's any doubt it matches production, re-pull from the server first
   (`scp -P 65002 -r u943531942@31.97.219.57:.../public_html .`) and diff before editing.
2. **Make changes locally**, not directly on the server:
   - ERP logic changes → edit the relevant module under `public_html/ERP/erp-upgrade/` (the
     tracked root-level `.js` files, not a `mod/` copy).
   - Reconstruct the build staging area (above) if you haven't already this session, then rebuild
     (`python3 build.py`) and run the test harnesses.
   - Only commit rebuilt output (`app/farooq-co-erp.html`, `app/index.html`) alongside the source
     module changes that produced it — never hand-edit the built HTML files directly.
3. **Commit locally with a meaningful message** describing the *why*, not just the *what* (e.g.
   "Fix landed-cost rounding on partial receipts" not "update file"). Small, scoped commits over
   one giant one.
4. **Push to GitHub** (`git push`) so the private repo stays the source of truth.
5. **Deploy to live** only after the above, and only the specific changed files — back up the
   live version of anything you're about to overwrite first (e.g. `scp` it down to a `backups/`
   folder, or copy it to a `.bak` alongside it on the server via SSH) so a bad deploy is instantly
   reversible.
6. **Never deploy schema/logic changes that break compatibility** with existing browsers'
   IndexedDB records without going through the app's own migration path (`01-db.js`,
   `20-integrity.js`) — there is no server data to "just fix," each user's browser is the only
   copy of their data.
7. Confirm with the user before anything hard-to-reverse: overwriting live files, changing DNS,
   deleting anything, or any action outside `farooqandcotraders.online`/`erp.farooqandcotraders.online`.

## Open items (from the ERP's own README, still unresolved)

1. Opening balances — legacy Total Sales/Collection/Balance are reference-only; carrying them in
   as real opening balances needs a cutover date from the user.
2. 68 route-corridor shops marked `region_assumed` need a definite region.
3. Five blank catalogue rows (101, 103, 108, 111, 132), 11 zero-value products, 2 duplicate-name
   groups — flagged, waiting on user decision.
4. Suppliers 204/494/575/614 — account type to confirm; 575 is currently switched off.
5. Roles are advisory only (hidden actions, not server-enforced) — there is no server.
6. SMS/WhatsApp are configured but not connected to a provider.

(The build-pipeline question from earlier sessions is resolved — see "How to build the ERP
locally" above — and isn't a decision the user needs to make.)

## Where to look for more detail

- `docs/OPERATIONS.md` — full access inventory, exact commands used, and the deploy checklist.
- `public_html/ERP/README.md` — how the ERP app itself is structured.
- `public_html/ERP/database/SCHEMA.md` — data model.
- `public_html/ERP/docs/FINAL_ERP_REPORT.md` — most recent prior work report.
