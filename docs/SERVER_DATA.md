# Server data — how the ERP keeps its data now (current as of 2026-09-21)

This is the one document to read to understand, operate, or change the way the ERP stores its business data.
Older notes in `CLAUDE.md`, `docs/OPERATIONS.md` and `docs/MYSQL_MIGRATION_PLAN.md` give the history and the
exact commands used; **where they disagree with this file, this file wins.**

## 1. Where the data lives

| | |
|---|---|
| **Business data** (invoices, purchases, payments, returns, stock, shops, products, suppliers, payroll, milling, audit…) | The MySQL/MariaDB database `u943531942_facotraders` on Hostinger (`srv1774.hstgr.io`) — **the only copy that counts.** |
| **Logins** (accounts, sessions, roles) | A different database, `u943531942_erpauth`. Never mixed with business data. |
| **The Warehouse app** (the launcher's *Warehouse* tile: receive, dispatch, stock) | The same database, through the same driver plus module 39 — nothing about stock is kept on the device any more. Section 8. |
| **The app code** | `public_html/ERP/_app/` on the server, served through the login gate (`api/gate.php`). |
| **Per-browser leftovers** | Each browser still has an old local copy (IndexedDB `farooqco_erp_ledger`) frozen at the moment it switched. **It is no longer used** and is not a backup to rely on. A few per-browser values (`sessionUserId`, `lastSaveAt`, `appVersion`, `adoptedFrom`) stay in that browser on purpose. |

**The switch:** `'data_backend' => 'server'` in `/home/u943531942/domains/farooqandcotraders.online/private/erp-config.php`.
Read on every request. `'server'` = data on the database (**current setting**); absent or anything else = each browser keeps its own data
(the old behaviour). Change it only with `scripts/data-backend.sh` (it backs the config up first).

Cutover happened 2026-09-20: the database held the client's 05:03 UTC backup (409 shops, 136 products, 32 suppliers, 2 invoices,
2 payments, 2 purchases, 102 audit rows) and the switch was flipped after a live check. Anything the client's own browser held that was
newer than that backup was **not** carried over (agreed: it would be re-entered).

## 2. How it fits together

```
 browser (each user)                                   Hostinger
 ┌───────────────────────────┐   HTTPS, signed in      ┌──────────────────────────────────────────┐
 │ the ERP screens + services │  (session cookie,       │ api/data/status|version|hydrate|read|     │
 │  02-services … 35-topbar   │   CSRF token on writes) │            commit.php  (thin wrappers)    │
 │            │ FDB.tx / hydrate                        │            │                              │
 │ 01b-server-db.js  (driver) │ ───────────────────────►│ api/_data.php  (the rules, in one place)  │
 │  in-memory copy + revisions│                         │            │  one transaction per save    │
 └───────────────────────────┘                         │ MariaDB: 46 tables (+ data_version)       │
                                                        └──────────────────────────────────────────┘
```

* **Tables.** One per former IndexedDB store (same names, snake_case). Each row = `pk`, `doc` (the app's complete record as JSON —
  authoritative), `rev` (a counter bumped on every write), `row_updated_at`, plus **generated** columns MariaDB derives from `doc`
  (invoice number, customer id, date, status, paisa amounts…). The generated columns are indexed and can never disagree with the record;
  unique numbers (invoice / receipt / purchase / return / job …) are real UNIQUE indexes, and an empty number is NULL, so any number of
  drafts is fine. Keys are exact-match (`utf8mb4_nopad_bin`). No hard foreign keys, on purpose (real data has orphans; a failed import must
  never be the price of a constraint). `data_version` is one row, bumped inside every commit.
* **A save.** The services edit their in-memory copy inside `FDB.tx`; the driver collects the puts/deletes and sends **one** commit:
  `{ops:[{s:store,k:key,d:record|null,r:revisionItWasBasedOn}], reads:[…]}`. The server locks the touched rows in a fixed order, checks every
  revision, and either applies everything (bumping revisions and `data_version`) or **nothing**. Loaded records carry their revision in an
  invisible property (`__r`, non-enumerable — it never reaches JSON, backups or the database).
