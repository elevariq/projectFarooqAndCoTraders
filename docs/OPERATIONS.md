# Operations Log & Access Reference

Detailed companion to the root `CLAUDE.md`. This is the "how" — exact commands, exact findings —
so a future session can verify anything here still holds rather than trust it blindly.

## Account / access inventory

| What | Detail | Notes |
|---|---|---|
| Hostinger account | order id `1009002313`, hosting username `u943531942` | Hosts ~20 domains total; **only `farooqandcotraders.online` is in scope** for this project |
| SSH | `ssh -p 65002 u943531942@31.97.219.57` | Key-based auth already set up, no password prompt |
| SCP (file transfer) | `scp -P 65002 -r u943531942@31.97.219.57:<remote path> <local path>` | Used for the initial pull; prefer this over FTP |
| FTP | host `ftp://31.97.219.57`, port 21, two accounts: `u943531942.farooqandcotraders.online` and `u943531942.erp.farooqandcotraders.online`, both rooted at `/home/u943531942/domains/farooqandcotraders.online` | Credentials live in the Hostinger panel; not duplicated here. Not used yet — SSH/SCP covers the same ground and is already authenticated |
| Hostinger MCP tools | `mcp__hostinger-hosting__*`, `mcp__hostinger-domains__*`, `mcp__hostinger-dns__*`, `mcp__hostinger-vps__*`, etc. | Confirmed working: `hosting_listWebsitesV1`, `domains_getDomainListV1` |
| GitHub | CLI `gh` authenticated as `talhaazhar-ta`, scopes `gist, read:org, repo, workflow` | Repo: https://github.com/talhaazhar-ta/projectFarooqAndCoTraders (private) |
| Live document roots | `farooqandcotraders.online` → `/home/u943531942/domains/farooqandcotraders.online/public_html`; `erp.farooqandcotraders.online` → same account, `public_html/ERP` (a `vhost_type: subdomain`, not a separate site) | Confirmed via `hosting_listWebsitesV1` |

## What was verified, and how (2026-09-15)

1. SSH reachability without a password:
   ```
   ssh -p 65002 -o BatchMode=yes -o ConnectTimeout=8 u943531942@31.97.219.57 'echo SSH_OK && whoami && pwd && ls -la'
   ```
   Succeeded — key auth already trusted, home dir `/home/u943531942`.

2. Hostinger API sees both sites:
   ```
   hosting_listWebsitesV1(domain="farooqandcotraders.online")
   ```
   Returned two entries: the addon domain itself (`root_directory: .../public_html`) and
   `erp.farooqandcotraders.online` as a `subdomain` vhost rooted at `.../public_html/ERP`.

3. Full domain list (`domains_getDomainListV1`) confirmed the account holds ~20 domains beyond
   this project — used to set the "scope strictly to this domain" rule in `CLAUDE.md`.

4. Directory listing of both document roots via SSH `ls -la` — recorded in this session's
   transcript; structure matches what's now in `public_html/` locally (see tree below).

## How the local + GitHub copies were made

```bash
# from D:\projectFarooqAndCoTraders
scp -P 65002 -r -o BatchMode=yes \
  u943531942@31.97.219.57:/home/u943531942/domains/farooqandcotraders.online/public_html \
  ./public_html

# secret scan before committing anything
grep -rlIE "(api[_-]?key|secret|password|token|BEGIN (RSA|OPENSSH) PRIVATE KEY)" \
  --include="*.js" --include="*.json" --include="*.md" --include="*.sql" --include="*.prisma" \
  public_html
# -> 3 hits, all just UI field names ("password" login field, SMS "provider token" settings) —
#    confirmed with a stricter regex for actual embedded key/token values: no matches.

git init -b main
git add -A
git commit -m "Initial import: live snapshot of farooqandcotraders.online + ERP subdomain"
gh repo create projectFarooqAndCoTraders --private --source=. --remote=origin --push
```

Result: private repo at `https://github.com/talhaazhar-ta/projectFarooqAndCoTraders`, `main`
branch, one commit, 88 files, matches the live server exactly as of 2026-09-15.

**Note on repo contents**: because this is a full mirror, it includes real business data —
`public_html/ERP/data-exports/*.csv` (customers, products, suppliers, regions, warehouses) and
`public_html/ERP/database/fresh-install-backup.json`. This is why the repo must stay **private**.
If it's ever made public or shared, strip or `.gitignore` those paths first.

## The build pipeline — investigated and fixed (2026-09-15)

