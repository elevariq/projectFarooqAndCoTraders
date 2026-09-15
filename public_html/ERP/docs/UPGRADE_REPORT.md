# Farooq & Co Traders ERP — Invoice, Receipt & Database Upgrade

**Version:** `2026-09-09-invoicing-v1`
**Built on:** the existing ERP, extended in place. No module was rebuilt and no business data was reset.

---

## What was found first

The project is not a Prisma/Node application. It is a single-file browser ERP:
`farooq-co-erp.html` (3,033 lines, 14 screens, a document service, a stock engine) plus a
warehouse PWA, a launcher that embeds both as base64 `srcdoc`, and `farooq-erp-data.js`
carrying the imported master data (136 products, 409 shops, 32 suppliers, 8 regions,
3 warehouses).

Two constraints followed from that, and they shaped every decision below:

* **There is no backend to extend.** So the "backend" the brief asks for was built as a real
  database and service layer *inside the app*: IndexedDB with normalised stores, atomic
  multi-store transactions, database-backed sequences and a service layer that the UI cannot
  bypass. Totals are recalculated in that layer on save and the screen's numbers are discarded.
* **Nothing existing could be thrown away.** The upgrade is appended as separate `<script>`
  blocks that load after the app boots and then patch it. All 14 original screens still work,
  reading the same arrays — which are now a projection of the database rather than the source
  of truth.

---

## Database

**Engine.** IndexedDB (`farooqco_erp`, v1), with an automatic fallback chain:
IndexedDB → localStorage → memory. The live driver is shown in the ERP header and in
Settings, so staff can see whether their work is being saved.

**Stores created** (24, each with a primary key and the indexes §24 asked for):

`meta` · `sequences` · `business` · `warehouses` · `regions` · `products` · `customers` ·
`suppliers` · `inventory` · `stockMovements` · `invoices` · `invoiceItems` · `purchases` ·
`purchaseItems` · `payments` · `paymentAllocations` · `customerReturns` ·
`customerReturnItems` · `supplierReturns` · `supplierReturnItems` · `documents` ·
`auditLog` · `syncQueue` · `legacy`

Unique indexes on `invoiceNumber`, `purchaseNumber`, `receiptNumber`, `returnNumber`;
lookup indexes on `customerId`, `supplierId`, `productId`, `warehouseId`, `invoiceDate`,
`createdAt`, `status`, `regionId`.

**Line items are normalised.** `InvoiceItem` and `PurchaseItem` are their own rows with a
foreign key to their parent — not a JSON string on the invoice.

**Transactions.** `FDB.tx([stores], fn)` opens one read-write transaction across every store a
job touches. Saving a sale creates the invoice, its items, the stock deduction, the movement
rows, the payment, the allocation, the ledger effect and the audit entry inside that single
transaction. Anything thrown rolls the whole thing back — a rejected invoice leaves no stock
change and no orphan line. The memory/localStorage drivers get the same guarantee by working
on a snapshot and publishing only on success.

**Numbering.** Counters live in the `sequences` store and are read-and-incremented *inside the
caller's own transaction*, so two invoices saved in the same second cannot collide. Numbers are
never recycled: a cancelled invoice keeps its number.

```
INV-2026-000001   SO-2026-000001   PUR-2026-000001
REC-2026-000001   CR-2026-000001   SR-2026-000001   DSP-2026-000001
```

**Migration (run once, non-destructive).** On first boot the old `farooqco_erp_v1`
localStorage record is read and converted: master data into its own stores, the stock map into
`inventory` plus an `OPENING` movement per line, every legacy single-product sale into a real
invoice with one line, legacy purchases into multi-line purchases, `CUSTPAY`/`SUPPAY` into
`Payment` records with allocations, and issued documents into `documents`. Orders, dispatch,
activity, users, rules and device records are carried across verbatim in the `legacy` store.
The old localStorage key is left exactly where it was and is still written, so the warehouse
PWA bridge keeps working.

