# Farooq & Co Traders ERP — Final Merged Build

**Version:** `2026-09-11-export-step-v7`
**Files:** `index.html` (launcher) · `farooq-co-erp.html` (office ERP) ·
`farooq-co-warehouse-pwa.html` · `farooq-and-co-homepage.html` · `farooq-erp-data.js` ·
`erp-upgrade/` (source modules, build script, three test harnesses)

Open **`index.html`** and choose **Office**. Everything else is carried in it.

---

## About the two codebases

Two parallel implementations existed: this modular one, and an in-house inline build
(`682 KB`, with `computeInvoice`, `idbOpen`, `buildDocx`, `liAddRow`, `fcSnapshot`). They solve
the same briefs in different ways, so stitching them together line by line would have produced
two invoice engines, two Word writers and two databases fighting each other inside one page.

What has been done instead is a real merge where it matters:

* **This build is the base** — it carries the atomic cross-store database, integer-paisa money,
  multi-line everything, the SInvoice layout and 282 passing checks.
* **Everything the other build had and this one lacked has been added**: order and quotation
  documents, warehouse transfer notes, stock receipt notes, adjustment notes, dispatch notes,
  an SMS/WhatsApp provider panel, and an Email action on every document.
* **The other build's data is adopted automatically.** On first open this build reads whatever
  the previous one left behind and brings it across, including its multi-line invoices.
  Its own storage is read, never written and never deleted.

### The database collision that had to be fixed

The in-house build named its database `farooqco_erp` and stored one JSON snapshot in a `state`
store with out-of-line keys. The previous version of this build used **the same name** with
normalised stores. Opening one over the other would have corrupted it. This build therefore uses
`farooqco_erp_ledger` and adopts the old database on first run:

| What is found in the old database | What happens |
|---|---|
| a `state` snapshot (in-house build) | invoices, purchases, payments, stock, damaged stock, transfers and adjustments are migrated — multi-line sales keep every line |
| normalised stores (earlier build of this one) | every record is copied across as it is, numbers and all |
| nothing | the browser record `farooqco_erp_v1` is migrated, as before |

Verified by `erp-upgrade/test-merge.mjs` — **21 checks**, including that a three-line sale keeps
all three lines with their rates, discounts and cost snapshots; that stock, damaged stock,
payments and both ledgers come across exactly; and that the old database is left untouched.

---

## Bugs found and fixed in this pass

These were found by driving the actual screen, not the service layer.

**1. The app repainted itself forever.** `paint()` ends by announcing `farooqco:changed` to
`parent`, and the app answers its own announcement with `dbLoad()` + `paint()`. Inside the
launcher the announcement goes to the launcher frame and nothing comes back — but opening
`farooq-co-erp.html` directly makes the window its own parent, so it looped continuously.
The screen was being rebuilt underneath the user, which is why **Add Item appeared not to work**:
lines were added and then wiped, and typing lost focus. The echo is now recognised and ignored;
a genuine change from the warehouse app still reloads.

**2. The invoice search box threw on every keystroke.** It wrote to `ERP.InvoiceList.LIST.q`,
which does not exist — so every character raised an uncaught error and no filtering happened.
Searching now works; so do all the filters.

**3. Validation messages could vanish.** The "not enough stock" explanation was inserted into the
page and then lost on the next repaint. Problems are now held in state and rendered by the page,
so nothing can wipe them.

**4. The shortage warning only appeared after a repaint.** Typing a quantity above stock now
highlights the row immediately and shows *short by N* next to the warehouse.

**5. The Open buttons on the order and stock-document lists did nothing** — the handler sat behind
an early return.

**6. A closed invoice preview kept a whole invoice in the page**, which also polluted searching.
It is now emptied when closed.

---

## What the finished ERP does

**Multi-item everywhere** — sales invoices, sales orders, quotations, purchases (with partial
receiving), stock receiving, warehouse transfers, stock adjustments, dispatch, customer returns,
supplier returns and replacements. One parent, many normalised line items, one atomic write.

**One line editor** for all of them: **+ Add Item**, a searchable picker (name, Urdu name, brand,
category, SKU, bag size) showing `Available: 325 Bags` for the chosen warehouse, editable rows
with per-line warehouse, reorder, remove, and a sticky totals bar.

**Documents** — classic invoice (from `SInvoice.pdf`), payment receipt, payment voucher, purchase
invoice, credit note, supplier return note, sales order, quotation, transfer note, stock receipt,
adjustment note, dispatch note, customer and supplier statements. Each one prints, saves as PDF,
downloads as genuinely editable Word, and can go out by WhatsApp, SMS or email.

