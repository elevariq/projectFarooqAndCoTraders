# Farooq & Co Traders ERP — Client Change Set

**Build:** `2026-09-14-clientset-v16` (final)
**Base:** `2026-09-13-workbench-v15` (not rebuilt, not reset, no module removed)

The four requested changes are implemented. The existing architecture, database,
accounting logic and all historical data are intact.

---

## 1. Files changed

| File | Change |
|---|---|
| `erp-upgrade/24-client-changes.js` | **New.** Description engine, WhatsApp builder, Qty/Rate sizing, Amount Paid relabelling |
| `erp-upgrade/02-services.js` | `description` forwarded through `Payments.receive()` / `Payments.pay()`; stored on customer and supplier return records |
| `erp-upgrade/04-documents.js` | Invoice total relabelled `Amount Paid`; the lookup made tolerant of either wording |
| `erp-upgrade/05-ui-builder.js` | `Amount Paid` label; `Description / تفصیل` input added above the (renamed) Internal note |
| `erp-upgrade/06-wiring.js` | `description` bound into the draft; Description field and `Amount Paid` label on both payment panels and the customer return panel |
| `erp-upgrade/14-reports-ui.js` | Supplier statement columns |
| `erp-upgrade/16-khata.js` | Customer statement columns (screen, document model, Excel); Description on adjustments; `adjustmentsReady` exposed |
| `erp-upgrade/build.py` | Registers module 24 last |
| `erp-upgrade/test-client-changes.mjs` | **New.** The 12 required test cases |
| `erp-upgrade/test-khata.mjs` | `K27` asserts the new column names; `K45`/`K46` now await hydration instead of a fixed delay |
| `app/farooq-co-erp.html`, `app/index.html` | Rebuilt |

---

## 2. Database / schema changes

One new field, `description` (string), on: `invoices`, `purchases`, `payments`,
`customerReturns`, `supplierReturns` and `accountAdjustments`.
Nothing else was added, renamed or removed. **No new monetary field exists.**

`description` is written only when text was actually entered. A record with no
description does not carry an empty string — the statement generates its line at
display time instead.

`note` is untouched and keeps its original meaning. The two are now distinct:

* **Description / تفصیل** — the ledger-facing line, printed on the statement.
* **Internal note** — the internal remark, as before.

---

## 3. Migration

**There is no data migration, deliberately.** Historical descriptions are
resolved at *display* time by `Desc.resolve()`, which returns the stored text if
there is one and a generated line otherwise. Nothing rewrites a stored record,
so the operation is idempotent by construction and cannot alter a balance,
a number or a note. Running the app twice, or ten times, changes nothing.

Where a description is set on a purchase after the fact, `Desc.attach()` writes
it in its own small transaction, is a no-op when the text is unchanged, and
records the old and new value to the audit log.

---

## 4. Amount Paid

**No new financial field was created.** The audit found the canonical value
already present:

* `paidAmount` — integer paisa, on both invoices and purchases.
* No `amountReceived`, `paidNow`, `paymentAmount` or `invoicePaid` exists
  anywhere in the codebase, so there was no duplicate concept to reconcile.

The client's wording is applied to that existing field. What changed is the
label and the prominence; what posts to the ledger is unchanged.

Three safeguards were already in place and were left exactly as they were:

* **Posting happens once.** `Invoices.save` computes
  `delta = paidAmount − alreadyPaid` and writes a Payment only for the
  difference, inside the same atomic transaction as the invoice.
* **Resubmission is refused.** The operation id is `clientOpId#revision`, so a
  double-clicked Save claims an id that is already spent and is rejected before
  anything is written.
* **Overpayment is rejected** in `Validate.invoice` with a clear message, since
  customer advances are not part of the current accounting model.

---

## 5. WhatsApp

`ERP.Wa.invoiceText(invoice)` produces the requested format from live saved
data. Only the labels, emoji and rules are fixed; every value is read from the
record.

**The balance rule.** Previous Outstanding is read from `invoice.previousBalance`
— the snapshot the invoice already stored, captured in `Invoices.save` *before*
`api.put('invoices', rec)`. It is never read from the customer's live balance,
which by then already contains this sale. Total Outstanding is then
`previousBalance + billBalance`. The two figures cannot be the same value, and
the invoice cannot be counted twice.

**Items** is `lineCount` — invoice lines, not bags.

