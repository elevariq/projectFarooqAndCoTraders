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

## Deploy checklist (once an actual change is ready)

1. `git status` clean, changes committed and pushed to GitHub first.
2. Back up whatever you're about to overwrite on the server, e.g.:
   ```
   ssh -p 65002 u943531942@31.97.219.57 \
     'cp /home/u943531942/domains/farooqandcotraders.online/public_html/ERP/app/index.html \
         /home/u943531942/domains/farooqandcotraders.online/public_html/ERP/app/index.html.bak-$(date +%Y%m%d%H%M%S)'
   ```
3. `scp` up only the specific rebuilt/changed files — not a blind full-folder overwrite.
4. Spot-check the live URL after deploy.
5. Tell the user what was deployed and confirm before deploying anything that touches how
   existing users' browser data is read (schema/migration changes).