**Money.** Every calculation runs in integer paisa (`Money.toP/mul/sum`). Rupees exist only at
the edges. `0.1 + 0.2` problems cannot reach a customer balance.

**Backup / restore.** Settings → **Backup Database** exports every store as JSON;
**Export Business Data** produces CSV packs (invoices, invoice lines, customer balances);
**Restore** requires confirmation and downloads a backup of the current state first.

---

## Invoice

**Multiple items — the core change.** The old one-product sale panel is gone. Its buttons now
open a full invoice builder:

Region → Shop → Warehouse → searchable product picker → line rows → charges → sticky totals →
**Save Draft** or **Save & Generate Invoice**.

Each line carries product, SKU/folio, brand, category, package, quantity, unit, rate, discount,
tax, line total, per-line warehouse, batch and notes. Lines can be added, edited, reordered and
removed. The picker searches product name, Urdu name, brand, category, SKU and bag size, and
shows live stock for the selected warehouse (`Available: 325 Bags`). Overselling is blocked
unless Settings explicitly permits negative stock.

**Totals** are computed on both sides and only the service-layer figure is stored: subtotal,
item discounts, invoice discount, tax, freight, loading/unloading, other charges, previous
balance, grand total, paid, remaining. Currency is `PKR` throughout.

**Statuses**: `DRAFT · CONFIRMED · DISPATCHED · PARTIALLY_PAID · PAID · CANCELLED ·
RETURNED · PARTIALLY_RETURNED`. Drafts take no number and move no stock. Confirmed invoices can
be edited (stock and balance adjust by the difference; who, when, old value, new value and
reason go to the audit log) and cancelled (stock returned, balance reversed, record kept).
**Duplicate Invoice** creates a new draft with the items copied and no payments.

**Word (`.docx`) — real, editable.** A ZIP writer and a WordprocessingML builder were written
from scratch, so no server and no network are involved. Output is genuine Word content —
editable text, editable table cells, editable totals — never an image. A4 page, logo and company
block, large `INVOICE` title, two-column Bill To / Invoice Details, an item table whose header
row repeats on every page (`w:tblHeader`), a totals block kept together (`cantSplit`), customer
account block, signature lines, and `Page X of Y` in the footer. Verified by rendering a 28-line
invoice through LibreOffice: correct across page breaks, no overlap, no cropping, Urdu product
names shaped correctly with right-to-left runs.

**PDF and print.** A dedicated A4 print stylesheet hides the sidebar, toolbar, modal chrome and
buttons; table headers repeat; totals, ledger and signatures never split. **Download PDF** routes
through the browser's own print engine ("Save as PDF"), which is the only client-side path that
shapes Urdu correctly and produces a vector PDF rather than a bitmap.

**Preview toolbar:** Print · Download PDF · Download Word · WhatsApp · Send SMS · Edit ·
Duplicate · Payment · Return · Cancel · Close, plus zoom.

**Other documents on the same engine:** Payment Receipt, Payment Voucher, Purchase Invoice,
Credit Note / Customer Return, Supplier Return Note, Customer and Supplier Statements — each with
Print, PDF and Word.

**Invoice list** (replaces the old Sales screen — no duplicate module): search by invoice number,
customer, shop, phone, region, product, order number, warehouse, status or amount; filters for
today / yesterday / week / month / last month / year, status, region and warehouse; columns
Invoice # · Date · Customer · Region · Items · Warehouse · Total · Paid · Balance · Status ·
Actions; CSV export.

---

## Inventory

* Sale confirmed → `SALE_OUT`, deducted from the chosen warehouse per line.
* Purchase received → `PURCHASE_IN`, added per line, and the moving-average cost is updated.
* Customer return → `CUSTOMER_RETURN_IN` (sellable) or `DAMAGED_RETURN_IN` (held in a separate
  damaged bucket, not sellable) or `STOCK_WRITE_OFF`.
