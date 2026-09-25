# Editing an "Add stock" receipt (2026-09-25)

Client request: stock added through **Inventory → Add Stock** must be editable afterwards.

## What the user sees

- **Inventory → Stock receipts** list: each receipt row has **Edit** next to **Open**.
- The **Stock receipt note** (document viewer) has an **Edit** button too.
- Edit asks for confirmation, then opens the same Add-stock screen titled **Edit stock receipt**, marked
  "Editing RCV-…", filled in with the warehouse, date, reason, notes and every line (product, bags, cost).
  Everything can be changed: bags, cost per bag, product, lines added/removed, warehouse, date, reason.
- **Save changes** applies it; the receipt keeps its RCV number and the note reopens.
- Who may: roles with `STOCK_MANAGE` (Owner, Manager, Warehouse) or `TRANSACTION_CORRECT` (Accountant).
  Sales may not. Only RECEIVE documents are editable. Transfers, adjustments, conversions and dispatches are not.
  Receipts made in the Warehouse app are the same records, so they are editable here too.

## How it works (`07-transactions.js` `StockDocs.editReceive`)

One atomic save, the same shape as the purchase edit:

1. Every old line goes back OUT of stock as a `RECEIPT_EDIT_OUT` movement (refType `STOCK_RECEIPT_EDIT`),
   dated as the **original** receipt, carrying the **old line's cost**. The old line records are deleted.
2. The corrected lines go IN as new lines + `ADJUSTMENT_IN` movements (`OPENING_STOCK` if the receipt was posted as
   opening stock), dated with the (possibly corrected) date.
3. The header keeps id, number, creator and createdAt. It gets the new warehouse/date/reason/notes/totals, `revision + 1`,
   `updatedAt`, `updatedBy`. One audit entry, "Stock receipt edited", lists the old and new lines.

**Cost:** `ADJUSTMENT_IN` never moves `avgCostP`. Its cost lives on the movement and is picked up by
`Inventory.carriedCost` and Stock value's `carriedMap` (37). Both now **subtract** `RECEIPT_EDIT_OUT` movements at their
cost. So a corrected cost *replaces* the old one instead of being averaged with it.

**Stock guard:** the check is on the NET change per product + warehouse. If bags from the receipt were already sold or
moved, the edit cannot take back more than is still there. The guard is skipped when Settings allows negative stock,
the same as everywhere else.

**Idempotency / two windows:** the operation key is `<clientOpId>#edit<revision+1>`. A second window editing from its
old copy is refused and nothing is written. The edit screen then says the receipt was already changed elsewhere and asks
for a reload.

**Not changed:** invoices already posted keep their `costSnapshot` (profit on past sales does not move). Receipts
have no cancel/delete. To remove one completely, edit it down, or use Adjust.

## Also fixed in the same change

The stock movement report (`13-reports.js` `Analytics.inventory`) added every "adjusted" movement as a positive
size. So with a start date, an Adjust OUT (or a purchase-edit / receipt-edit reversal) **raised** the closing figure.
"Adjusted" is now a signed net, like conversions. Without a start date the report already used the live count.

## Tests

`test-receipt-edit.mjs` (engine, cost, guard, refusals, roles, report, screens, reload) and `test-server-db.mjs` HR1–HR4
(one atomic commit on the server; stale window refused). Not seen live yet.
