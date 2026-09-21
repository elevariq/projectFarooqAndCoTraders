#!/usr/bin/env python3
"""Inject the upgrade modules into farooq-co-erp.html and rebuild index.html.

Non-destructive: the original scripts are untouched. The upgrade is appended
as separate <script> blocks before </body>, so it loads after the app has
booted and can then patch it.
"""
import base64, pathlib, re, sys

BUILD = pathlib.Path(__file__).parent
MODDIR = BUILD / "mod"
OUT = BUILD / "dist"
OUT.mkdir(exist_ok=True)

MODULES = [
    ("00-bridge.js",         "BRIDGE — window view of the app's lexical state"),
    ("01-db.js",             "PERSISTENCE — IndexedDB, atomic transactions, sequences, money"),
    ("01b-server-db.js",     "SERVER DRIVER — the same FDB on the company MySQL database (off unless the server says so)"),
    ("02-services.js",       "DOMAIN — invoices, purchases, payments, returns, ledgers, migration"),
    ("03-docx.js",           "WORD — real editable .docx generation"),
    ("04-documents.js",      "DOCUMENTS — one model, A4 preview / print / PDF / Word / WhatsApp"),
    ("07-transactions.js",   "TRANSACTIONS — orders, quotations, transfers, receiving, adjustments, dispatch"),
    ("08-classic-invoice.js","CLASSIC INVOICE — the SInvoice.pdf layout for screen, print and Word"),
    ("05-ui-builder.js",     "UI — the multi-line editor and the invoice list"),
    ("09-paperwork.js",      "PAPERWORK — order, transfer, receipt, adjustment and dispatch notes; SMS settings"),
    ("06-wiring.js",         "WIRING — panels, settings, backup, patches, boot"),
    ("10-mobile.js",         "MOBILE — bottom navigation, stacked cards, sheet picker, fitted preview"),
    ("11-search.js",         "SEARCH — fuzzy Urdu/English index across every module, command palette"),
    ("12-invoice-editor.js", "EDITABLE INVOICE — hand edits before print/PDF/Word, autosave, revisions"),
    ("13-reports.js",        "REPORTING ENGINE — periods, aggregation, expenses, Excel writer"),
    ("14-reports-ui.js",     "REPORTS ROOM — date bar, cards, charts, tables and exports"),
    ("15-export-flow.js",    "EXPORT STEP — the editor offered at the moment of printing or exporting"),
    ("16-khata.js",          "ACCOUNT STATEMENT — the customer khata, adjustments, filters and exports"),
    ("17-profit.js",         "COST & PROFIT — landed cost, weighted average, margin engine, cost history"),
    ("18-master-data.js",    "MASTER DATA — areas, salesmen, supplier-product mapping, edit and archive"),
    ("19-collection-rbac.js","COLLECTION & ROLES — area collection sheets, profit reports, access control"),
    ("20-integrity.js",      "INTEGRITY — write lock, backed-up and verified migration, system health"),
    ("21-settings.js",       "PRICES & SETTINGS — price history and approval, the settings control panel"),
    ("22-users.js",          "USERS — accounts, sign-in, and approvals attributable to a person"),
    ("23-workbench.js",      "MASTER DATA — full field editing, custom fields, bulk changes, CSV"),
    ("24-client-changes.js", "CLIENT SET — Amount Paid, WhatsApp invoice, larger Qty/Rate, Description/تفصیل"),
    ("25-options.js",        "OPTIONS — every business setting and dropdown list editable, owner only"),
    ("26-landed-cost.js",    "LANDED COST — operational expenses on inventory, true profit, never on the supplier"),
    ("27-landed-ui.js",      "FINANCE UI — Landed costs, Expenses and Profit analysis screens"),
    ("28-areawise.js",       "AREA-WISE COLLECTION — sales, collection and balance per shop by area"),
    ("29-statement-of-account.js", "STATEMENT OF ACCOUNT — one Finance screen for either party's ledger"),
    ("30-payroll.js",        "PAYROLL — employee list, monthly salary rate, and salary payments (MVP)"),
    ("31-auth.js",           "AUTH — server-checked accounts, sessions and permissions (Phase 2: observe mode)"),
    ("32-milling.js",        "MILLING JOBS — toll milling: wheat out, flour + chokar back, net settled into the mill's khata"),
    ("33-invoice-search.js", "INVOICE SEARCH — find an old invoice by number, customer, product, date or amount"),
    ("34-accounts.js",       "COMPANY ACCOUNTS — the owner's screen for server accounts; who may open Payroll, Milling, Statements"),
    ("35-topbar.js",        "TOP BAR — one clean row on every screen, account menu, no dead controls"),
    ("36-ui-kit.js",        "UI KIT — themed scrollbars, dropdowns, calendar, dialogs, tooltips and controls in place of the browser's own"),
    ("37-stock-value.js",   "STOCK VALUE — what the goods in the warehouses are worth at cost; dashboard card, Inventory strip, own screen, print and Excel"),
    ("38-payment-search.js", "PAYMENT SEARCH — find a payment by receipt no., party, reference, amount, date or invoice; the Payments screen it drives"),
    ("40-nav.js",           "SIDEBAR — one icon per screen, collapsible groups, the logo as a mark (the name is written once)"),
    ("41-notifications.js", "NOTIFICATIONS — the bell opens a real panel (what needs attention, one tap to the screen that fixes it)"),
    ("42-layout.js",        "PAGE LAYOUT — the action buttons in one row beside the title; long lists in pages with Show more"),
]