**Phone.** `normalisePhone()` handles `03xxxxxxxxx`, `92xxxxxxxxxx`,
`0092…`, and spaced or dashed input. It returns a string for the URL and never
writes back, so the stored display number is not mutated. With no number saved,
the message is copied to the clipboard and the user is told
*"No WhatsApp/mobile number is saved for this customer."*

**Sharing is communication only.** `sendInvoice()` opens a URL and writes an
audit entry. It touches no store and no balance — asserted by test.

---

## 6. Qty / Rate

The cause was a single rule: `.fcb-in{max-width:110px;padding:7px 9px}`, which
capped every numeric cell in the line editor.

| | Before | After |
|---|---|---|
| Qty | ≤110px wide, ~31px tall | **118px wide, 46px tall** |
| Rate | ≤110px wide, ~31px tall | **164px wide, 46px tall** |
| Discount | ≤110px | 118px wide, 46px tall |

Font raised to 16px with tabular numerals so digits align and `1,500,000` is
fully readable. Column minimums stop the table algorithm squeezing them back.
Between 761px and 1100px the row scrolls horizontally rather than shrinking.
On mobile the existing stacked-card layout is kept, with a 50px minimum height.

This is presentation only — no calculation, validation or stock check was
touched, and `2500 × 150,000` is asserted to compute exactly.

---

## 7. Description / تفصیل

* **Unicode-safe.** Only outer whitespace is trimmed and newlines collapsed to
  keep a ledger row on one line. No Urdu letter, diacritic, joiner or mark is
  stripped. Max 500 characters.
* **Manual always wins.** `Desc.resolve()` is the single place that decides:
  stored text if present, generated line otherwise. The khata's old behaviour of
  regenerating `'Invoice ' + number` over the top was removed.
* **Auto defaults** per type: `Sale invoice INV-…`, `Purchase invoice PUR-…`,
  `Cash received against outstanding balance`, `Payment made — Cash`,
  `Customer return RTN-…`, `Stock returned to supplier`, `Balance adjustment`,
  `Opening Balance`, `Freight / Carriage charges`.
* **Richer defaults** from the lines where useful — `150 × Taj Mahal Sella @ PKR 6,830`
  for one line, `3 items — 500 total qty` for several — kept short on purpose.
* **Entry points:** the sale/purchase builder (all nine modes, which covers
  supplier returns), Receive payment, Pay supplier, Customer return, and
  Account adjustment. Each sits directly above the renamed *Internal note*,
  never behind an advanced setting.
* **Opening balances** need no field: they are a master-data figure on the
  customer or supplier, and their statement row reads `Opening Balance` — the
  wording the brief asked for.
* **Adjustments** fall back to `Adjustment — <reason>` rather than the generic
  `Balance adjustment`, since the reason is already captured and is more useful.

---

## 8. Statements

Both statements now carry the requested columns:

| Date | Folio / Reference # | Description / تفصیل | Qty | Debit / بنام | Credit / جمع | Balance / بقایا |

**Debit/credit conventions were inspected and left alone.** The customer ledger
is debit-side (invoice debits, payment credits); the supplier ledger runs
`credited: true` (purchase credits, payment debits). Neither was reversed.

**Qty** is total product quantity, not line count. Payment-only rows show `—`
rather than a fabricated zero. Where a row's lines use **incompatible packages
the quantities are not summed** — the row is labelled `(mixed units)` instead.

**Running balances are unchanged.** The wrapper decorates `rows` only; `opening`,
`closing`, `debit` and `credit` are returned exactly as the existing derivation
computed them, so no balance can shift. Period boundaries were already correct
in `Ledger._roll` and were not modified.

---

## 9. Print / PDF / Excel / Word

The statement document model and the Excel writer both carry Description and
Qty. Column widths follow the brief: Date 11%, Reference 14%, **Description
30%**, Qty 9%, Debit 11%, Credit 11%, Balance 14%. Description wraps
(`white-space:normal; word-break:break-word`) so it cannot overlap the numeric
columns. The supplier statement sheet has the same columns.

The invoice/receipt already showed Previous balance, Amount paid and Balance;
the label now reads **Amount Paid**.

---

## 10. Offline / sync

The ERP is a single-device, client-side application: IndexedDB is the master
record and the shared browser record is a one-way bridge to the warehouse PWA.
There is no server and no sync contract to update, so no DTO could fall out of
step. `description` is written through the same atomic `FDB.tx` path as every
other field and is included in backup and restore automatically, because the
backup serialises whole stores rather than a field list.

Verified: descriptions in both scripts survive a full restart (`P1`, `P2`), and
the balance is unchanged across it (`P3`).