* **Loading.** One `hydrate.php` download at page load (~1 MB today), served as the stored JSON text spliced in — never decoded and
  re-encoded — so what the browser gets is byte-for-byte what was saved. Before any save that touches numbering, `read.php?stores=sequences`
  re-reads the counters, so two users never take the same number (and the UNIQUE indexes are a second wall).
* **Noticing other people.** Every 15 s (visible tab) the browser reads `version.php`; if it moved, a "Someone else has saved changes — Refresh
  now" bar appears. Saves are still safe without refreshing: the server checks revisions.

## 3. What users will see

| Message | Meaning | What to do |
|---|---|---|
| Bottom bar: *"Someone else has saved changes. Refresh now"* | Another user saved. Your screen is older than the server. | Click **Refresh now** when convenient. |
| Full-screen **"Your last change was NOT saved"** | The save was refused (someone changed the same record first, a document number was taken, the session expired, or the connection dropped). The screen may show the unsaved change, so it is locked. | **Reload.** Check what the server has, then repeat the change. If it was a lost connection, the server may or may not have it — the reload shows the truth. |
| **"Cannot reach the server" / "Cannot load the company data"** at start | Nothing was changed. The app refuses to start rather than fall back to an old local copy. | Check the internet, **Try again**. |
| **"The server database is empty" / "…was not set up from a backup"** | Start-up was stopped so nothing is created by mistake. | Administrator: import the company data (section 5). |
| **"Please sign in again"** | Session ended. | Reload and sign in. |
| Settings → Database status: **"Server database connected"** | Normal. | — |

Rules the design enforces: a stale save is refused whole (never a silent overwrite); a failed save is never hidden or quietly retried
(the services change their in-memory copy *before* the commit, so a retry could duplicate records); the audit log is append-only; "Restore
from backup" is disabled in a server-mode page (it would replace everyone's data).

## 4. Everyday operations

All commands run from the repo root on the owner's machine; the ones that change production were run by the user (`!` prefix) unless they
explicitly told Claude to run them — the permission layer may block them.

| Task | Command |
|---|---|
| See the switch, database counts, API status | `bash scripts/data-backend.sh status` |
| **Emergency: put everyone back on their own browser copy** | `bash scripts/data-backend.sh off` (instant; anything saved on the server since is *not* in those browsers) |
| Turn server mode back on | `bash scripts/data-backend.sh on` (refuses unless the database is initialised) |
| Deploy PHP changes (`public_html/ERP/api/**`) | `bash scripts/deploy-api.sh` (backs up, lints on the server, probes, auto-restores; `rollback` undoes) |
| Deploy app changes | `bash scripts/deploy-erp.sh` (needs a clean git tree; runs every test first; backs up), then clear the Hostinger cache |
| Query the database | the `dbhub-facotraders…` MCP tools, or `ssh` + `php` (the shared host has `exec()` disabled) |
| Password of the business database / where it lives / how to change it | `docs/OPERATIONS.md` → "Business database credentials" |

### Backups — read this, the server is now the only copy
* **From the app:** *Settings → Backup Database* in a server-mode page downloads the **server's** current data in the standard backup format
  (fresh from the server, not from the browser). Do this regularly (weekly at least, and before any risky change). Keep files somewhere safe.
* **On the server, read-only, any time:** copy `scripts/empty-business-db.php` + `public_html/ERP/database/stores.json` to a folder on the server and run
  `php empty-business-db.php --export-only --out-dir=/home/u943531942/backups` — writes a **verified** export (mode 0400) and deletes nothing.
