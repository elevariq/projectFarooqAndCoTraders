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
* *"What happens to the money" (client asked what to select):* in the books **Reduce what the shop owes** and **Hold as customer credit** are identical (a credit note; a shop that already paid is left with credit, e.g. −18,900);
  **Refund** posts a cash-out payment that cancels the credit note (balance unchanged); **Replace** issues the bags again (no money). Found: a REFUND on an UNPAID invoice paid out cash never received and left the
  shop owing the whole sale. `Returns.refundLimitError` now limits a refund to what was paid on that invoice minus earlier refunds (service + panel; R11–R16; `test-pay-a-shop.mjs` C11 now uses a paid invoice). The panel explains the four options.
* *Stock read 10 after 5 in / 5 sold / 5 returned (client, same day) — the server had 5:* a double-pressed "Post return" ran `Returns.fromCustomer` twice (each press its own operation id; both passed the "can still
  return" check before either wrote). The server refused the 2nd, but its in-memory changes (bags, credit note, returned qty) stayed on that page until a reload. Reproduced in server mode (mock) before fixing.
  `RETURN_IN_FLIGHT` now refuses a return that is still being posted ("already being posted"). R22–R25. The general limit stays: after ANY refused server save the page's memory is only corrected by the "NOT saved — Reload" step.
* *Screens after a full return (client: "31,500 still at shop profile and sales dashboard"):* the shop statement shows Total sales 31,500 AND Returns & credits 31,500 → balance 0 (as designed). The base dashboard's
  "Today's sales/purchases" tiles used `TODAY_ISO = '2026-09-06'` (frozen from the mock-up) — they never showed real sales; they now use the real day (`FC_TODAY`) and take today's returns off. The dashboard profit table, the
  Sales report / Overview / Reports "Gross profit" cards read profit AFTER returns (`netProfit`; the raw `grossProfit` key is unchanged). The older screens' list-filter chips (Today / 7 days / Month), the period pickers (`PERIODS` — its week/month starts were typed dates) and exported CSV file names also read that frozen date — they now use `realToday()` (base app).
* *Double click on ANY panel's Save:* `closePanel` only removes the `on` class (a slide-out), so the Save button stayed clickable for the animation and a quick second click ran `save()` again — two receipts, two returns. `savePanel`
  (base app) now does nothing once the panel is closed (R34: three quick clicks on Receive payment = one receipt). A refusal (string) leaves the panel open, so retrying still works.
* *Client's next test (12:00 PKT), "customer paid part but Paid still shows zero; the return options are confusing":* the 31,000 receipt (REC-2026-000001) was recorded against **Zain mega mart**, but the invoice
  (INV-2026-000002) belonged to **Aurangzib sheringal** — the wrong shop, so no allocation and Paid 0 (Zain got 31,000 of credit). Then a **REFUND** on that unpaid invoice paid out 31,500 cash never received (PV-2026-000002)
  — the case `refundLimitError` blocks, but it was not deployed yet. Changes: *Receive payment* now shows the shop's balance and "after this payment", warns "This shop owes nothing … check you chose the right shop" as soon as an amount is typed,
  and Save refuses "Oldest unpaid invoices first" for a shop with no unpaid invoice (the person must choose "Leave on account" to keep money as credit on purpose). *Customer return* now offers three plain choices
  (Take it off what the shop owes / Give the money back in cash / Send the same bags again — "Hold as customer credit" was identical to the first and is no longer offered in the panel; the service still accepts it) and a live
  sentence with the shop's real numbers (`#fcRetMoney`). R26–R33.
* *Client's full round (12:38–12:45 PKT) — the same transport counted twice:* purchase PUR-2026-000001 (5 bags at 6,000) had **1,000 typed as "Other charges"** (→ landed 6,200/bag, supplier shown as owed 31,000 not 30,000) AND the
  product already had **Extra cost 200** → the sale was costed 6,400 (profit −100/bag, not +100). The rest was right: the 3,200 part payment landed on the invoice (Paid 3,200), the return went back to the sale's warehouse,
  and the 3,200 was handed back through **Pay a shop** (PV-2026-000001) leaving the shop at 0. Changes: `Purchases.doubleCostWarning` — a purchase with freight/loading/other charges for a product that has an Extra cost is refused once with a clear
  sentence, and kept on a second Save (`confirmable`, `draft.confirmCharges`; builder catch in 05-ui-builder.js); the Product prices screen now shows a breakdown banner ABOVE the boxes ("supplier price 6,000 + charges 200 = 6,200 already in stock") with real numbers,
  opens "Purchase price" on what the MILL charges (`landedBreakdown().goods`) when none is saved, and warns live if an Extra cost is typed on top (`PRICE_LANDED`). The return screen tells the person that a shop left with credit is paid back through Payments → Pay a shop. R36–R42.
* *"I paid the customer back — why does Sales show −3,200?":* the shop's account was 0 (31,500 sale − 3,200 paid − 31,500 credit note + 3,200 handed back through Pay a shop) but the INVOICE's own balance,
  `Invoices.outstanding` = total − allocated payments − credit notes, was −3,200: cash paid back with "Pay a shop" is linked to the shop, not the invoice, so the minus never went away and fed the Sales "Outstanding" total.
  `outstanding` is now never below zero (credit lives on the shop's account, `Ledger.customer`). The dashboard's Receivables tile also summed SIGNED balances, so one shop's credit lowered what others owe — it now adds only positive balances. R43–R47.
* *"Pay back" button on Sales & invoices (owner's idea, 2026-09-26):* an invoice whose shop paid and then returned goods shows **Pay back N** (N = `Invoices.refundDue`: paid − (invoice − return credit) − already handed back, and never more than the
  shop's account really holds as credit, so an older unlinked "Pay a shop" voucher can't be paid twice). It opens `PANELS.payback` with the amount already filled in; the person may pay less (in parts) but never more (screen + `Payments.refund({invoiceId})`
  both refuse). The voucher stores `refundOfInvoiceId` / `refundOfInvoiceNumber` on the payment doc (no schema change; the API has no field whitelist) and `Invoices.refundedFor` counts it (reversing the voucher brings the amount back). Payments → Pay a shop still works.
  Hidden without `PAYMENT_CREATE`. R48–R58.
* Not changed: an edit re-costs a line at TODAY's cost (`snapshotItem` → `saleCostOf`), so editing an old invoice rewrites its profit; returned bags come back with no cost of their own (they take the warehouse's recorded cost, else another warehouse's).
* **Known class, not fixed here:** ~20 other panels (payments 06-wiring 292/346/389/457, master data, payroll, khata, workbench, expenses …) also `return {msg}` and show an async refusal only as a toast after closing. A general fix would let `savePanel` (base app) hold the panel open until a returned promise settles — do it as its own task.

**Not changed:** old invoices keep their cost snapshot (INV-2026-000001/2 on the server still show 1,500). The client's "Add stock" of 5 bags at cost 6,300 (RCV-2026-000002) is a
data-entry slip (that is the selling price) — it is test data.

**"I am unable to edit Charges on the purchase / Extra cost; Save says Nothing to save" (client, 2026-09-26):** the two lines in the sum under the boxes (`#pzCalcRows`) look like fields but are a
read-only written-out sum — only the **Extra cost per bag** box above is a box; the "Charges on the purchase" figure is typed on the PURCHASE (Other charges ÷ bags). Now each line has a **Change** button
(`data-pzedit`): Extra cost focuses its box; Charges closes the screen and opens `ERP.actions.editPurchase` for the purchase the figure came from (`landedBreakdown().purchaseId`) — refused with a message while boxes
hold typed-but-unsaved figures (compared with `defaultValue`, so pre-filled boxes don't count). The "Nothing to save" text now says which boxes to type in and that the charges line is not a box. Tests P8–P12 in `test-purchase-cost.mjs`. Module 21 only → `deploy-erp.sh`.
