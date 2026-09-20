# Farooq & Co Traders — ERP Package

Everything in one folder: the running app, the source of the upgrade, the database schema and
data, sample documents, and the written reports.

**To use it:** open **`app/index.html`** and choose **Office**. Nothing to install.

> Serve the folder over `http://` (or from a domain) rather than double-clicking the file. Some
> browsers block storage for files opened directly; the ERP will say so in its header and keep
> working in memory, but the work would be lost when the tab closes. Any small web server will do —
> for example, from inside the `app` folder: `python3 -m http.server 8080`, then open
> `http://localhost:8080`.

---

## What is in here

### `app/` — the ERP itself

| File | What it is |
|---|---|
| `index.html` | **The launcher — start here.** Carries both apps inside it |
| `farooq-co-erp.html` | The office ERP, standalone. The whole system is in this one file |
| `farooq-co-warehouse-pwa.html` | The warehouse app for the godown device |
| `farooq-and-co-homepage.html` | The public homepage, with its ERP links pointing at the launcher |
| `farooq-erp-data.js` | The master data layer, kept separate for reference |

`index.html` and `farooq-co-erp.html` are self-contained: no internet, no server, no install.

### `erp-upgrade/` — the source

The upgrade is written as thirty-two modules that load after the original app and extend it. They are
here in readable form, with the build script that injects them and the test harnesses that check
them.

| Module | Does |
|---|---|
| `00a-preboot.js` | **Loads before the app.** Copies the shared record and holds writes until migration is done |
| `00-bridge.js` | Exposes the app's internal state to the modules |
| `01-db.js` | IndexedDB, atomic transactions, sequences, money, backup, adopting the old database |
| `02-services.js` | Invoices, purchases, payments, returns, inventory, ledgers, migration, audit |
| `03-docx.js` | The Word writer — a ZIP and OOXML builder written from scratch |
| `04-documents.js` | One document model, rendered as preview, print, PDF, Word and WhatsApp |
| `05-ui-builder.js` | The multi-line editor used by every transaction type, and the invoice list |
| `06-wiring.js` | Panels, settings, backup UI, and the patches onto the original screens |
| `07-transactions.js` | Orders, quotations, transfers, receiving, adjustments, dispatch |
| `08-classic-invoice.js` | The invoice laid out from `SInvoice.pdf` |
| `09-paperwork.js` | Order, transfer, receipt, adjustment and dispatch notes; SMS settings |
| `10-mobile.js` | Bottom navigation, stacked cards, the sheet picker, the fitted preview, two-across dashboard tiles, sidebar collapse button |
| `11-search.js` | The fuzzy Urdu/English index and the command palette |
| `12-invoice-editor.js` | Editing an invoice by hand before it is exported, with autosave and revisions |
| `13-reports.js` | The reporting engine, expenses, and the Excel writer |
| `14-reports-ui.js` | The reports room: periods, cards, charts, tables, exports |
| `15-export-flow.js` | Offering the editor at the moment of printing or exporting |
| `16-khata.js` | The customer account statement, adjustments, filters and exports |
| `17-profit.js` | Landed cost, weighted-average costing, margin and markup, cost history |
| `18-master-data.js` | Areas, salesmen, supplier↔product mapping, editing and archiving |
| `19-collection-rbac.js` | The area collection sheet, profit reports, and who may see what |
| `20-integrity.js` | The write lock, backed-up and verified migration, and system health |
| `21-settings.js` | Product prices with history and approval, and the settings control panel |
| `22-users.js` | User accounts, sign-in, and approvals attributable to a person |
| `23-workbench.js` | Editing every product, shop and supplier detail — singly, in bulk, or by spreadsheet |
| `24-client-changes.js` | Amount Paid, WhatsApp invoice, larger Qty/Rate fields, Description/تفصیل |
| `25-options.js` | Every business setting and dropdown list editable, owner only |
| `26-landed-cost.js` | Landed cost — operational expenses on inventory, never on the supplier |
| `27-landed-ui.js` | Finance UI for landed costs, expenses and profit analysis |
| `28-areawise.js` | Area-wise collection: sales, collection and balance per shop, grouped by area |
| `29-statement-of-account.js` | One Finance screen for either party's full ledger |
| `30-payroll.js` | Employee list, monthly salary rate, and salary payments (MVP) |
| `31-auth.js` | Server-checked accounts, sessions and permissions; the change-password box (opened from Company accounts → My account) |
| `32-milling.js` | Milling jobs — toll milling: wheat out, flour + chokar back, net settled into the mill's khata |
| `33-invoice-search.js` | Invoice search — find an old invoice by number, customer, product, date or amount; paged list |
| `34-accounts.js` | Company accounts screen — "My account" (change password) for everyone signed in, the staff list for the owner; who may open Payroll, Milling, Statements |
| `35-topbar.js` | The top bar — one 58px row on every screen, the avatar account menu, no dead controls (warehouse picker and fake sync pill removed) |

