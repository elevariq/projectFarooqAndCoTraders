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
- **Cost:** both movements carry the *source's* cost; `37-stock-value.js` lists `CONVERT_IN` in `CARRIED`, so the target is valued at
  that cost (same treatment as `TRANSFER_IN`) and the company stock value does not change. It does NOT feed the target's moving
  average (`Inventory.apply` only does that for purchases / mill receipts) — see open item 7 in CLAUDE.md, same caveat as Add stock.
- Double-clicked Save is ignored (claimed operation id). Audit entry lists "A → B × n" for every line.
- Bags in = bags out (1:1). A conversion that changes the count (loss/gain) is an Adjust on top of it, by design.

**Also touched.** `02-services.js` (enum + labels), `09-paperwork.js` (note "BRAND CONVERSION NOTE", list on Inventory, button),
`13-reports.js` / `14-reports-ui.js` (stock movement report: conversions are a signed net in the "Transfers / conversions" column
so the closing figure balances), `06-wiring.js` (change handler, panel map, CSS).

**No database change.** `stock_docs.type` and `stock_movements.kind` are free-text generated columns, so no DDL and no
`deploy-api.sh` — only `deploy-erp.sh`.

**Test:** `erp-upgrade/test-convert.mjs` (36 checks: refusals, atomicity, cost/value, idempotency, multi-line, report balance,
the note, and the real screen flow).

**Not seen live yet:** the editor's "Convert to" column at desktop/phone width, the Inventory button row, the note viewer/PDF
for a conversion, and a real conversion on the server data.