**Database** — IndexedDB, 24 stores, atomic multi-store transactions, database-backed number
sequences, idempotency register, audit log, backup and restore.

**Accounting** — one ledger derivation for customers and one for suppliers; a five-item invoice
posts one receivable entry and five product rows.

---

## Global search

One box finds anything from a letter or two, in Urdu or English, and forgives spelling.

* **Everything is indexed**: shops (name, owner, phone, region, address, code, and whether they owe
  money), products (name, Urdu name, brand, category, SKU, bag size, stock), suppliers — including
  *the products they have actually supplied* — invoices, orders, quotations, purchases, receipts,
  returns, transfers, stock documents, regions and warehouses.
* **Results are grouped** by module and ranked: a prefix beats a word start, which beats a match in
  the middle, which beats a forgiving match. No single group is allowed to flood the list.
* **Forgiving**: Urdu spelling variants (ی/ي, ک/ك, ہ/ه/ة, the alef forms), diacritics, joiners and
  Arabic-Indic digits are all folded to one form, and a slip of one or two letters still finds the
  row.
* **Keyboard-driven**: focus the box or press **Ctrl/Cmd + K**, results appear as you type with no
  Enter needed, ↑ ↓ move, Enter opens, Escape closes. Matched letters are highlighted.
* Opening a result does the right thing per type — a shop opens its profile, an invoice opens its
  document, a product opens the stock list filtered to it.
* On a phone the box becomes a full-screen search sheet reached from a button in the header.
* A search runs in a few milliseconds; the index rebuilds itself whenever records change.

## The editable invoice

Before anything is printed, saved as PDF or downloaded as Word, **Edit before printing** opens the
invoice in a form beside a live A4 preview.

* **Editable**: title, invoice number, dates, order number, warehouse, payment status, salesperson,
  the customer block, and every line — description, Urdu name, quantity, rate and discount, with the
  line and the totals recalculating as you type.
* **Add and remove**: extra lines (labour, delivery, anything), extra charges, and discounts
  (a minus figure), removing a line from the printed sheet without touching the sale.
* **Comments**: a free multi-line note that prints as Remarks, with *Save as default* and a history
  of previous comments to reuse.
* **The edited version is the document.** Print, PDF, Word and WhatsApp all read the edited sheet,
  and nothing regenerates over it — reopening the invoice weeks later still prints your wording.
* **The record is not touched.** Stock, the ledger and payments stay exactly as posted; editing
  changes the paper, not the accounts. *Undo all edits* returns to the invoice as recorded.
* **It is offered at the moment of exporting.** Pressing Print, PDF, Word or WhatsApp on an invoice
  asks once — *Edit before exporting* or *Export now* — with a *Do not ask again* box. The same
  choice is set permanently in Settings → Before printing an invoice: ask each time, always open the
  editor, or export straight away. The editor is also the lead button on the invoice sheet and an
  **Edit & export** action on every row of the invoice list.
* **It saves itself** as you type, survives the tab closing, and keeps up to fifteen earlier
  versions, each restorable.

---

## Reports and business analytics

A reporting room built on one universal period bar: **Today · Yesterday · This week · Last week ·
This month · Last month · This quarter · This year · Last year · All time**, plus a custom
date-to-date range, a month-to-month range, and a whole year. Every report reads the same period.

| Report | What it gives |
|---|---|
| Overview | Revenue, gross profit, bags sold, collections, a written summary, the daily trend, top products, regions and shops |
| Sales | Invoice list, product-wise, region-wise, warehouse-wise, customer-wise, averages and returns |
| Purchases | By supplier, product and warehouse, with payments made and the balance still payable |
| Inventory movement | Opening · received · sold · returned in · returned out · transfers · adjustments · written off · closing, per product per warehouse, replayed from the movement rows |
| Returns | Customer and supplier returns, line by line, with reason, condition and value |
| Payments & expenses | Receipts, supplier payments, refunds and expenses by category and method, with outstanding balances |
| Shop record | Profile, opening balance, orders, sales, paid, returns, closing balance, invoice history, product-wise and date-wise tables |
| Supplier record | Purchases, payments, returns, opening and closing payable |

**Expenses are now a real record**, not a gap in the reports: numbered `EXP-2026-000001`, with a
category, method, payee and date, written in the same atomic way as everything else.

**The written summary** at the top of each report is generated from the figures — how many sales,
what they were worth, the gross margin, the best seller, the strongest region, the largest account,
what was collected, what is still owed, and how the period compares with the one before it.

