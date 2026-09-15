# Farooq & Co Traders ERP — Multi-Item Transactions & the Classic Invoice

**Version:** `2026-09-09-multiitem-v2` · builds on `…-invoicing-v1`
Every product-based transaction in the ERP is now one parent with many line items, and the
invoice is laid out from your own `SInvoice.pdf`.

---

## Multi-item modules completed

| Transaction | Parent → children | Numbering | Stock effect |
|---|---|---|---|
| Sales invoice | `Invoice → InvoiceItem[]` | `INV-2026-000001` | `SALE_OUT` per line on confirm |
| Sales order | `Order → OrderItem[]` | `SO-2026-000001` | none |
| Quotation | `Order(kind=QUOTATION) → OrderItem[]` | `QT-2026-000001` | none |
| Purchase | `Purchase → PurchaseItem[]` | `PUR-2026-000001` | `PURCHASE_IN` per received line |
| Stock receiving | `StockDoc(RECEIVE) → StockDocItem[]` | `RCV-2026-000001` | `ADJUSTMENT_IN` / `OPENING_STOCK` |
| Warehouse transfer | `StockDoc(TRANSFER) → items[]` | `TRF-2026-000001` | `TRANSFER_OUT` + `TRANSFER_IN` per line |
| Stock adjustment | `StockDoc(ADJUST) → items[]` | `ADJ-2026-000001` | `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` per line |
| Dispatch | `StockDoc(DISPATCH) → items[]` | `DSP-2026-000001` | `DISPATCH_OUT`, **only if not already deducted** |
| Customer return | `CustomerReturn → items[]` | `CR-2026-000001` | `CUSTOMER_RETURN_IN` / `CUSTOMER_RETURN_DAMAGED_IN` |
| Supplier return | `SupplierReturn → items[]` | `SR-2026-000001` | `SUPPLIER_RETURN_OUT` per line |
| Replacements | on the return parent | — | `REPLACEMENT_OUT`, `SUPPLIER_REPLACEMENT_IN` |
| Payment | `Payment → PaymentAllocation[]` | `REC-` / `PV-` | none — money only |

Line items are their own normalised rows, never a JSON blob on the parent.

## One line editor, not nine

All of the above open the same screen: **+ Add Item**, a searchable picker (name, Urdu name,
brand, category, SKU, bag size) showing `Available: 325 Bags` for the selected warehouse, then
editable rows with quantity, rate, discount, per-line warehouse, reorder and remove, and a sticky
totals bar. The editor only shows the columns a given transaction needs — an adjustment gets an
increase/decrease column, a purchase gets an Ordered and a Received column, a transfer drops rates
entirely.

## Database

Schema version 2. New stores: `orders`, `orderItems`, `stockDocs`, `stockDocItems`, `operations`
(the idempotency register). Existing stores and data are untouched — the upgrade adds the new
stores on open and nothing is migrated a second time.

## Validation and rollback

Every line is validated before anything is written, and all problems are reported together.
Duplicate demand for the same product across several lines is summed before it is checked against
stock. If one line is short, the whole transaction is refused:

> Only 20 bags of Zam Zam Flour 20 KG are available in Main Warehouse. Requested: 25.

No invoice, no line items, no stock deduction, no ledger entry, no payment.

Rejected: zero and negative quantities, negative rates, negative discounts, discounts larger than
the line, empty transactions, invalid products or warehouses, same-source-and-destination
transfers, adjustments without a reason, returns above what was sold or received, and receipts
above what was ordered.

## Returns

Per line: `SELLABLE · DAMAGED · DEFECTIVE · WRONG_ITEM · EXPIRED · OTHER`. Only `SELLABLE` bags
rejoin sellable stock; everything else goes to a separate damaged bucket that cannot be sold.

Per return: `ADJUST_OUTSTANDING_BALANCE · CUSTOMER_CREDIT · REFUND · REPLACEMENT`. A refund posts
a real outgoing payment instead of a negative invoice; a replacement posts `REPLACEMENT_OUT`
against the returned goods and raises no credit. Returns are valued at the rate on the original
invoice line, not today's rate. Supplier returns reference the purchase line and cap at
received − already returned.

## Dispatch and double deduction

There is exactly one physical deduction. A dispatch linked to an invoice that already moved the
stock records the delivery, writes the dispatch number back onto the invoice and moves nothing.
A standalone dispatch deducts. The screen says which is happening before you save.

## Idempotency

