# Farooq & Co Traders ERP — Every Option Editable

**Build:** `2026-09-14-options-v17`
**Base:** `2026-09-14-clientset-v16`

All four requested areas are editable, and settings are now the owner's alone.

---

## A correction to what I first told you

My opening estimate — *"58 settings defined, only 9 editable"* — was **wrong**. I had
counted `field()` calls in one module and missed two existing cards: the older
**Business profile** card (25 keys) and the **Sales & profit** card (5 keys, using a
different attribute). The real starting gap was much smaller.

I re-measured properly by walking every Settings section in a live browser DOM and
counting every kind of control, rather than grepping source. That measurement is now
a permanent test.

| | Before | After |
|---|---|---|
| Owner-facing settings with a control | 55 of 67 | **67 of 67** |
| Option lists editable | 5 | **9** |
| Settings that save but do nothing | 2 | **0** |

---

## 1. Three real bugs found

### 1.1 Two settings that did nothing at all

The Settings screen had toggles labelled **"Allow selling below cost"** and
**"Show profit figures to sales staff"**. They wrote `allowSellBelowCost` and
`showProfitToSales`.

Nothing in the ERP has ever read either key. The rules are enforced from
`allowSaleBelowCost` and `showProfitToStaff` — one letter and one word apart.

So the owner could switch "Allow selling below cost" **off**, believe under-cost
sales were now blocked, and they would carry on exactly as before. The dead
duplicates are removed; the working controls in the Sales & profit card already
edit the real keys.

### 1.2 The invoice footer never printed

`invoiceFooter` was editable and saved correctly, but the **classic** template —
the default printed invoice — never rendered a footer block. Only the alternate
template did. Editing the footer appeared to do nothing on the invoice that
actually gets printed. The classic template now prints the footer, terms and bank
details.

### 1.3 Urdu settings were left-to-right

`taglineUr` and `slogan` are Urdu, but rendered as plain left-to-right inputs,
which makes them awkward to type and read. Rather than duplicating those fields
just to add a direction, the existing controls are upgraded in place.

---

## 2. All 67 settings editable

Every remaining key now has a control, grouped into the Settings sections that
already existed. Types: plain text, multi-line, Urdu (RTL), whole number, decimal,
switch, choice list, and an image upload for the logo.

Newly reachable without editing code, among others: `currency`, `taxEnabled`,
`orderPrefix`, `dispatchPrefix`, `preparedByLabel`, `receivedByLabel`,
`defaultDueDays`, `invoiceExportFlow`, `requirePinOnSwitch`, `logoDataUrl`.

**Nothing is rendered twice.** Where a key already had a control, the catalogue
skips it. A setting with two boxes that disagree is worse than one box, so the
existing field is left to do its job. This is asserted by test.

The logo upload accepts an image under 400 KB and stores it with the other
settings; it prints in place of the initials.

---

## 3. Dropdown lists

These were literal arrays inside the forms. They are now edited as chips in
Settings, with add and remove:

| List | Where it appears |
|---|---|
| Payment methods | Sale, purchase, Receive payment, Pay supplier |
| Customer return reasons | Customer return |
| Account adjustment reasons | Account adjustment |
| Package types | Products and line items |
| Expense categories | Expenses |
| Categories, brands, units | Products *(already editable)* |

`ERP.ENUM.methods` and `ERP.Adjustments.reasons` became live getters, so all the
existing call sites follow the edited list without a single one being changed.

**An emptied list falls back to its defaults.** Clearing every payment method
cannot leave a dropdown with nothing in it and a form that cannot be completed.

---

## 4. Document and statement wording

Editable and — the part that matters — actually applied:

* Invoice footer, terms, bank details *(now printed on the classic template)*
* Signature labels
* Statement column headings, including the Urdu: `Description / تفصیل`,
  `Debit / بنام`, `Credit / جمع`, `Balance / بقایا`, `Folio / Reference #`, `Qty`
* The WhatsApp closing line, with `{business}` substituted for the business name

Each falls back to the previously hard-coded wording, so nothing changes until the
owner edits it. **A setting that saves but changes nothing is worse than no setting
at all**, so every wording key is read at the point the text is produced, and each
is covered by a test that asserts the edit reaches the output.

---

## 5. Custom fields

Already fully implemented for products, customers and suppliers, with add/remove
UI in the master-data workbench. **I verified it rather than rebuilding it** —
adding, duplicate rejection, and removal all pass on all three entities.

---

## 6. Owner only

The Settings screen previously opened for the owner, a manager **and** an
accountant. It is now the owner's alone, enforced in two places:

1. The page itself refuses to render for anyone else.
2. `ERP.Settings.save()` rejects a non-owner — so reaching a control another way,
   or scripting it, still fails.

Asserted both ways: staff cannot open Settings, cannot save even by calling
directly, and the value is confirmed unchanged afterwards.

---

## 7. Tests

**935 checks, 0 failures** across 16 harnesses.

| Harness | Result |
|---|---|
| `test-erp` | 196 |
| `test-ui` | 86 |
| `test-integrity` | 68 |
| `test-reports` | 66 |
| `test-client-changes` | 64 |
| `test-mobile` | 57 |
| `test-profit` | 55 |
| `test-khata` | 47 |
| `test-editor` | 47 |
| `test-settings` | 44 |
| `test-options` **(new)** | **43** |
| `test-search` | 42 |
| `test-workbench` | 41 |
| `test-collection` | 29 |
| `test-users` | 29 |
| `test-merge` | 21 |

`test-options` covers coverage measurement, no-duplicate-control, per-type
rendering, saving, wording reaching the output, list editing and fallback, custom
fields, the owner-only rule from both directions, and survival across a restart.

---

## 8. Files changed

| File | Change |
|---|---|
| `erp-upgrade/25-options.js` | **New.** Settings catalogue, list registry, wording application, logo upload, owner-only rule |
| `erp-upgrade/21-settings.js` | Removed the two dead toggles |
| `erp-upgrade/08-classic-invoice.js` | Footer, terms and bank details now printed |
| `erp-upgrade/06-wiring.js` | Return reasons read from the editable list |
| `erp-upgrade/build.py` | Registers module 25 |
| `erp-upgrade/test-options.mjs` | **New.** 43 checks |
| `app/farooq-co-erp.html`, `app/index.html` | Rebuilt |

No new storage mechanism: every value is an ordinary key on the existing
`business` settings record, saved through `ERP.Settings.save()` and audited by the
handlers already in place.

---

## 9. Remaining risks and assumptions

1. **No live-browser visual check.** Browser automation was unavailable, so layout
   is verified structurally, not by eye. Open Settings on the real machine and
   confirm the new cards read well before rolling out.
2. **Changing `currency` does not convert existing figures.** It relabels. The
   field says so; there is no conversion and there should not be a silent one.
3. **The logo is stored inline with the settings.** The 400 KB cap keeps the
   record sensible; a very large image is refused rather than quietly bloating
   every backup.
4. **`costingMethod` offers only weighted average**, which is all the engine
   implements. The control is there so the choice is visible, not to imply an
   option that does not exist.
5. **Owner-only is a UI and service-layer rule, not encryption.** Consistent with
   the rest of this ERP: someone with the device and the browser's data file can
   still read and change it. That limitation is unchanged from earlier versions.
6. **Two settings keys were removed** (`allowSellBelowCost`, `showProfitToSales`).
   Any old record carrying them is simply ignored — they were never read, so no
   behaviour depends on them.
7. Earlier limitations stand: the warehouse PWA still uses the older shared
   record, and there is no automatic off-device backup.
