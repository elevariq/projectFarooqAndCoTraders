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

## The build pipeline gap (found while documenting, not yet fixed)

`public_html/ERP/erp-upgrade/build.py` is meant to inject the 25 upgrade modules into an
original ERP HTML file to produce `app/farooq-co-erp.html` and `app/index.html`. Reading it:

- It reads modules from `erp-upgrade/mod/<name>.js` (`MODDIR = BUILD / "mod"`).
- It reads the pre-upgrade original from `erp-upgrade/farooq-co-erp.html`.

Neither exists in what's currently live/pulled — the deployed `erp-upgrade/` folder has the 25
module `.js` files directly in its root (not under `mod/`), and there is no unbuilt original HTML
file alongside them (only the already-built one under `app/`).

**Consequence**: `python3 build.py` cannot be run as-is right now. Before any ERP logic change
that needs a rebuild, this needs to be sorted out first — either by locating/recreating the
missing `mod/` layout and original file, or by adjusting `build.py` to match how the modules are
actually laid out on disk. Don't hand-edit the built `app/*.html` files as a workaround; that
defeats the module system and will make future rebuilds overwrite manual fixes silently.

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