Every parent write claims an operation id built from the client operation id and the revision the
client believes it is editing. A double-clicked Save, a retried call or a replayed offline queue
submits the same payload and is refused — while a genuine edit, loaded fresh, carries the new
revision and goes through. The Save button also disables itself while writing.

## The invoice

Rebuilt from `SInvoice.pdf` and made the default: centred `INVOICE`, the Urdu trade header,
**Bill to Party**, `Invoice #` / `InvNo` (SLV-000020) / `Invoice Date` / `ID #`, the account
ledger (Date تاریخ / Dr بنام رقم / Cr وصولی) on the left with its subtotal, the product table
(Product / Price / Quantity / Amounts) on the right with its subtotal, then the box —
Gross Amounts سب ٹوٹل, Opening سابقہ بقایا رقم, Total ٹوٹل بل رقم, Cash Amt نقد وصول, Balance
بقایا رقم — and Remarks. Identical on screen, in print, in PDF and in editable Word. The earlier
itemised layout is still available in Settings → Invoice layout.

## Reports

A five-item invoice appears once in sales totals and five times in product reports. Parent-level
reports count parents; product, inventory and profit reports walk the lines.

## Tests

**183 checks, 183 passing**, run against the built page in a DOM with a working IndexedDB.
The new brief's acceptance tests:

| Test | Result |
|---|---|
| 1 — five-item sale | one invoice, five lines, five movements, **one** receivable entry |
| 2 — five-item purchase | one purchase, five lines, stock up on all five, one payable |
| 3 — inventory receiving | three products in one receipt, no fake purchase created |
| 4 — insufficient stock rollback | whole transaction refused, no stock moved for the good lines |
| 5 — quantity validation | 0 and −5 rejected |
| 6 — price / discount validation | negative price, negative discount and over-discount rejected |
| 7 — customer return | one return, three lines, mixed conditions, damaged kept aside, refund and replacement paths |
| 8 — supplier return | one return, two lines, capped at received, replacement received back |
| 9 — warehouse transfer | three products, `TRANSFER_OUT` + `TRANSFER_IN` each, company stock unchanged, short line rolls back |
| 10 — ten-item invoice | database, preview and Word all show the same ten lines under one number |
| 11 — 25-item invoice | two pages, repeated headers, totals intact, nothing cropped |
| 12 — duplicate submission | second identical Save refused, stock deducted once |
| 13 — persistence | invoices, lines, orders, transfers, returns, movements, ledgers all identical after restart |
| 14 — reports | totals not multiplied by line count; product report still per line |

Also covered: orders and quotations with their own series, order → invoice conversion, dispatch
without double deduction, adjustments in both directions, partial purchase receiving
(100 ordered / 70 received / 30 later).

Two defects were found and fixed by these tests: two transactions that wrote to a store they had
not declared in their scope, and an idempotency key that treated a repeated submission as an edit.

Word output was rendered through LibreOffice and inspected page by page.

## Files changed

`erp-upgrade/01-db.js` (schema v2, idempotency register) · `02-services.js` (movement vocabulary,
return conditions and treatments, partial receiving, idempotency) · `05-ui-builder.js` (rewritten
as the shared line editor) · `06-wiring.js` (routing, return panel, settings) ·
**new** `07-transactions.js` (orders, quotations, transfers, receiving, adjustments, dispatch) ·
**new** `08-classic-invoice.js` (the SInvoice layout) · `farooq-co-erp.html` and `index.html` rebuilt.

## Remaining limitations

1. **No live-browser visual check** — automation was unavailable. Logic, every screen and the Word
   output were verified; the editor and preview were not photographed in a real browser.
2. **Reservations are not implemented.** Orders do not hold stock; the deduction happens at
   invoice confirmation, or at dispatch when the dispatch is standalone. The brief said not to add
   reservation complexity unless the business needs it — say the word if you want it.
3. **Roles are still advisory** — enforced by hiding actions, not by a server, because there is no
   server.
4. **`file://` storage** — serve the folder over `http://` or use the launcher; opening the file
   directly makes some browsers block storage.
5. **The warehouse PWA still uses the older shared record** and has not moved onto the new stores.
6. **Opening balances are still reference-only** — carrying them in is a deliberate cutover
   decision and needs your instruction.
7. **Cancellation of a paid invoice** reverses stock and receivable but leaves the payment posted
   for you to refund or convert to credit deliberately; it is not swept automatically.