* **Hostinger's own backups** (hPanel → Backups) were never verified from here — check they cover the database.
* **Automatic nightly backup (live since 2026-09-20).** `scripts/backup-business-db.php`, installed at `/home/u943531942/tools/backup-business-db.php`,
  run by a Hostinger cron job (uid `65drF1UNgJ`, `0 21 * * *` = 21:00 server/UTC = **02:00 Pakistan time**). Each run writes
  `/home/u943531942/backups/nightly/business-<date>-<time>-v<counter>-<id>.json` (mode 0400, folder 0700) in the standard backup format.
  It is a **consistent snapshot** (all 46 tables from one instant, even if someone is saving), **verified** by reading it back before it is
  kept, **refuses to back up an empty database** (so a wiped database can never replace real backups), and prunes only after a good run:
  files older than 30 days, never fewer than the newest 7. It logs one line per run to `backups/nightly/backup.log` and appends output to
  `cron.out`. **Check it:** `ssh -p 65002 u943531942@31.97.219.57 'tail -3 ~/backups/nightly/backup.log'` — a `FAILED` line means look at `cron.out`.
  **Turn it off / change it:** delete or recreate the cron job by uid (Hostinger MCP `hosting_*AccountCronJobV1`, or hPanel → Cron Jobs).
  **Restore from one:** `bash scripts/data-backend.sh off`, `php empty-business-db.php --yes-empty-everything` (it writes its own safety export first),
  `php import-backup.php <the backup file>` (dry run, then `--commit`), `bash scripts/data-backend.sh on`. Tested: a run in the exact cron
  environment (`env -i`), record-for-record match against the database (786 records, 0 mismatches), retention rules, and the empty-database refusal.
* **These backups live on the same Hostinger account.** They protect against mistakes, bad saves and a wiped database — **not** against losing
  the account itself. Periodically download one (SFTP/`scp` from `~/backups/nightly/`) or use *Settings → Backup Database* and keep it elsewhere
  (your own drive). An automatic off-site copy needs a destination and credentials you choose — not set up.

### Restoring / re-importing
`scripts/import-backup.php <file>` (dry run by default; `--commit` only after every check passes; refuses a non-empty database; the backup file is
only ever read). To replace the current data: `php empty-business-db.php --yes-empty-everything` first (it writes a verified safety export
before deleting — `--rehearse` proves the delete works and rolls it back), then import. Do this with the switch **off**
(`empty-business-db.php` refuses while it is on) and nobody using the app. Details and the test evidence: `docs/OPERATIONS.md`.

## 5. Changing the system (developers)

