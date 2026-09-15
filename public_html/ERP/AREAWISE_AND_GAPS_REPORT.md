# Farooq & Co Traders ERP — Change Set Completed · Area-wise Collection Report

**Build:** `2026-09-15-areawise-v19`
**Base:** `2026-09-14-landed-v18`

---

## 1. A correction: three items were still open

My v16 report said the supplier statement carried Description / تفصیل. **That was
wrong**, and I found it by auditing rather than trusting the earlier note.

There are **two** statement builders in this ERP. Module 16 owns the customer
statement; module 4 owns the supplier one. I had updated the customer builder and
the supplier *Excel sheet*, and reported the job done. The supplier **PDF, print
and Word** output still had the old columns.

Three genuine gaps, now closed:

### 1.1 Supplier statement columns

The supplier statement printed `DATE · Particulars · Reference · Debit · Credit ·
Balance` — no Description heading in Urdu, and no Qty at all. It now matches the
customer statement and the brief:

| Date | Folio / Reference # | Description / تفصیل | Qty | Debit / بنام | Credit / جمع | Balance / بقایا |

Widths follow the brief: Description 30%, Date 11%, Reference 14%, Qty 9%,
Debit 11%, Credit 11%, Balance 14%.

### 1.2 "Customer code" on a supplier statement

The brief says this explicitly, and the statement header was getting it wrong —
both in the HTML/PDF and in the Word export, because they build the header
separately. A supplier statement now reads **Supplier code**; a customer statement
still reads Customer code. Both are asserted.

### 1.3 Descriptions were not searchable

The brief asks that searching `5623`, `کرایہ`, `ارشد`, `Cash` or `Freight` finds
the entry. The new `description` field was never added to the search index, so it
found nothing. Invoices, purchases and payments now index both the ledger
description and the internal note. Searching `5623`, `Freight` and `ارشد` all
return the right records.

### 1.4 Not applicable

**Amount in words** — the brief says *"if the current statement includes Amount in
Words, keep it functional."* The statement model already has a `words` field and
it still works; nothing was broken by the column changes.

---

## 2. Area-wise collection report

Built from the sheet supplied, and matching its shape: shops grouped by area, with
Code, Name (English and Urdu), Contact #, Total Sales, Total Collection and
Balance / بقایا, a subtotal per area, a grand **TOTAL VALUE** line, and a space
for the accountant to sign.

### 2.1 Where the figures come from

**The balance is the ledger's own closing figure, not `sales − collection`.** The
brief is firm that balances must not be faked client-side, and a shop's balance
here has to match its own statement or the sheet is worse than useless. Returns,
adjustments and opening balances all flow through, which a simple subtraction
would miss.

### 2.2 The opening-balance problem

The supplied sheet runs from 01/01/2025, so every shop opens at zero and
`Sales − Collection = Balance` exactly. Over a **narrower** period that is no
longer true — a shop carries a balance into the period.

Rather than print three columns that visibly don't add up, the report **adds an
Opening column automatically** when any shop has a balance brought forward, and
leaves it out when none does. Over the full history the sheet looks exactly like
the original; over a single month the arithmetic still holds. Asserted by test:
`balance = opening + sales − collection`.

### 2.3 Other decisions

- **Idle shops are left off by default.** A shop with no movement and nothing
  owing is noise on a collection sheet. A checkbox includes them.
- **Filters:** date range and a single area.
- **Urdu names** keep their own column in Excel and are rendered RTL-isolated on
  screen, so they cannot disturb the Latin text beside them.
- **Print, PDF, Word and Excel** come through the ERP's existing report document
  framework rather than a parallel one, so the output matches every other report.
- Opening the report is audited.

Permissions: visible to anyone with `COLLECTION_VIEW` or `FINANCIAL_REPORT_VIEW`
— owner, manager, accountant and sales. It contains no cost or profit figures.

---

## 3. Files changed

| File | Change |
|---|---|
| `erp-upgrade/28-areawise.js` | **New.** The report, its screen, document model and Excel sheet |
| `erp-upgrade/04-documents.js` | Supplier statement columns; Supplier/Customer code label |
| `erp-upgrade/03-docx.js` | Same code label fix in the Word export |
| `erp-upgrade/11-search.js` | Descriptions and notes indexed for invoices, purchases, payments |
| `erp-upgrade/build.py` | Registers module 28 |
| `erp-upgrade/test-areawise.mjs` | **New.** 40 checks |
| `app/farooq-co-erp.html`, `app/index.html` | Rebuilt |

No schema change. No migration. Nothing was removed.

---

## 4. Tests

**1,049 checks, 0 failures** across 18 harnesses. `test-areawise` is new with 40,
covering grouping, subtotals reconciling to rows, grand total reconciling to
groups, `balance = opening + sales − collection`, the area filter, date-range
isolation, the document columns and Urdu headings, the Excel sheet, the screen,
and the three closed gaps above.

---

## 5. Remaining risks and assumptions

1. **Area comes from the shop's region field.** Shops with no region are grouped
   under *Unassigned* rather than hidden, so nothing silently disappears from a
   collection sheet. If any shop shows up there, set its region in master data.
2. **No live-browser visual check.** Browser automation was unavailable; the
   screen and the printed sheet are verified structurally and by content, not by
   eye. Worth printing one page before the accountant relies on it.
3. **Urdu in the Word and Excel exports** emits correct characters, but a mixed
   English/Urdu line has not been inspected in LibreOffice this pass — the same
   caveat as earlier versions.
4. **Two statement builders still exist** (module 16 for customers, module 4 for
   suppliers). They now agree, but they are separate code, and a future change to
   one will need making in both. Merging them would be worthwhile if the
   statements are going to change again.
5. Earlier limitations stand: permissions are app-level rather than encryption,
   the warehouse PWA uses the older shared record, and there is no automatic
   off-device backup.
