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
7. ~~Client message (2026-09-16): "Add amount paid here"~~ — **Resolved 2026-09-16.** The client
   clarified: shops could receive money but never be *paid* money directly (only via the Customer
   Return flow). Implemented as "Pay a shop" — see "Pay a shop / Payroll (2026-09-16)" below.
8. ~~Client message (2026-09-16): "Payroll = Employee salary management system"~~ — **Resolved
   2026-09-16** as a deliberately minimal MVP (no real requirements were ever given). See below.

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

Covered by `test-payroll.mjs` (48 checks, including a full restart/persistence check).

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
  as the same category of limit as `22-users.js`'s own PIN comment) and a 15-minute idle lock
  (re-verifies against the server if online, or a cached PBKDF2 password verifier if offline).
- **Phase 3 (not done, deliberately)**: moving the app files behind `index.php`/`erp.php` so
  sign-in becomes mandatory. Not attempted this session — flipping that gate risks locking the
  client out of live billing software if anything is wrong, and needs Phase 2 to run clean for a
  few days first, then a deliberate go-ahead.

**Credentials**: the DB password for `u943531942_erpauth` and the ticket-signing secret are
generated fresh (never extracted from the existing `dbhub` MCP credential) and live only in
`private/erp-config.php` on the server and locally, gitignored — `private/erp-config.sample.php`
is the committed template. The bootstrapped OWNER account (`username: owner`) has
`must_change_password` set — the client should change it and this is a real gap: **no UI for
changing a password was built yet**, only the `api/auth/change-password.php` endpoint and
`ERP.Auth.changePassword()` exist. Adding that screen is unstarted follow-up work.

**Verified this session**: full existing test suite (24 harnesses, 1,196 checks) unaffected;
new `test-auth-client.mjs` (25 checks) covers observe-mode fallback, login/logout, fail-closed
permissions, a valid vs. an expired offline ticket, and both idle-lock unlock paths — all via a
mocked `fetch`, never depending on the live server. All 8 PHP files linted against the live
server's actual PHP 8.3 binary before upload. Live smoke test via a real browser: public data
now `403`, `_bootstrap.php`/`_session.php` return `403` on direct request, a full login round
trip as the bootstrapped OWNER worked end-to-end and correctly rebound `ERP.Session`/`CURRENT_USER`,
and a real bug found in that same smoke test (the "Company sign-in" link didn't disappear once
signed in) was fixed and redeployed before this was called done.

**Open decisions from this rollout — both confirmed by the user, 2026-09-16, no change needed**:
`LANDED_COST_MANAGE`/`LANDED_COST_VIEW`/`EXPENSE_MANAGE` stay OWNER-only in
`auth_role_permissions`, matching today's client-side behavior exactly. Phase 3 (mandatory
sign-in) stays deferred — Phase 2 should run clean for a few days first before it's revisited.

**Password-change screen added (2026-09-16, same day as Phase 2)**: the gap flagged right after
Phase 2 shipped — a `must_change_password` flag existed with no UI to act on it — is closed.
`31-auth.js` now shows a mandatory, non-dismissable "Change your password" overlay right after
signing in when the server says the account must change it (set on every bootstrapped/owner-reset
account), and a voluntary "Change password" link next to the account chip otherwise (replacing
"Company sign-in" once actually signed in). Changing the password also clears the cached offline
PBKDF2 verifier, since it was derived from the old password. Covered by 10 new checks in
`test-auth-client.mjs` (35 total in that file now).

**A pre-existing flake found and diagnosed, not caused by this work**: while stress-testing (running
the full suite repeatedly to rule out flakiness from the new module), `test-users.mjs`'s U23 check
("an account with a PIN asks for it") intermittently fails — roughly 1 run in 3-4 when the same
file is run many times back to back. Confirmed by rebuilding **without** `31-auth.js` in the bundle
and reproducing the identical failure at a similar rate: this is a pre-existing timing race in
`test-users.mjs` itself (a `Session.signIn()` promise from an earlier step occasionally resolves
late and its `closeSignin()` callback wipes the `#fcSignin` dialog's freshly-rendered PIN input out
from under the next step), not something this session's changes introduced. It has not been seen
to fail when each test file is run once, standalone, the way CI actually runs them — flagged here
rather than fixed, since it's an existing file outside this session's scope and deserves its own
look rather than a rushed change to a working, well-established test.

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

Covered by `test-milling.mjs` (73 checks: validation, the full posting cycle, stock movements, the
ledger patch including a `FEE_ONLY` job and a cancellation, the moving-average-cost regression, the
printable document, and a full DOM-driven entry-screen walkthrough including the "mill goes inactive
mid-draft stays selectable" edge case). Full existing suite (25 other harnesses) reruns clean.

## Where to look for more detail

- `docs/OPERATIONS.md` — full access inventory, exact commands used, and the deploy checklist.
- `docs/MYSQL_MIGRATION_PLAN.md` — the IndexedDB → MySQL migration: decisions needed, steps, risks.
- `scripts/deploy-erp.sh` — the recommended ERP deploy flow, runnable directly.
- `.github/workflows/erp-build-test.yml` — CI that build+tests every relevant push.
- `public_html/ERP/README.md` — how the ERP app itself is structured.
- `public_html/ERP/database/SCHEMA.md` — data model.
- `public_html/ERP/docs/FINAL_ERP_REPORT.md` — most recent prior work report.