**Exports**: Print, PDF, Word and **Excel**. The Excel writer is the same hand-built ZIP the Word
files use, so a workbook opens in Excel, Office 365 and LibreOffice Calc with a sheet per section.
Every export carries the company branding, the period, who generated it and the timestamp.

Nothing is typed in or cached — every figure is added up from invoices, their line items, payments,
returns, stock movements and expenses, so any number can be traced back to the rows behind it.

---

## On a phone

Below 760 px the ERP becomes a mobile app rather than a shrunken desktop one.

* **Bottom navigation** — Home · Sales · **New** · Stock · More. New goes straight into an invoice;
  More opens the full menu. It hides itself behind the document preview and when printing.
* **Every table stacks into cards.** The line editor becomes one card per product with the
  quantity, rate and discount as full-width fields and the amount on its own row. The record lists
  do the same. The app's original fourteen screens are handled too: their column headings are
  copied onto each cell at render time, so they stack without any of those screens being rewritten.
* **The product list is a bottom sheet** with a dimmed backdrop, big rows and the search box pinned
  above it. It stays open while you add product after product, so a ten-line load is ten taps.
* **The action bar sits above the navigation**, showing the running total and a full-width
  *Save & Generate Invoice* button within thumb reach.
* **The invoice preview opens fitted to the screen** instead of at full A4 — no pinching — and
  re-fits when the phone is turned. Print, PDF, Word and WhatsApp scroll along one row.
* **Touch details**: 44–48 px controls, 16 px inputs so iOS does not zoom on focus, the numeric
  keypad for quantities and rates, safe-area padding for notched phones, and the focused field is
  scrolled clear of the on-screen keyboard.
* Turning the phone, or splitting the screen, switches layouts live.

---

## Tests

**512 checks, all passing**, run against the built page in a DOM with a working IndexedDB.

| Harness | Checks | Covers |
|---|---:|---|
| `test-erp.mjs` | 196 | all 14 acceptance tests of both briefs, validation, rollback, drafts, edits, cancellation, concurrency, persistence across a restart, reporting, and every document type previewing and exporting to Word |
| `test-ui.mjs` | 78 | the real screen: Add Item, search, five lines, edit, remove, reorder, live totals, shortage warning, save, preview, Word download, list actions, search and filters, all nine builder modes, transfer end to end, order → invoice, payment allocation, return panel, settings, and every page through the shell |
| `test-merge.mjs` | 21 | adopting the in-house build's records, its database snapshot, and the earlier normalised build |
| `test-search.mjs` | 42 | one-letter searches, partial names, owner, code, region, Urdu names, categories, bag sizes, products inside invoices, suppliers by product supplied, typo tolerance, ranking, the palette and its keyboard |
| `test-editor.mjs` | 47 | editing header, customer, lines, added lines, removed lines, charges and comments; the edits reaching the Word file, the HTML and the print sheet; the record staying untouched; autosave surviving a restart; revisions restoring |
| `test-reports.mjs` | 66 | every period including custom ranges, each report's figures against the raw records, the statement balancing, stock movement reconciling to stock on hand, the written summary, and the Excel, Word and print exports |
| `test-mobile.mjs` | 54 | the same app at 390 × 844: bottom navigation, the sheet picker, adding three products without leaving it, saving an invoice, the fitted preview, stacked cards on both the new and the original screens, all nine entry screens, and rotating the phone |

Word output was rendered through LibreOffice and inspected page by page for the invoice (10 and
25 lines, multi-page), the sales order and the transfer note.

---

## Remaining limitations

1. **No live-browser visual check** — browser automation was unavailable, so the mobile layout is
   verified by structure and behaviour, not by pixels. Open it on your phone, raise one invoice,
   and tell me anything that looks wrong.
2. **Serve the folder over `http://`.** Opening the files directly makes some browsers block
   storage; the app says so in the header and keeps working in memory, but take a backup.
3. **Roles are advisory** — enforced by hiding actions, not by a server, because there is no server.
4. **The warehouse PWA still uses the older shared record.** IDs stay aligned and receipts reach
   the office ERP, but PWA-side records do not get invoice numbers or ledger entries of their own.
5. **No stock reservation on orders** — the deduction happens at invoice confirmation, or at
   dispatch when the dispatch is standalone.
6. **Opening balances are still reference-only.** Carrying the legacy Total Sales / Collection /
   Balance figures in is a deliberate cutover and needs your instruction and a date.
7. **Cancelling a paid invoice** reverses stock and receivable but leaves the payment posted, for
   you to refund or convert to credit deliberately.
8. **SMS and WhatsApp are configured but not connected** — no provider account is wired in, so
   messages open the phone's own composer or `wa.me`.