MARKER = "<!-- FAROOQ & CO ERP — INVOICE, RECEIPT & DATABASE UPGRADE -->"
KIT_MARKER = "<!-- FAROOQ & CO — UI KIT (shared with the Warehouse app) -->"
KIT = "36-ui-kit.js"
# The Warehouse app reads and writes the company database through the SAME driver the office app uses
# (module 1 = the FDB interface, 1b = the server driver) plus its own small module (39). They must run BEFORE the
# page's own script, which decides at start-up which backend to use.
WH_MARKER = "<!-- FAROOQ & CO — WAREHOUSE DATA LAYER (server database, shared driver) -->"
WH_MODULES = ["01-db.js", "01b-server-db.js", "39-warehouse-server.js"]
WH_ANCHOR = "<script>\n/* ══ Icons"
HEAD_MARKER = "<!-- FAROOQ & CO ERP — PRE-BOOT GUARD -->"
PREBOOT = "00a-preboot.js"


def bundle() -> str:
    parts = [MARKER]
    for name, desc in MODULES:
        src = (MODDIR / name).read_text(encoding="utf-8")
        if "</script" in src.lower():
            sys.exit(f"{name} contains a literal </script> and would break the page")
        parts.append(f"<script>/* ── {name} · {desc} ── */\n{src}\n</script>")
    return "\n".join(parts)


def inject(html: str, payload: str) -> str:
    # remove a previous injection so the build is repeatable
    if MARKER in html:
        start = html.index(MARKER)
        end = html.rindex("</body>")
        html = html[:start] + html[end:]
    if HEAD_MARKER in html:
        start = html.index(HEAD_MARKER)
        end = html.index("</script>", start) + len("</script>")
        html = html[:start] + html[end:]

    # The guard has to run before the application's own scripts, so it goes
    # into <head>. Everything else loads after the app has booted.
    guard = (MODDIR / PREBOOT).read_text(encoding="utf-8")
    head = html.index("</head>")
    html = html[:head] + HEAD_MARKER + "<script>\n" + guard + "\n</script>\n" + html[head:]

    idx = html.rindex("</body>")
    return html[:idx] + payload + "\n\n" + html[idx:]


def inject_kit(html: str) -> str:
    """The Warehouse app is a separate page; it gets the same UI kit so its
    scrollbars, dropdowns and tooltips match. The kit is host-agnostic (it reads
    the host's own colour tokens), so it is added unchanged, and any earlier copy
    is stripped first so the build stays repeatable."""
    if KIT_MARKER in html:
        start = html.index(KIT_MARKER)
        end = html.index("</script>", start) + len("</script>")
        html = html[:start] + html[end:]
    kit = (MODDIR / KIT).read_text(encoding="utf-8")
    if "</script" in kit.lower():
        sys.exit(f"{KIT} contains a literal </script> and would break the page")
    idx = html.rindex("</body>")
    return html[:idx] + KIT_MARKER + "<script>\n" + kit + "\n</script>\n" + html[idx:]


def inject_warehouse_data(html: str) -> str:
    """Put the shared database driver in front of the Warehouse app's own script. Repeatable: an earlier copy is stripped first."""
    if WH_MARKER in html:
        start = html.index(WH_MARKER)
        end = html.index("</script>", start) + len("</script>")
        html = html[:start] + html[end:].lstrip("\r\n")
    parts = []
    for name in WH_MODULES:
        src = (MODDIR / name).read_text(encoding="utf-8")
        if "</script" in src.lower():
            sys.exit(f"{name} contains a literal </script> and would break the page")
        parts.append(f"/* ── {name} ── */\n{src}")
    if html.count(WH_ANCHOR) != 1:
        sys.exit("could not find the start of the Warehouse app's own script")
    idx = html.index(WH_ANCHOR)
    return html[:idx] + WH_MARKER + "<script>\n" + "\n".join(parts) + "\n</script>\n" + html[idx:]


def embed(launcher: str, key: str, title: str, page: str) -> str:
    b64 = base64.b64encode(page.encode("utf-8")).decode("ascii")
    out, n = re.subn(
        r"(" + key + r":\{title:'" + title + r"',b64:')[^']*(')",
        lambda m: m.group(1) + b64 + m.group(2),
        launcher,
        count=1,
    )
    if n != 1:
        sys.exit(f"could not find the {title} blob in index.html")
    return out


def main() -> None:
    erp = (BUILD / "farooq-co-erp.html").read_text(encoding="utf-8")
    payload = bundle()
    upgraded = inject(erp, payload)
    (OUT / "farooq-co-erp.html").write_text(upgraded, encoding="utf-8")

    # standalone copies of the modules, for maintenance
    moddir = OUT / "erp-upgrade"
    moddir.mkdir(exist_ok=True)
    for name, _ in MODULES:
        (moddir / name).write_text((MODDIR / name).read_text(encoding="utf-8"), encoding="utf-8")

    # rebuild the launcher with the upgraded ERP and the Warehouse app embedded
    launcher = (BUILD / "index.html").read_text(encoding="utf-8")
    pwa = inject_kit(inject_warehouse_data((BUILD / "farooq-co-warehouse-pwa.html").read_text(encoding="utf-8")))
    new_launcher = embed(embed(launcher, "erp", "Office", upgraded), "pwa", "Warehouse", pwa)
    (OUT / "index.html").write_text(new_launcher, encoding="utf-8")

    # the Warehouse app on its own (with the UI kit); the homepage is carried through unchanged
    (OUT / "farooq-co-warehouse-pwa.html").write_text(pwa, encoding="utf-8")
    for name in ("farooq-and-co-homepage.html", "farooq-erp-data.js"):
        (OUT / name).write_text((BUILD / name).read_text(encoding="utf-8"), encoding="utf-8")

    print(f"ERP      {len(erp):>9,} -> {len(upgraded):>9,} bytes  (+{len(payload):,} upgrade)")
    print(f"launcher {len(launcher):>9,} -> {len(new_launcher):>9,} bytes")


if __name__ == "__main__":
    main()