* Supplier return → `SUPPLIER_RETURN_OUT`, from sellable or damaged stock.
* Dispatch and transfers from the original screens now also write persisted movements.
* Stock corrections require a reason and post an `ADJUSTMENT` movement — the number is never
  silently overwritten.

Every movement records product, warehouse, delta, resulting balance, reference, type, note, unit
cost and user.

---

## Accounting

One ledger derivation, used by every screen — there is no second balance that can drift.

* **Customer**: opening balance → invoices (debit) → payments received (credit) → credit
  notes/returns (credit) → running balance.
* **Supplier**: purchases (credit) → payments made (debit) → supplier returns (debit) →
  outstanding payable.
* Payments allocate across outstanding invoices, oldest first, or to invoices the user picks, or
  sit on account. Each allocation updates that invoice's paid amount and status.
* Payments can be reversed (allocations removed, invoice statuses recomputed, audit entry
  written) rather than deleted.
* Profit uses the cost recorded on the line at the time of sale, never today's cost.

Reports fed automatically: sales, product sales, region sales, warehouse, customer, receivables,
gross profit and margin, returns, collections, and the daily/monthly/yearly ranges.

---

## Files changed

| File | Change |
|---|---|
| `farooq-co-erp.html` | Seven upgrade scripts appended before `</body>`. Original scripts untouched. 545 KB → 807 KB. |
| `index.html` | Rebuilt so the launcher's embedded Office app is the upgraded ERP. PWA blob unchanged. |
| `farooq-co-warehouse-pwa.html`, `farooq-and-co-homepage.html`, `farooq-erp-data.js` | Carried through unchanged. |
| `erp-upgrade/00-bridge.js` | Exposes the app's top-level `let`/`const` state to the modules by reference. |
| `erp-upgrade/01-db.js` | IndexedDB layer, atomic transactions, sequences, money, backup/restore. |
| `erp-upgrade/02-services.js` | Invoices, purchases, payments, returns, inventory, ledgers, reports, migration, audit. |
| `erp-upgrade/03-docx.js` | ZIP + WordprocessingML writer. |
| `erp-upgrade/04-documents.js` | Document models, A4 preview, print/PDF, WhatsApp/SMS text. |
| `erp-upgrade/05-ui-builder.js` | Invoice builder and invoice list. |
| `erp-upgrade/06-wiring.js` | Panels, business profile, backup UI, styles, event wiring, patches, boot. |
| `erp-upgrade/build.py`, `erp-upgrade/test-erp.mjs` | Repeatable build and the test harness. |

4,891 lines of upgrade code.

---

## Tests

`erp-upgrade/test-erp.mjs` loads the built page in a DOM with a working IndexedDB and drives the
app through its own public surface. **109 checks, 109 passing.**

| Brief | Covered |
|---|---|
| Test 1 — one item | Number format, totals, stock deduction, movement, ledger debit, Word file, line stored in paisa and reconciling to the subtotal |
| Test 2 — five items | All lines stored, subtotal, item + invoice discounts, charges, grand total, stock deducted on every line, payment allocated, partial status, printed line amounts correct |
| Test 3 — long invoice | 28 lines saved, Word generated, header repeated, every line in the preview |
| Test 4 — partial payment | 200,000 − 75,000 = 125,000, receipt numbered, ledger rows, status, receipt document |
| Test 5 — returns | Sell 100 / return 10 to sellable stock, credit posted, invoice kept and marked partly returned, damaged route kept out of sellable stock, over-returning rejected, supplier return clearing damaged stock |
| Test 6 — purchase | Six products, stock up on every line, `PURCHASE_IN` movements, freight in the total, payable = purchase − payment |
| Test 7 — persistence | Window destroyed and reopened on the same database: invoices, lines, payments, movements, inventory, receivables, payable and audit all identical; 136 products and 409 shops with no duplication; numbering continues |
| Test 8 — concurrency | Eight invoices saved simultaneously → eight distinct, well-formed numbers; no number reused anywhere |
| Validation | Missing customer, no items, zero quantity, overselling, overpayment — all rejected, and a rejected invoice changes no stock |
| Money | Exact at 0.1 + 0.2; fractional rates round correctly |
| Drafts / edit / duplicate / cancel | Draft takes no number and no stock; confirm issues both; edit keeps the number and adjusts stock by the difference with an audit reason; duplicate carries no payments; cancel reverses and keeps the record |
| Reporting | Live counts, cost-snapshot profit, product and region reports, receivables matching the ledger, legacy screens mirrored, stock map in step |
| UI | All 15 original screens plus the builder render against real data without throwing |
| Backup | Every store exported and JSON round-trips |

