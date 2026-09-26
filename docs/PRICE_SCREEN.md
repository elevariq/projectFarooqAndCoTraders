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

**Not changed:** old invoices keep their cost snapshot (INV-2026-000001/2 on the server still show 1,500). The client's "Add stock" of 5 bags at cost 6,300 (RCV-2026-000002) is a
data-entry slip (that is the selling price) — it is test data.
