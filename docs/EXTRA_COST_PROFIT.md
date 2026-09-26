# Extra cost per bag in sale-time profit (2026-09-25)

**Client report.** "purchase price 3000, extra cost 200, total 3200 — aur profit 200 show ki" (and the profit showed 200 extra).

**Cause.** The "Extra cost per bag" field (added 2026-09-21, module 21, see `CLAUDE_HISTORY_2026-09-21.md`) was deliberately a
*planning* figure: the Product prices panel showed cost-to-us 3,200 and the right margin, but every sale was costed by
`Inventory.costOf` — the stock cost only (3,000). So a bag sold at 3,400 showed 400 profit on the invoice, in the live
note under the rate and in the Profit report, while the panel said 200. That was open item 13 in `CLAUDE.md`; the client's
report answers it: the extra belongs in profit.

**Change.**
- `02-services.js`: `Inventory.extraOf(pid)` (the product's `extraP`, 0 under the "purchase price only" profit basis
  `profitCostBasis: 'PURCHASE'`) and `Inventory.saleCostOf(pid, wid)` = `costOf + extraOf`, or 0 when the stock cost is
  unknown (the extra alone is not a cost price — the invoice note keeps saying "no purchase cost recorded").
- The invoice line's `costSnapshot` (`Invoices.snapshotItem`) and `Cost.forSale` (live preview) use `saleCostOf`.
- The live note under the rate shows the breakdown: "Cost PKR 3,200 (stock PKR 3,000 + extra PKR 200)/bag".

**Not changed, on purpose.**
- `avgCostP`, Stock value, stock-document unit costs and brand-conversion costs: the extra is what a *sale* costs, not what
  the bags on the shelf are worth.
- Invoices saved before this change keep their snapshot (costed without the extra); an invoice re-saved through edit is
  re-costed at today's figures, as it always was. Raising the extra later does not rewrite old profit.
- **Double-count risk:** transport entered on a purchase through the Landed costs screen (owner-only) is already in the
  stock average under the LANDED basis. A product that also has an Extra cost per bag counts that transport twice. Advise
  the owner to use one or the other for a product. The Product prices panel now shows a warning (`#pzLanded`,
  `Prices.landedAlready`) when a live purchase of the product carries such charges (landed unit cost above the goods
  unit cost) under the LANDED basis. The Extra cost box's hint says it is counted in the cost of every sale.

**Tests.** `test-extra-cost-profit.mjs` (22 checks, the client's own numbers: stock stays 3,000; sale costed 3,200; 10 bags
at 3,400 = 2,000 profit on the preview, the note, the saved invoice and the Profit report; 3,200 = zero profit; 3,100 =
below cost; later extra changes do not rewrite the invoice; no-extra products unchanged; PURCHASE basis leaves it out;
unknown cost stays unknown; the double-count warning shows only when it should). Mutation-checked: costing the
invoice line at `costOf` again turns X8/X9/X10/X12 red (X9 then shows the client's exact bug: 4,000 profit instead of 2,000).

**Deploy.** App only (`deploy-erp.sh`); no schema or PHP change. **Deployed 2026-09-25 ~22:33** with `b2b0778` (the other session's stock-receipt edit): clean-clone deploy, full test gate green, served `_app/*` md5 = build, ERP 401 / homepage 200, Hostinger cache cleared. Backup `~/backups/erp-deploy-20260925223246`. Not yet seen by a person on the live site.

---

# Update 2026-09-26 — the extra is an average carried by the stock

**Client request.** "When the extra cost changes, the bags already in stock must keep the old one; new bags bring the new one; a
sale uses the average" — the same way the purchase price / landed cost already averages. Before this, `saleCostOf` read the
product's CURRENT extra at sale time, so raising 200 → 300 re-priced every bag in the godown.

**How it works now.**
- Every `inventory` row (product × warehouse) carries `avgExtraP`, the moving average of the extra cost of the bags on hand.
  `Inventory.apply` (02-services.js) blends it in **by the bags on hand** (`before`), exactly like `avgCostP`, when NEW bags arrive:
  `PURCHASE_IN`, `MILL_RECEIPT_IN`, `OPENING_STOCK`, `ADJUSTMENT_IN`, `SUPPLIER_REPLACEMENT_IN` — using the product's extra of that day
  (`Inventory.rawExtraOf`). Sales, returns and reversals never move it. Because the weight is the bags LEFT, sold-out lots do not drag the
  figure (unlike `weightedAverage` of the purchase price, which counts every purchase ever made).
- `Inventory.saleCostOf` = `costOf` + `Inventory.extraFor(pid, wid)` (the row's `avgExtraP`; 0 under the "purchase price only" basis).
  `avgCostP`, Stock value and stock-document costs still never carry the extra.
- **Transfers / brand conversion** carry the SOURCE row's figure (`extraCostP` on the `TRANSFER_IN` / `CONVERT_IN` movement).
- **Edits do not re-price the bags around them.** Each purchase line (`purchaseItems.extraUnitP`) and Add-stock line
  (`stockDocItems.extraUnitP`) remembers the extra it came in with. A purchase / receipt edit takes those bags out at that figure
  (`PURCHASE_REVERSAL_OUT` / `RECEIPT_EDIT_OUT` with `extraCostP` un-blend) and puts them back with it. `receiveMore` uses the line's own.
- **Changing the extra** (`Prices.set`, the only writer): rows still following the product (no `avgExtraP` — every row from before this
  change) are pinned to the OLD figure. If the product had NO extra before (0), the first figure typed covers the bags already held
  (rows with no extra), so a client who types an extra on a product that is already in stock sees it at once (the 2026-09-25 behaviour).
  Setting it back to 0 (moving a product to Landed costs) leaves the bags already in stock costed at their figure.
- A row with no `avgExtraP` follows the product's current extra — the old behaviour — until the first stock-in or edit of the extra.
- The warehouse tile's receive (`39-warehouse-server.js`) blends it too (same formula; `extraUnitP` on the mirrored item).

**Not changed / limits.**
- Old invoices keep their `costSnapshot`. An invoice re-saved through edit is re-costed at today's average, as before.
- Landed costs (owner-only, per purchase) still go into `avgCostP`. A product on Landed costs should have Extra = 0 or the
  double-count warning applies (`Prices.landedAlready`).
- The figure is per warehouse row. Customer returns / sale reversals put bags back at the row's current figure.
- No DB schema change (`avgExtraP` / `extraUnitP` live in the JSON docs) → `deploy-erp.sh` only. The new fields are not in
  `database/schema-mariadb.sql`; nothing indexes them.

**Tests.** `test-extra-cost-average.mjs` (30 checks: the client's 200→300 example, sales don't move it, sold-out lots don't drag,
first extra covers held stock, 0 later, legacy rows, transfers, purchase and receipt edits, later deliveries, the profit basis).
Mutation-checked: costing at the product's extra again turns 11 checks red. `test-extra-cost-profit.mjs` X13/X13b/X16/X22 updated.

**Deployed 2026-09-26 ~12:00** (commit `ac2db3f`, app only): clean-clone deploy, full test gate green, served `_app/*` md5 = build, ERP 401 / homepage 200, Hostinger cache cleared. Not yet seen by a person on the live site.