Two real defects were found by these tests and fixed: a transaction that updated invoice lines
without declaring that store in its scope, and invoice **line items** being converted to paisa a
second time — header totals were right while printed line amounts were 100× too large.

Word output was additionally rendered through LibreOffice and inspected page by page, using both
synthetic data and a real 28-line invoice from the app's own catalogue.

---

## Build

* Build is scripted and repeatable (`build.py`); re-running replaces the previous injection rather
  than stacking it.
* Whole-page parse and execution verified in the test harness (any syntax error would stop the
  boot); no console errors during boot, migration or any workflow.
* No TypeScript, bundler, linter or Prisma in this project, so those steps do not apply. There is
  no `schema.prisma` to migrate — the equivalent work is the IndexedDB schema and the one-time
  migration described above.

---

## Remaining limitations — please read

1. **No live-browser visual check.** Browser automation was not available in this session. The
   logic, all 15 screens and the Word output were verified; the on-screen builder and preview
   were not photographed in a real browser. Open `index.html`, raise one invoice, and confirm it
   looks right before going live.
2. **Roles are still advisory.** Permissions are enforced by hiding actions, not by a server —
   there is no server. On a shared device any user can reach any screen. Real enforcement needs a
   backend, which is a separate piece of work.
3. **`file://` storage.** Opening the HTML directly from a folder makes some browsers block
   IndexedDB and localStorage. The app detects this, says so in the header, and keeps working in
   memory — but work is lost on close unless a backup is exported. Serving the folder over
   `http://` (or using the launcher on a real domain) avoids this entirely. This is the single
   most important thing to get right for daily use.
4. **The warehouse PWA still uses the older shared record.** It reads and writes
   `farooqco_erp_v1`, which the ERP keeps updating, so IDs stay aligned. It has not been moved
   onto the new database; warehouse receipts reach the office ERP as before, but PWA-side records
   do not get invoice numbers or ledger entries of their own.
5. **Sync is scaffolding.** Offline invoices get a stable `clientOpId` and a `syncQueue` entry so
   a future server can replay them idempotently, and the WhatsApp/SMS layer is modular with no
   credentials in code — but there is no provider connected and no cloud endpoint. WhatsApp opens
   `wa.me` with the message; SMS opens the phone's composer.
6. **Opening balances were not carried in.** The legacy `Total Sales / Collection / BALANCE`
   figures on shops and suppliers (for example the 95.9 m on Upper Chitral) are still held as
   reference only, exactly as the data import left them. Balances shown by the ERP derive from
   ERP transactions alone. Carrying those opening balances in is a deliberate cutover decision
   and needs your instruction — the ledger already supports an `openingBalanceP` field for it.
7. **Catalogue prices are still not prices.** The `Size !` column stays `catalogListedValue` with
   `priceConfirmed:false`. The builder suggests the last rate actually charged, never the
   catalogue figure, and a rate must be entered on every line. The 5 blank rows, 11 zero-value
   rows and the flagged duplicates from the import report are untouched and still need your
   decisions.
8. **The shared localStorage record is now ~350 KB** (master data plus the mirrored sales list).
   It is well inside the limit today, but if the sales history grows very large that bridge —
   not the main database — is what would run out of room first.