Initial read of `erp-upgrade/build.py` looked like it was missing inputs: it reads modules from
`erp-upgrade/mod/<name>.js` (`MODDIR = BUILD / "mod"`) and a pre-upgrade original from
`erp-upgrade/farooq-co-erp.html`, and neither existed after the initial `scp` pull — only the
30 module `.js` files loose at `erp-upgrade/` root and the already-built `app/*.html`.

**That's intentional**, not a bug: `erp-upgrade/.gitignore` explicitly ignores `mod/`, `dist/`,
and the exact input files (`farooq-co-erp.html`, `index.html`, `farooq-co-warehouse-pwa.html`,
`farooq-and-co-homepage.html`, `farooq-erp-data.js`). The design is: the 30 numbered module files
at `erp-upgrade/` root are the real tracked source; `mod/` and the input files are a local,
disposable staging area you reconstruct before building, never commit. Nobody had exercised this
step yet on this machine, which is why it looked broken.

**Reconstructing it** (see `CLAUDE.md` → "How to build the ERP locally" for the exact commands):
copy the 30 module files into a new `mod/` folder, copy `app/farooq-co-erp.html`, `app/index.html`,
`app/farooq-co-warehouse-pwa.html`, `app/farooq-and-co-homepage.html`, and `app/farooq-erp-data.js`
into `erp-upgrade/` as the build inputs, then run `python3 build.py`. Feeding it the *already-built*
`farooq-co-erp.html` as the "original" is correct: `inject()` strips any previous upgrade payload
(matched by an HTML comment marker) before adding a fresh one, specifically so the build is
repeatable from the current state rather than needing a pristine pre-upgrade file to be kept
around.

**Pitfall hit and worth recording**: don't use `git mv` to populate `mod/`. It force-tracks the
destination into git even though `.gitignore` covers it (gitignore only stops *new* files from
being added, not an explicit rename of an already-tracked file) — this briefly moved all 30
module files out of their tracked root location into the ignored `mod/` path, which would have
untracked them. Fixed by moving them back with `git mv` and populating `mod/` with a plain `cp`
instead, which git correctly ignores.

**Three real bugs found and fixed once the build actually ran** (commit `c0de02e`):

1. `build.py`'s final `print()` used a Unicode arrow (`→`) that raises `UnicodeEncodeError` on
   Windows' default `cp1252` console encoding. The build itself had already finished successfully
   (`dist/` was written) — the crash only hid the success message. Replaced `→` with `->`.
2. `test-docx.mjs` wrote its output to a hardcoded `/home/claude/build/test-invoice.docx`, a path
   from whatever environment this was last built in, which doesn't exist elsewhere. Now writes to
   `dist/test-invoice.docx`.
3. `test-khata.mjs` wrote its generated sample to `sample-customer-statement.docx` — the exact
   name of a **tracked** fixture file in the same folder — so every test run silently overwrote it
   with a byte-identical-size but different-content file (DOCX embeds a timestamp), leaving a
   spurious binary diff in `git status` after every test run. Now writes to
   `dist/sample-customer-statement.docx`.