To rebuild `app/farooq-co-erp.html` and `app/index.html` after changing a module:

```
python3 build.py          # needs the original ERP file alongside it
node test-erp.mjs         # and the other harnesses
```

The harnesses need `jsdom` and `fake-indexeddb` (`npm install jsdom fake-indexeddb`). They load the
built page in a real DOM with a working IndexedDB and drive it the way a person would.

### `database/` — the schema and a clean starting record

| File | What it is |
|---|---|
| `SCHEMA.md` | **Read this one.** Every store, every relationship, and the rules the database keeps |
| `schema.json` | The same schema as data, generated from the app itself |
| `schema.sql` | The equivalent PostgreSQL design — 29 tables, 34 indexes, 48 foreign keys |
| `schema.prisma` | The same again for Prisma, for the day this moves to a server |
| `fresh-install-backup.json` | A restorable backup of a clean install: 136 products, 409 shops, 32 suppliers, 8 regions, 3 warehouses, no transactions |

### `data-exports/` — the master data in plain form

`products.csv` · `customers.csv` · `suppliers.csv` · `regions.csv` · `warehouses.csv` ·
`master-data.json`

Open them in Excel. The customer file keeps the legacy account code and the original
Total Sales / Collection / Balance figures as reference columns, and flags the 68 shops whose region
was assumed from a route file and still needs confirming.

### `samples/` — documents produced by the ERP

Real output, not mock-ups: the classic invoice, a sales order, a transfer note, a hand-edited
invoice, and a business report as both Word and Excel.

### `docs/` — the written reports

`FINAL_ERP_REPORT.md` is the current one; the two earlier reports record how the system got here.

---

## Backing up and restoring

* **Settings → Backup Database** downloads every record as one JSON file. Do this weekly, and
  before anything unusual.
* **Settings → Restore** reads that file back. It downloads a backup of the current state first and
  asks you to confirm.
* **Settings → Export Business Data** writes CSVs of invoices, invoice lines and customer balances.
* Reports export to Excel, Word and PDF from the reports screen.

To set up a **new device**: open the launcher, go to Settings → Restore, and give it either your own
latest backup or `database/fresh-install-backup.json` for a clean start with the master data.

---

## Where the data actually lives

In the browser's own database (`farooqco_erp_ledger`) on the device running the ERP. It is not in
these files and not on any server, which is why it works with no internet — and why the backups
matter. Each device keeps its own records; the warehouse app shares its record with the office ERP
on the same device through the launcher.

---

## Still to decide

1. **Opening balances.** The legacy Total Sales / Collection / Balance figures are held as reference
   only. Carrying them in as real opening balances is a deliberate cutover and needs a date from you.
2. **The 68 route-corridor shops** marked `region_assumed` need a definite region.
3. **Five blank catalogue rows** (codes 101, 103, 108, 111, 132), **eleven products with a zero
   listed value**, and **two duplicate-name groups** are flagged and waiting on your decision.
4. **Suppliers 204 / 494 / 575 / 614** — account type to confirm; 575 is currently switched off.
5. **Roles are advisory** — enforced by hiding actions, not by a server, because there is no server.
6. **SMS and WhatsApp** are configured but not connected to a provider; messages open the phone's
   own composer or `wa.me`.
