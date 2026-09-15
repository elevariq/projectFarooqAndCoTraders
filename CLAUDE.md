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
5. Discovered the `erp-upgrade/build.py` rebuild pipeline is **currently incomplete on the live
   server**: it expects an `erp-upgrade/mod/` folder and an unbuilt original `farooq-co-erp.html`
   inside `erp-upgrade/`, neither of which exist in what's deployed — only the already-built
   `app/*.html` and the 25 loose module `.js` files are there. **Do not assume `python3 build.py`
   works out of the box** — check/reconstruct this before relying on it. See "Open items" below.

No changes have been made to the live site. Live, local, and GitHub are all in sync as of the
initial commit.

## Workflow for future changes (plan)

1. **Before touching anything live**: `git pull` locally to make sure the local copy matches
   GitHub; if there's any doubt it matches production, re-pull from the server first
   (`scp -P 65002 -r u943531942@31.97.219.57:.../public_html .`) and diff before editing.
2. **Make changes locally**, not directly on the server:
   - ERP logic changes → edit the relevant module under `public_html/ERP/erp-upgrade/`.
   - Fix the build pipeline gap (above) if not already fixed, then rebuild
     (`python3 build.py`) and run the test harnesses (`node test-erp.mjs` and the other
     `test-*.mjs` files — need `npm install jsdom fake-indexeddb` once).
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
7. **New**: the `erp-upgrade/build.py` pipeline gap described above.

## Where to look for more detail

- `docs/OPERATIONS.md` — full access inventory, exact commands used, and the deploy checklist.
- `public_html/ERP/README.md` — how the ERP app itself is structured.
- `public_html/ERP/database/SCHEMA.md` — data model.
- `public_html/ERP/docs/FINAL_ERP_REPORT.md` — most recent prior work report.
