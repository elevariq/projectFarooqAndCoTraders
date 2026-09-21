# Brand conversion (2026-09-21)

**Why.** Client: rice bags are "converted" from one brand to another (Taj Mahal ↔ Al Mamoon) — the bags are re-printed, the
count is the same. Before this, the only way was two manual entries (Adjust down one, Add stock on the other). They asked for one
action that lowers one brand and raises the other automatically. They also asked for an "edit" on Add stock to raise/lower stock:
that already exists as **Inventory → Adjust** (Increase / Decrease per line, reason required, audited) — no change made there.

**What it is.** A new stock-document type `CONVERT` (number `CNV-YYYY-nnnnnn`), opened from **Inventory → Convert Brand**.
It uses the normal line editor (`05-ui-builder.js`, mode `convert`): each line = source product (picker), **Convert to** brand
(dropdown of every active product except the source), bags. Same warehouse for both sides (the line's warehouse). One optional note.

**Rules (in `StockDocs.save`, `07-transactions.js`).**
- Per line: target required, must exist, be active, and differ from the source. Source stock is checked against the *total* asked
  of that product+warehouse across lines (respects the "allow negative stock" setting). Any failure → nothing is written.
- Per line two movements in ONE transaction: `CONVERT_OUT` on the source (−q) and `CONVERT_IN` on the target (+q).
  The document's `totalQty` counts each bag once.
- **Cost (the bags keep the value they had):** the cost passed on is what the **Stock value** screen shows for the source row
  (`ERP.StockValue.costOf`: recorded average → cost carried on the movements, e.g. typed on Add stock → another warehouse → list price).
  A catalogue *list price* is an estimate and is NOT passed on (cost 0 = unknown, nothing invented).
  On the target, `Inventory.apply` blends the bags into its moving average for `CONVERT_IN` — empty target: takes the source cost;
  target with its own average: weighted (60 bags @3,000 + 40 @2,000 = 2,600); target holding bags with NO recorded average: keeps none,
  and Stock value carries the cost via `CARRIED`. Net effect: the company stock value does not change when a bag is re-printed.
  Caveat (same as any non-purchase stock): a later purchase of the target recomputes its average from purchases (`17-profit.js`), which
  does not look at conversions.
- Double-clicked Save is ignored (claimed operation id). Audit entry lists "A → B × n" for every line.
- Bags in = bags out (1:1). A conversion that changes the count (loss/gain) is an Adjust on top of it, by design.

**Also touched.** `02-services.js` (enum + labels), `09-paperwork.js` (note "BRAND CONVERSION NOTE", list on Inventory, button),
`13-reports.js` / `14-reports-ui.js` (stock movement report: conversions are a signed net in the "Transfers / conversions" column
so the closing figure balances), `06-wiring.js` (change handler, panel map, CSS).

**No database change.** `stock_docs.type` and `stock_movements.kind` are free-text generated columns, so no DDL and no
`deploy-api.sh` — only `deploy-erp.sh`.

**Test:** `erp-upgrade/test-convert.mjs` (44 checks: refusals, atomicity, cost/value incl. blended averages and Add-stock cost,
idempotency, multi-line, converting back, report balance, the note, and the real screen flow); `test-server-db.mjs` also
runs a conversion through the server-data driver (CNV document, both movements and both stock rows committed together).

**Seen in real headless Chrome (2026-09-21):** the Inventory button row, the editor at 1320 px and 390 px, and a real mouse click opening the
themed "Convert to" popup (searchable, 131 brands). At a narrow desktop width the table scrolls sideways (same as Adjust/Transfer).

**Deployed 2026-09-21** as commit `124dd78` (together with the Extra-cost-per-bag work, `779dcd4`) by
`scripts/deploy-erp-from-clean-clone.sh`: every test passed, the three `_app/` files on the server have the same md5 as the build, cache cleared.
Rollback copy of what was live before: `~/backups/erp-deploy-20260921230732/` (three files + `app/`).
- The wrapper printed `md5 MISMATCH` / `DEPLOY FAILED (exit 2)` although the hashes were identical: local `md5sum` writes `*index.html` (binary
  marker on Windows Git Bash), the server writes `index.html`, and the wrapper compares the whole line. Compare the hash column, not the line.
- Read-only check in the owner's signed-in Chrome afterwards: the app runs on the server backend, has `StockDocs.convert`, the `convert` editor mode and
  `StockValue.costOf`, and Inventory shows Edit products · Pricing settings · Add Stock · Transfer · **Convert Brand** · Adjust, with no console errors.
  **No conversion was posted on live data** (deliberately).

**Not yet seen on the live site or a physical phone:** an actual conversion (the editor, the note viewer/PDF, the server write), and phone/desktop layout there.
Suggested first live use: one small conversion between two brands in a warehouse with stock, then confirm both counts and the CNV note.