* **Adding or changing a store** (a new `STORES` entry in `erp-upgrade/01-db.js`): run `node scripts/gen-mariadb-schema.mjs` (it **fails the build**
  if the app's store list and the schema spec disagree — edit the spec `T` in that script), which rewrites `database/schema-mariadb.sql`,
  `database/stores.json` and `api/_stores.php`. **Apply the new table to the live database and run `deploy-api.sh` BEFORE deploying the app** —
  otherwise the first save to that store is rejected as "unknown store" and the user sees "NOT saved". (IndexedDB `DB_VER` is irrelevant in
  server mode.) New *fields* on existing records need nothing: `doc` stores whatever the app writes; add a generated column only if you
  need to query/sort/unique-index it.
* **Never put per-browser state in a shared record.** Anything that is "this browser's" (who is signed in here, a UI preference) must not
  go through `FDB.tx` to a shared store; if it already does, add its key to `PER_BROWSER_META` in `01b-server-db.js`.
* **Things the app re-saves on its own** (`ERP.persistMasterAndLegacy`, after start-up and repaints): the driver never sends a record identical
  to what the server holds (compared by content, ignoring key order and the recomputed roll-ups `DERIVED`: shop `bal`/`tot`, supplier
  `due`/`paid`), and saves the original screens' scratch lists (`legacy`, `documents`) last-writer-wins. If you add another recalculated field
  that is saved inside a shared record, add it to `DERIVED`, or every page load will bump the shared counter and clash between users.
  Tests G1–G5 in `test-server-db.mjs` guard this.
* **Tests.** Browser side: `erp-upgrade/test-server-db.mjs` (74 checks — the real app on a mock of the API: boot safety, a full business day whose
  books equal browser mode's, two users colliding, failed saves, backups; mutation-tested 11 ways). Server side: `scripts/test-data-core.php`
  (42 checks against the **real database** with throwaway `zz_dc_*` keys; upload `api/_data.php`, `api/_stores.php` and the script to a
  temp folder on the server, run over SSH, delete it; includes a genuine two-process race, driven by `scripts/race-data-core.sh`; mutation-tested).
  The importer and the empty tool were tested on the real server too (dry runs, hostile inputs, corruption caught). No PHP is installed on
  the owner's machine, so PHP is only tested on the server (and by CI's `test-gate.mjs`, which covers the auth PHP).
* **Where the rules live:** `api/_data.php` (server) and the header comment of `erp-upgrade/01b-server-db.js` (browser; rules 1–8 — read them before
  changing anything).

## 6. Known limits and what is not done

* **Roles are still enforced only inside the app** on the server-data path. The server enforces: signed in, CSRF, audit log append-only, revisions.
  Per-store role rules on writes are a follow-up once real write patterns are seen.
* **A refused save loses the form being typed** (only when two people change the same record within seconds).
* **Other users' work appears after a refresh** (15 s poll + bar), not live.
* **Needs internet.** No offline entry, by decision.
* **Whole-data download on every page load** (~1 MB now). Fine for years at this volume; revisit (delta loads) if it grows ~50×.
* **The `legacy` scratch lists** (activity feed, log, devices, WhatsApp, old sequence counters) are last-writer-wins: a person's recent
  activity-feed entries can be replaced by another's. They are display state, not accounts.
* **Everything is on the database** — the ERP (every screen's business data goes through `FDB` → the API) **and, since 2026-09-21, the
  Warehouse app** (section 8). What stays in a browser, by design: the per-browser values listed in section 1, a few UI keys (sidebar
  width, sign-in ticket, "this device runs on the server"), and the frozen old local copies. The Warehouse page has no session watch.
* **Backups are automatic and on-account only** (section 4): no off-site copy is made for you.
* **Not verified live yet:** a real invoice/receipt/purchase entered by a person through the server path, and two people using it at once
  on the real site. The save mechanism itself was exercised live (create → update → delete of a throwaway record, counters read).
* Auth limits from the login-gate work (account-lockout denial of service, etc.) are unchanged — see `CLAUDE.md`.

## 7. Record of what was built and verified (2026-09-20)

Schema (46 tables, generated, verified against real MariaDB incl. awkward values); credentials wiring; importer (dry-run default, per-record and
13-total verification, mutation-tested); data API (`_data.php` + 5 endpoints) deployed with anonymous-access probes; browser driver (module 1b);
switch, empty and import tools; cutover with live verification. Full suite: 0 failures across all harnesses on a quiet machine (isolated
failures seen earlier were load flakes, confirmed by re-running alone). Two real multi-user problems were found by the new tests and fixed
before any user hit them (the app's routine full re-save and stored roll-ups; see section 5). Commits: `c438d70`, `b6e2f94`, `221e053`,
`1d50f68`, `8dedac7`, `2f01a49`.

## 8. The Warehouse app is on the database too (2026-09-21)

**What it was.** The launcher's *Warehouse* tile kept its own stock map in the browser (`localStorage` key `farooqco_erp_v1`). The office app
rebuilt that record from its own tables, so a bag "received" or "dispatched" in the warehouse app never reached the real stock. Its "works
without internet, uploads by itself" text was also untrue: the upload queue lived in memory only, so an entry made without signal was lost.

**What it is now** (switch = `server`). The Warehouse page reads the company database and saves to it through **the same driver** the office
uses (`01b-server-db.js`: atomic, revision-checked commits, append-only audit log), plus one small module of its own,
`erp-upgrade/39-warehouse-server.js`. `build.py` puts modules 1, 1b and 39 in front of the page's own script; the page then asks the
server which backend to use (`FcWH.start()`), exactly as the office app does. With the switch **off** (or no server API) the page behaves as it
always did — the rollback is the same one line.

* **What it downloads.** Not the whole business: `products, warehouses, regions, customers, suppliers, inventory, business, sequences` in one
  `read.php` call and the newest 40 stock movements in another (`read.php?stores=stockMovements&recent=40` — new optional parameter, 1–1000,
  newest first). About 340 KB today before compression (the server compresses it) — against ~1 MB for the office app. It refreshes itself when somebody else saves (version poll, silently, never while the person is typing
  or saving); on the entry screens it waits until they leave.
* **What an entry becomes** — the same records the office screens make (`ERP.StockDocs.save`, `07-transactions.js`); `test-warehouse-server.mjs`
  runs both and compares every row, so they cannot drift apart unnoticed:
  * *Receive stock* → a **RECEIVE** stock document `RCV-YYYY-nnnnnn`: its line, one `ADJUSTMENT_IN` movement, the stock row, an audit row
    ("Stock received posted", with the signed-in person and `source: Warehouse app`). **It adds bags only** — the supplier's bill is money and is
    entered in the office.
  * *Dispatch stock* → a **DISPATCH** stock document `DSP-YYYY-nnnnnn` naming the shop (the shop is required, as in the office). New step
    **"Is this load for an invoice?"**: pick the shop's invoice if it was already made — its bags were taken out of stock when it was made, so
    the dispatch is only *linked* (no second deduction; the invoice gets its dispatch number, `CONFIRMED → DISPATCHED`). With "No invoice yet"
    the dispatch takes the bags out itself and refuses more than the shelf holds (unless the owner switched on *allow negative stock*).
* **Made safe the same way as the office.** The stock rows and the number counters are re-read from the server at the start of *every* save
  (`FDB.server.hot`), so the "only N bags available" check is against the truth and two people cannot take the same number or sell the same
  last bag; if a race is still lost inside the commit, the whole save is refused and the same blocking "NOT saved — Reload" notice appears.
  A business refusal (not enough bags, no shop) is shown on the page and is *not* a broken save. Tapping Save twice makes one document.
* **No offline entry** (decision, same as the office): with no signal nothing is "saved for later" — the page says so and sends nothing; it
  never falls back to the old browser copy (a device that has run on the server remembers that: `farooqco_backend`).
* **Small fixes made on the way:** shop names / warehouse names / product names typed by staff are HTML-escaped before they are drawn; a
  movement of a product that was later switched off no longer breaks the history list; a shop without a region no longer crashes the
  dispatch screen; the shop list (409 buttons) now has a search box and shows the first 40; "Movements today" counts today's; the launcher's
  "works without internet" wording is corrected.

**Decisions taken (recommended answers — change them only with the owner's word):**

| Question | Chosen | Why |
|---|---|---|
| Second API for the warehouse? | No — same driver, same commit rules | One set of rules to trust; the driver is already tested for races. |
| Receive = a purchase? | No — a `RECEIVE` stock document, bags only | The warehouse person has no prices; a purchase needs a bill, a price and a payable. |
| Offline entry? | No | A dispatch made offline could not be checked against the shelf; the old queue was never real. |
| Dispatch double-deduction? | Offer the shop's invoice; if linked, do not deduct again | The office's own rule; otherwise a sale would take the same bags out twice. |
| Staff identity on entries | The signed-in account's display name | Audit rows say who, not "Owner". |

**Office-side rule to remember (double counting):** a warehouse *receipt* adds bags. If the office then also enters the supplier's purchase
with the bags received, they are counted twice. Enter the bill with **Received = 0** (bill only) — or leave the warehouse receipt out and let
the purchase add the stock. The reverse is the invoice case above, which the dispatch step already guards.

**Not done / follow-ups:** the warehouse cannot receive *against a purchase* (`Purchases.receiveMore`) — that would remove the double-counting
caution; one product per entry (as before); no per-role rule for who may dispatch (roles are enforced only in the office app — section 6);
the warehouse page has no session watch (a session that ends mid-use shows "sign in again" at the next save); the history list is the last 40
movements.

## 9. Signing in: no idle lock (2026-09-21)

At the owner's request nobody is asked for the password again just because they stopped working. Removed: the 15-minute screen lock in
`31-auth.js` and the server's 2-hour idle sign-out (`_session.php`: no idle timeout unless `'idle_ttl_min' => N` (N > 0) is set in the
server config; the live config was set to `0`). What still asks again: the session's **12-hour cap** (`absolute_ttl_min`), an owner
switching the account off, or signing out on another device — the app then shows "Your session has ended. Sign in again" without a reload.
To bring an idle limit back: set `'idle_ttl_min' => 120` (minutes) in `private/erp-config.php` — no redeploy needed.
