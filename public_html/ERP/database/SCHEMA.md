# Farooq & Co Traders ERP — Database

The ERP keeps its records in **IndexedDB**, in a database called `farooqco_erp_ledger`
(schema version 5). It is a real relational design: parents and their line items are separate
stores joined by keys, every write goes through one atomic transaction, and numbers are issued by
database-backed sequences.

> The earlier in-house build used a database called `farooqco_erp` that held one JSON snapshot.
> This build deliberately uses a different name and **reads that old database once** to bring its
> records across. The old one is never written to or deleted.

---

## Stores

### Master data

| Store | Key | Holds |
|---|---|---|
| `business` | `id` (always `business`) | The company profile printed on every document |
| `warehouses` | `id` | College, Main, KO |
| `regions` | `id` | The eight regions |
| `products` | `id` (`PRD-0001`…) | 136 catalogue rows, Urdu and English names, brand, category, bag size, source folio |
| `customers` | `id` (`CUS-0001`…) | 409 shops with owner, phone, region, route, legacy code |
| `suppliers` | `id` (`SUP-0001`…) | 32 mills and accounts |

### Transactions — parents and their lines

| Parent | Children | Numbering |
|---|---|---|
| `invoices` | `invoiceItems` (`invoiceId`) | `INV-2026-000001` |
| `purchases` | `purchaseItems` (`purchaseId`) | `PUR-2026-000001` |
| `orders` (also quotations) | `orderItems` (`orderId`) | `SO-` / `QT-2026-000001` |
| `customerReturns` | `customerReturnItems` (`returnId`) | `CR-2026-000001` |
| `supplierReturns` | `supplierReturnItems` (`returnId`) | `SR-2026-000001` |
| `stockDocs` (transfer, receipt, adjustment, dispatch) | `stockDocItems` (`docId`) | `TRF-` `RCV-` `ADJ-` `DSP-` |
| `payments` | `paymentAllocations` (`paymentId`) | `REC-` (in) · `PV-` (out) |
| `expenses` | — | `EXP-2026-000001` |
| `accountAdjustments` | — | `ACC-2026-000001` |

### Stock

| Store | Key | Holds |
|---|---|---|
| `inventory` | `productId|warehouseId` | `qty`, `damagedQty`, `avgCostP` (moving average cost) |
| `stockMovements` | `id` | One row for every change, with kind, delta, resulting balance, reference and user |

Movement kinds: `OPENING_STOCK · PURCHASE_IN · SALE_OUT · CUSTOMER_RETURN_IN ·
CUSTOMER_RETURN_DAMAGED_IN · SUPPLIER_RETURN_OUT · TRANSFER_IN · TRANSFER_OUT · ADJUSTMENT_IN ·
ADJUSTMENT_OUT · SALE_REVERSAL_IN · PURCHASE_REVERSAL_OUT · REPLACEMENT_OUT ·
SUPPLIER_REPLACEMENT_IN · STOCK_WRITE_OFF · DISPATCH_OUT`

### Supporting

| Store | Key | Holds |
|---|---|---|
| `sequences` | `k` (`INV:2026`) | The counters that issue document numbers |
| `operations` | `opId` | The idempotency register — a repeated submission is refused here |
| `documentEdits` | `id` (`INVOICE:<id>`) | Manual edits made before printing, plus their revision history |
| `documents` | `no` | Documents already issued, with their snapshots |
| `auditLog` | `id` | Who did what, when, with old and new values |
| `syncQueue` | `opId` | Offline operations waiting for a server |
| `salesmen` | `id` | The people who walk the areas, and which areas each covers |
| `supplierProducts` | `id` | Which mill supplies which product — many-to-many, with a preferred flag |
| `costHistory` | `id` | Every change to a product's cost, with the purchase and user behind it |
| `accountAdjustments` | `id` | Manual corrections to a shop's account, each with a reason |
| `legacy` | `k` | Records carried across from the previous build |
| `meta` | `k` | Migration stamps and the app version |

---

## Relationships

```
Customer ──< Invoice ──< InvoiceItem
    │           │
    │           ├──< PaymentAllocation >── Payment
    │           └──< CustomerReturn ──< CustomerReturnItem
    └──< Order ──< OrderItem            (an order becomes one invoice)

Supplier ──< Purchase ──< PurchaseItem
    │            └──< SupplierReturn ──< SupplierReturnItem
    └──< Payment (direction OUT)

Warehouse ──< Inventory >── Product
Warehouse ──< StockMovement >── Product
StockDoc ──< StockDocItem              (transfers, receipts, adjustments, dispatch)
```

A five-item invoice is **one** row in `invoices` and five in `invoiceItems`. The customer ledger
therefore receives one entry, while product and profit reports walk the five lines.

---

## Rules the database enforces

* **Atomic.** A sale writes the invoice, its items, the stock deduction, the movements, the
  payment, the allocation and the audit entry inside a single IndexedDB transaction. If any line is
  short of stock, nothing at all is written.
* **Money as integers.** Every amount is stored in **paisa** as a whole number. Divide by 100 for
  rupees. Floating-point rounding cannot reach a balance.
* **Numbers are never reused.** Counters live in `sequences` and are incremented inside the caller's
  own transaction, so two invoices saved in the same second cannot collide. A cancelled invoice
  keeps its number.
* **Nothing is deleted.** Cancellations and reversals write new rows; the original stays.
* **Balances are derived.** There is no stored balance field to drift. Customer balance =
  opening + invoices − payments − credit notes. Supplier balance = opening + purchases − payments −
  returns.
* **Snapshots.** Invoice lines keep the product name, brand, package and cost as they were on the
  day, so an old invoice stays truthful after a rename or a price change.

---

## Backup, restore and export

* **Settings → Backup Database** writes every store to a JSON file in this format:
  `{ format: "farooq-co-erp-backup", formatVersion: 1, data: { <store>: [ …rows ] } }`
* **Settings → Restore** takes that file back, after downloading a backup of the current state first.
* `database/fresh-install-backup.json` in this package is exactly that format — a clean install with
  the master data and no transactions. Restoring it on a new device gives you the 136 products, 409
  shops, 32 suppliers, 8 regions and 3 warehouses with nothing else.
* **Settings → Export Business Data** writes CSVs of invoices, invoice lines and customer balances.
* Reports export to Excel, Word and PDF from the reports screen.

---

## Moving to a server later

`schema.sql` and `schema.prisma` in this folder describe the same design for PostgreSQL or Prisma,
so the client store can be lifted onto a backend without redesigning anything. The client already
writes an idempotency key (`clientOpId`) and a `syncQueue` entry for every parent transaction, which
is what a server needs to replay offline work without duplicating it.