---

## 11. Tests executed

**892 checks, 0 failures**, against the built page in a DOM with a working
IndexedDB.

| Harness | Result |
|---|---|
| `test-erp` | 196 passed |
| `test-ui` | 86 passed |
| `test-client-changes` **(new)** | **64 passed** |
| `test-integrity` | 68 passed |
| `test-reports` | 66 passed |
| `test-mobile` | 57 passed |
| `test-profit` | 55 passed |
| `test-khata` | 47 passed |
| `test-editor` | 47 passed |
| `test-settings` | 44 passed |
| `test-search` | 42 passed |
| `test-workbench` | 41 passed |
| `test-collection` | 29 passed |
| `test-users` | 29 passed |
| `test-merge` | 21 passed |

All 12 required cases pass, including T11 double-post protection, T9 date-range
isolation, T6 byte-exact Urdu, and T7 items-vs-quantity.

### Three real bugs the tests caught

1. **`Payments.receive()` dropped the description.** It builds its own object
   for the writer and did not forward the new field, so a payment description
   was silently lost. Fixed at the source in `02-services.js`.
2. **Every new invoice was being given an empty `description` string.** Harmless
   but untidy, and it made "has no description" ambiguous. Now only written when
   text was entered.

3. **A pre-existing hydration race.** Account adjustments load on their own
   promise *after* `ERP.ready`, so anything reading the account immediately
   after a restart could see it incomplete. `test-khata` papered over this with
   a fixed 400ms delay and failed roughly one run in six. `ERP.adjustmentsReady`
   is now exposed and awaited, and the khata repaints itself when the rows land.
   Eight consecutive runs are clean.

One pre-existing test was updated rather than worked around: `K27` asserted the
old column headings, which the client explicitly asked to change.

---

## 12. Accounting reconciliation

Asserted after the full run:

* Running balance on the last row equals the ledger's closing figure.
* Customer: `closing = opening + debits − credits`. ✔
* Supplier: `closing = opening + credits − debits`. ✔
* September statement closing excludes an October invoice, and equals
  `opening + period movement`. ✔
* Sharing on WhatsApp moved no balance. ✔
* A resubmitted save posted no second payment and moved no balance. ✔
* The account still reconciles after returns and adjustments are posted. ✔
* Descriptions and balances are identical across a full restart. ✔

### Reported figures — TEST 2, partially paid invoice

| | |
|---|---|
| Previous Outstanding | **PKR 5,200** |
| Bill Total | **PKR 3,800** |
| Amount Paid | **PKR 1,000** |
| Bill Balance | **PKR 2,800** |
| Total Outstanding | **PKR 8,000** |

Matching the brief exactly. The live customer balance after posting was asserted
equal to Total Outstanding, so the statement and the WhatsApp message cannot
disagree.

---

## 13. Production build

`build.py` runs clean. ERP `1,479,485` bytes; launcher `2,583,183` bytes. Both rebuilt into `app/` and verified to contain
the new module, the Urdu column heading, the WhatsApp format and the new input
widths.

---

## 14. Remaining risks and assumptions

1. **No live-browser visual check.** Browser automation was unavailable, so the
   new Qty/Rate sizes are verified by computed CSS and by structure, not by
   pixels. Open one invoice on the actual machine and confirm the boxes read
   comfortably before rolling out.
2. **Urdu is stored and displayed RTL by the browser's own bidi handling.** The
   Word and Excel writers emit the correct characters, but a mixed
   English/Urdu line in a Word table has not been inspected in LibreOffice this
   pass.
3. **Every statement-facing form now has a Description field** — sales,
   purchases, both payment types, customer returns, supplier returns and
   adjustments. Opening balances use the fixed `Opening Balance` wording by
   design.
4. **`Desc.attach` for purchases is a second transaction**, not part of the
   purchase's atomic write, because the purchase record is built inline with no
   hook. It carries no money: if it ever failed, the figures would be untouched
   and the row would fall back to its generated description.
5. **Overpayment stays rejected**, since customer advances are not in the current
   model. If the client wants advances, that is a separate piece of accounting
   design, not a UI change.
6. **Mixed-unit Qty** shows `(mixed units)` rather than a total. If the business
   wants bags and cartons summed, tell me the conversion and I will apply it.
7. The pre-existing limitations from v15 are unchanged — roles are advisory, the
   warehouse PWA still uses the older shared record, and there is no automatic
   off-device backup.