**Verification**: full clean rebuild (`rm -rf dist && python3 build.py`) plus all 20 `test-*.mjs`
harnesses run in sequence: **1,049 checks total, 0 failures**, and `git status` is clean
afterward (no more incidental file changes from running tests). `test-pwa.mjs` prints
diagnostic-only output with no pass/fail counter by design (it boots the ERP and the warehouse PWA
in two separate JSDOM windows that don't share `localStorage`, so "PWA product catalogue: 0
shops: 0" is expected there, not a regression — don't mistake it for a failure).

No live-server files were touched for any of this — it's entirely local build tooling. The live
`app/*.html` already reflects a correct build; this fix is about being able to produce the *next*
one.

## Commit message conventions for this repo

- Describe *why*, not just *what* — the file diff already shows what changed.
- One logical change per commit where practical (a module fix, a report addition, a schema
  change) rather than bundling unrelated changes.
- Reference which ERP module(s) were touched by number/name (e.g. `17-profit.js`) since the
  README indexes them that way — makes it easy to cross-reference against `README.md`'s module
  table later.
- Never commit credentials, `.env` files, or anything from outside
  `farooqandcotraders.online`'s own `public_html`.

## Deploy checklist (superseded by `scripts/deploy-erp.sh` — see below)

Manual version, for reference or for the homepage (which the script doesn't cover):

1. `git status` clean, changes committed and pushed to GitHub first.
2. Back up whatever you're about to overwrite on the server, e.g.:
   ```
   ssh -p 65002 u943531942@31.97.219.57 \
     'cp /home/u943531942/domains/farooqandcotraders.online/public_html/ERP/app/index.html \
         /home/u943531942/domains/farooqandcotraders.online/public_html/ERP/app/index.html.bak-$(date +%Y%m%d%H%M%S)'
   ```
3. `scp` up only the specific rebuilt/changed files — not a blind full-folder overwrite.
4. Clear the Hostinger cache (`hosting_clearWebsiteCacheV1`, domain = the one you changed) — both
   sites sit behind Hostinger's CDN, see "Architecture, confirmed" below. Skipping this step is
   the most likely reason a deploy would appear not to have worked.
5. Spot-check the live URL after deploy (`curl -I https://...`).
6. Tell the user what was deployed and confirm before deploying anything that touches how
   existing users' browser data is read (schema/migration changes).

## Architecture, confirmed on the server (2026-09-15)

Verified directly over SSH and via Hostinger's DNS/subdomain APIs — not assumed:

```
ssh ... 'ls -la /home/u943531942/domains/'
```
shows exactly **one** `farooqandcotraders.online` directory — there is no separate directory for
`erp.farooqandcotraders.online`. `hosting_listWebsiteSubdomainsV1` confirms it directly:
```json
{"domain":"erp.farooqandcotraders.online","parent_domain":"farooqandcotraders.online",
 "root_directory":"/home/u943531942/domains/farooqandcotraders.online/public_html/ERP","subdomain":"erp"}
```
And `DNS_getDNSRecordsV1` for `farooqandcotraders.online`:
```json
[{"name":"www","type":"CNAME","records":[{"content":"www.farooqandcotraders.online.cdn.hstgr.net."}]},
 {"name":"ftp","type":"A","records":[{"content":"31.97.219.57"}]},
 {"name":"erp","type":"ALIAS","records":[{"content":"erp.farooqandcotraders.online.cdn.hstgr.net."}]},
 {"name":"@","type":"ALIAS","records":[{"content":"farooqandcotraders.online.cdn.hstgr.net."}]}]
```
Both `@` (the bare domain) and `erp` resolve through Hostinger's CDN (`*.cdn.hstgr.net`), which
routes by hostname to the correct document root on this one hosting account. **One filesystem, one
SSH login, one git repo, two document roots.** See `CLAUDE.md` for the full directory tree and the
practical consequences (path mistakes, CDN caching).

Also found at the domain root (outside `public_html`, so not web-served):
- `farooq-co-erp-complete-v19.zip` (1.6MB) — a full mirror of the ERP package, timestamped to
  match the last ERP update; reads as an intentional "download everything as one file" export, not
  stray/leaked data. Left in place.
- `DO_NOT_UPLOAD_HERE` — an empty marker file, likely Hostinger- or user-created, warning not to
  put site files at the domain root (use `public_html/` instead). Left in place.
- `web/package/` — an empty directory, looks like harmless leftover clutter from an earlier
  session. Left in place; low priority, ask before deleting anything on the server this session
  didn't create.

Live status checked directly: both `https://farooqandcotraders.online/` and
`https://erp.farooqandcotraders.online/` return `200` with valid SSL (`curl -s -o /dev/null -w
'%{http_code} (SSL: %{ssl_verify_result})'`). Domain registration confirmed via
`domains_getDomainDetailsV1`: active, locked, privacy-protected, expires 2027-09-08 — nothing
needs attention there.

## Full sync verified (2026-09-15)

After fixing `build.py`, `test-docx.mjs`, and `test-khata.mjs` locally (see the build-pipeline
section above), those three files were also deployed live — they aren't executed by the running
site, only sitting in the webroot as reference source, so this carried no runtime risk:

1. Backed up the three live originals to `/home/u943531942/backups/pre-sync-<timestamp>/` on the
   server before touching anything.
2. `scp`'d the fixed local copies over the live ones.
3. Verified with `md5sum` on both ends — checksums matched exactly.

**Result: local, GitHub (`main`), and live are fully in sync.** No application-facing behavior
changed on either site; only non-executed dev tooling was updated.

## New tooling added this session

- **`.github/workflows/erp-build-test.yml`** — GitHub Actions CI. Reconstructs the build-staging
  area the same way a human would (see `CLAUDE.md` → "How to build the ERP locally"), runs
  `python3 build.py`, then every `test-*.mjs` (each already `process.exit(1)`s on any failed
  check, confirmed by reading `test-erp.mjs`'s tail — so CI actually goes red on a real failure,
  not just a script error). Triggers on push/PR touching `erp-upgrade/` or `app/`.
- **`scripts/deploy-erp.sh`** — implements the recommended deploy flow end-to-end for the ERP
  subdomain: refuses to run with uncommitted changes, rebuilds, runs the full test suite and
  aborts on any failure, backs up the live `app/` folder with a timestamp, uploads the new build,
  reminds you to clear the CDN cache (can't call the MCP tool from bash, so this step is manual or
  done by whichever Claude session runs the script), then curls both live URLs to confirm `200`.
  The homepage has no build step, so it isn't included — see the one-line `scp` command in
  `CLAUDE.md` instead.

## Scope explicitly not covered this session

The 30 ERP modules under `erp-upgrade/` (the actual invoice/inventory/reporting/etc. business
logic, roughly 1MB of JS) were **not** audited for bugs. This session's "fix all" was scoped to
the deployment/build/sync infrastructure — a well-defined, verifiable unit of work (verified by
1,049 passing tests + checksums). Auditing the business logic itself is a materially different,
much larger task against live financial software real people depend on, and deserves an
explicitly scoped review of its own rather than being bundled in here on assumption.

## MySQL database setup and test (2026-09-15)

The user had already provisioned a database in hPanel before this session: `u943531942_facotraders`
on `srv1774.hstgr.io`, with Remote MySQL access already whitelisted for `203.215.169.140` and `%`
(both visible in the hPanel screenshot the user shared). Confirmed the same via
`hosting_listAccountDatabasesV1(username="u943531942", domain="farooqandcotraders.online")`, which
also returned the full permission set (effectively full CRUD + DDL) and confirmed `port: 3306`.

**Password**: Hostinger's API never returns an existing database password, and
`hosting_changeDatabasePasswordV1` was blocked by Claude Code's own auto-mode safety classifier
("Secret-Store Writes") — this is a harness-level guardrail on writing credentials, independent of
whatever access the user has verbally granted, and correctly required an explicit decision rather
than being silently retried or worked around. Asked the user directly; they provided the existing
password (already set outside this session, not repeated here — see `~/.claude.json`) and said not
to change it.

**MCP server added** to the user's global `~/.claude.json` (this file lives outside any git repo —
`C:\Users\talha\.claude.json` — so there was never any risk of the password ending up in this
project's GitHub repo). Added as a sibling entry to the pre-existing `dbhub-goHelp-...` server,
same `@bytebase/dbhub` package, same `stdio` transport:

```json
"dbhub-facotraders-theumairzero7@gmail.com": {
  "command": "npx",
  "args": ["-y", "@bytebase/dbhub@latest"],
  "transport": "stdio",
  "env": {
    "DSN": "mysql://u943531942_facotraders:<password, percent-encoded>@srv1774.hstgr.io:3306/u943531942_facotraders"
  }
}
```
(Actual value is in `~/.claude.json` only — not reproduced here.) The real password contains an
`@`, which is percent-encoded (`%40`) in the DSN so it isn't parsed as the user/host separator —
same pattern already used in the pre-existing `dbhub-goHelp-...` entry for its own `@`-containing
password.

Validated `~/.claude.json` was still well-formed JSON after the edit (`python3 -c "import json;
json.load(...)"` → `VALID JSON`).

**Live test** (this MCP server won't be loaded as a tool until the next Claude Code session
restart, so testing right now meant connecting directly rather than through the not-yet-loaded
`dbhub` tool): installed `mysql2` in the scratchpad directory and ran a full round trip —
`CREATE TABLE _claude_access_test`, `INSERT`, `SELECT`, `UPDATE`, `DELETE`, `DROP TABLE` — all
succeeded, then the test table was dropped so the database is back to exactly how it started (0
tables). Server reported: MariaDB `11.8.9-MariaDB-log`, connected as
`u943531942_facotraders@203.215.169.140` — confirming the whitelisted IP is what's actually being
used from this machine.

**What this database is for is not yet defined.** The ERP is explicitly client-side/IndexedDB-only
by design (see `README.md`, `SCHEMA.md`) — this new database doesn't have an assigned role in that
architecture yet. Don't start writing application code against it on assumption; get the intended
purpose from the user first (see `CLAUDE.md` → "MySQL database" for the open item).
