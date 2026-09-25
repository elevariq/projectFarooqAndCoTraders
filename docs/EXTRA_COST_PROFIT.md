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
