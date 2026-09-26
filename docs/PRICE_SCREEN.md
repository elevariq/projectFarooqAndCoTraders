# Product prices screen — reason optional, honest Save, the sum on screen (2026-09-26)

**Client report:** "purchase 6000, extra 200, total 6200, selling 6300, 5 × 6300 = 31,500, actual profit 500 — the system shows 1500."

**What the live database showed:** the product had no extra cost saved (no `extraP`, `price_history` empty, no "Product prices
updated" audit entry) — the sales were costed at 6,000 because that was all the system had. The screen let the client *think* they
had saved:

* `panel.save()` returning an object closes the panel and shows "Saving prices…" at once (`savePanel` in the base app). The
  "Give a reason" refusal came from `Prices.set` **after** that, as a short toast — a forgotten reason looked like a finished save.
* The reason was required (`priceReasonRequired: true` is stored in the live settings row, so changing only the default would not have helped).

**Changed (module 21 only, no schema change → `deploy-erp.sh` only):**

* A reason is optional. `Prices.set` no longer asks for one; the Settings toggle and default are gone. Bulk price change (module 23) still asks for one — it is one audited act.
* `Prices.diff(productId, values)` = what a save would change. `save()` uses it to refuse "nothing to save" **inside** the panel; every refusal must be
  found before `save()` returns, because returning without an error closes the panel. Async failures now read "NOT saved — …".
* The panel opens with saved values; a product with no saved selling price opens with the rate it last sold at (live invoice lines, `lastSoldP`), with a hint; Save keeps it.
* New block under the live line: purchase / + extra / = total cost per bag / selling price / profit per bag, and a "Try it with N bags" box (`#pzCalcRows`, `#pzCalcTot`; not saved, not a `data-f`).
  The old `#pzLive` line is unchanged (tests E21–E24 read it).
* `test-price-screen.mjs` (P1–P17) replays the client's numbers end to end: 1,500 without the extra, 500 after it is saved; `test-settings.mjs` S6 now expects a reason NOT to be required.

**Second finding, same day (client: "I wrote 6000 / 200 / 6300 — I think the values come there wrong"):** they were right. The client saved the prices correctly, but
**Add stock** ("Cost (optional)" column) opened pre-filled with the product's SELLING price — `lastRate()` in `05-ui-builder.js` has a customer branch that returns `Prices.of().sell`,
and the Add stock mode (`cost:true`, no party) fell into it. 6300 stayed as the stock cost → cost 6,500 with the extra → a 1,000 LOSS on 5 bags at 6,300 (INV-2026-000001 on the server).
Fixed: Add stock offers the saved purchase price (else empty), never the selling price. Also fixed: `Inventory.costOf(pid)` with no warehouse used to CREATE a `<product>|undefined` stock row
(via `Inventory.row`) that `Prices.set` then saved to the server — read-only now, and `Prices.set` skips rows without a warehouse. Tests P18–P21.

**Customer returns — edge cases found the same day (`test-return-guards.mjs`, R0–R10):**

* *Wrong warehouse:* the "Warehouse receiving" box had no `selected` option, so the first warehouse in the list was used (the client's CR-2026-000001 went to College, the sale was from Main). It now opens on the invoice's warehouse and follows the invoice chosen.
* *Same close-then-refuse trap as the prices screen:* too many bags (or "1.2.3") was refused by `Returns.fromCustomer` only after the panel had closed. `PANELS.creditnote.save` now checks quantity, invoice state and replacement stock itself and returns a string.
* *Editing an invoice that has a return:* `Invoices.save` deletes the lines and writes new ones under NEW ids; a return points at a line by id, so the returned bags were forgotten (the same bags could be returned again, `Profit.returned` lost their cost, the PARTIALLY_RETURNED status was overwritten). Until lines keep their ids (as purchase lines do), an invoice with a live return is closed to editing (`Invoices.returnsOn`, message names the CR number; also checked in `editInvoice`).
* Not changed: an edit re-costs a line at TODAY's cost (`snapshotItem` → `saleCostOf`), so editing an old invoice rewrites its profit; returned bags come back with no cost of their own (they take the warehouse's recorded cost, else another warehouse's).
* **Known class, not fixed here:** ~20 other panels (payments 06-wiring 292/346/389/457, master data, payroll, khata, workbench, expenses …) also `return {msg}` and show an async refusal only as a toast after closing. A general fix would let `savePanel` (base app) hold the panel open until a returned promise settles — do it as its own task.

**Not changed:** old invoices keep their cost snapshot (INV-2026-000001/2 on the server still show 1,500). The client's "Add stock" of 5 bags at cost 6,300 (RCV-2026-000002) is a
data-entry slip (that is the selling price) — it is test data.
