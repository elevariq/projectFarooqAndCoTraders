/* Generates public_html/ERP/database/schema-mariadb.sql — the server-side home of
   the ERP's business data (replaces the browser IndexedDB stores in 01-db.js).

   Design (see docs/MYSQL_MIGRATION_PLAN.md):
   - One table per IndexedDB store, same names (snake_case).
   - `doc` holds the app's COMPLETE record as JSON — authoritative, so no field the
     app ever writes (34 modules add fields over time) can be lost on import/export.
   - Typed, indexed columns are STORED GENERATED columns computed from `doc` by the
     database itself: they can never disagree with the record, and unique numbers
     (invoice / receipt / purchase …) are enforced by real UNIQUE indexes.
   - An empty string becomes NULL in those columns, so a UNIQUE index allows any
     number of drafts (the old client index rejected the second draft invoice).
   - Money = integer paisa (DECIMAL(20,0)), quantities DECIMAL(20,3), exactly as the app.
   - No hard FOREIGN KEYs on purpose: real backups contain orphan/legacy references and a
     failed import must never be the price of a constraint. Health.orphans() reports them.

   Column spec:  'field'  |  'field:type'  |  'field:type:u'  (u = UNIQUE)
   types: s = text (default) · n = whole number/paisa · q = quantity · b = boolean      */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public_html/ERP/database/schema-mariadb.sql');
const DB_JS = fs.readFileSync(path.join(ROOT, 'public_html/ERP/erp-upgrade/01-db.js'), 'utf8');

const T = {
  meta: { pk: 'k' },
  sequences: { pk: 'k', cols: ['kind', 'year:n', 'n:n'] },
  business: { pk: 'id' },
  warehouses: { pk: 'id', cols: ['name', 'active:b'] },
  regions: { pk: 'id', cols: ['active:b'] },
  products: { pk: 'id', cols: ['cat', 'category', 'sku', 'barcode', 'active:b'] },
  customers: { pk: 'id', cols: ['region', 'legacyCode', 'sh', 'ph', 'active:b'] },
  suppliers: { pk: 'id', cols: ['legacyCode', 'co', 'active:b'] },
  inventory: { pk: 'id', cols: ['productId', 'warehouseId', 'qty:q', 'damagedQty:q', 'avgCostP:n'] },
  stockMovements: { pk: 'id', cols: ['productId', 'warehouseId', 'createdAt', 'date', 'ref', 'kind', 'qtyDelta:q'] },
  invoices: { pk: 'id', cols: ['invoiceNumber:s:u', 'customerId', 'warehouseId', 'invoiceDate', 'status', 'orderNumber', 'paymentStatus', 'grandTotal:n', 'paidAmount:n', 'balanceAmount:n'] },
  invoiceItems: { pk: 'id', cols: ['invoiceId', 'productId', 'quantity:q', 'lineTotal:n'] },
  purchases: { pk: 'id', cols: ['purchaseNumber:s:u', 'supplierId', 'warehouseId', 'purchaseDate', 'status', 'grandTotal:n', 'paidAmount:n', 'balanceAmount:n'] },
  purchaseItems: { pk: 'id', cols: ['purchaseId', 'productId'] },
  payments: { pk: 'id', cols: ['receiptNumber:s:u', 'partyId', 'partyType', 'paymentDate', 'direction', 'status', 'amount:n'] },
  paymentAllocations: { pk: 'id', cols: ['paymentId', 'invoiceId', 'purchaseId', 'amount:n'] },
  customerReturns: { pk: 'id', cols: ['returnNumber:s:u', 'customerId', 'invoiceId', 'returnDate'] },
  customerReturnItems: { pk: 'id', cols: ['returnId', 'productId'] },
  supplierReturns: { pk: 'id', cols: ['returnNumber:s:u', 'supplierId', 'purchaseId'] },
  supplierReturnItems: { pk: 'id', cols: ['returnId', 'productId'] },
  orders: { pk: 'id', cols: ['orderNumber:s:u', 'customerId', 'orderDate', 'status', 'kind'] },
  orderItems: { pk: 'id', cols: ['orderId', 'productId'] },
  stockDocs: { pk: 'id', cols: ['docNumber:s:u', 'type', 'docDate', 'warehouseId', 'invoiceId'] },
  stockDocItems: { pk: 'id', cols: ['docId', 'productId'] },
  migrationBackups: { pk: 'id', cols: ['createdAt'] },
  operations: { pk: 'opId', cols: ['entity', 'entityId', 'createdAt'] },
  documentEdits: { pk: 'id', cols: ['entityId', 'updatedAt'] },
  supplierProducts: { pk: 'id', cols: ['supplierId', 'productId'] },
  priceHistory: { pk: 'id', cols: ['productId', 'changedAt', 'field'] },
  priceApprovals: { pk: 'id', cols: ['productId', 'status', 'requestedAt'] },
  costHistory: { pk: 'id', cols: ['productId', 'effectiveDate', 'kind'] },
  users: { pk: 'id', cols: ['name', 'role', 'active:b'] },
  salesmen: { pk: 'id', cols: ['employeeId', 'active:b'] },
  accountAdjustments: { pk: 'id', cols: ['adjustmentNumber:s:u', 'customerId', 'adjustmentDate'] },
  expenses: { pk: 'id', cols: ['expenseNumber:s:u', 'category', 'expenseDate', 'paidTo'] },
  documents: { pk: 'no', cols: ['kind', 'createdAt'] },
  auditLog: { pk: 'id', cols: ['entity', 'entityId', 'createdAt', 'userId'] },
  landedCosts: { pk: 'id', cols: ['referenceNumber:s:u', 'purchaseId', 'transferId', 'warehouseId', 'costDate', 'status'] },
  landedCostExpenses: { pk: 'id', cols: ['landedCostId', 'category', 'expenseDate', 'paymentStatus'] },
  inventoryCostAdjust: { pk: 'id', cols: ['landedCostId', 'productId', 'purchaseItemId', 'warehouseId'] },
  employees: { pk: 'id', cols: ['name', 'role', 'active:b'] },
  salaryPayments: { pk: 'id', cols: ['salaryNumber:s:u', 'employeeId', 'paymentDate'] },
  millingJobs: { pk: 'id', cols: ['jobNumber:s:u', 'millId', 'jobDate'] },
  millingJobItems: { pk: 'id', cols: ['jobId', 'productId'] },
  syncQueue: { pk: 'opId', cols: ['state'] },
  legacy: { pk: 'k' }
};

/* the spec must cover exactly the stores the app defines — a new store added to
   01-db.js without a table here is a build error, never a silent data loss */
const appStores = [...DB_JS.matchAll(/^\s{2}(\w+):\s+\{ keyPath:/gm)].map(m => m[1]);
const missing = appStores.filter(s => !T[s]), extra = Object.keys(T).filter(s => !appStores.includes(s));
if (missing.length || extra.length) {
  console.error('Store list out of sync with 01-db.js.  Missing here:', missing, ' Not in app:', extra);
  process.exit(1);
}

const snake = s => s.replace(/([A-Z])/g, '_$1').toLowerCase();
const q = s => '`' + s + '`';
const jv = f => `JSON_VALUE(${q('doc')},'$.${f}')`;
const gen = {
  s: f => ({ sql: 'VARCHAR(191)', expr: `NULLIF(${jv(f)},'')` }),
  n: f => ({ sql: 'DECIMAL(20,0)', expr: `CAST(NULLIF(${jv(f)},'') AS DECIMAL(20,0))` }),
  q: f => ({ sql: 'DECIMAL(20,3)', expr: `CAST(NULLIF(${jv(f)},'') AS DECIMAL(20,3))` }),
  /* MariaDB's JSON_VALUE returns a JSON boolean as '1'/'0' (verified on 11.8.9), not
     'true'/'false'; a missing field stays NULL rather than being read as false */
  b: f => ({ sql: 'TINYINT(1)', expr: `(${jv(f)} IN ('true','1'))` })
};

let sql = `-- ═══════════════════════════════════════════════════════════════════════════
-- Farooq & Co Traders ERP — server database (MariaDB 11.x)
-- GENERATED by scripts/gen-mariadb-schema.mjs — do not edit by hand; edit the spec there.
-- Target database: u943531942_facotraders (business data). Logins live in the separate
-- u943531942_erpauth database (auth-schema.sql) and are never mixed with this.
--
-- Each table = one former IndexedDB store. \`doc\` is the app's complete record (JSON);
-- the typed columns are generated from it by the database, so they cannot drift.
-- \`rev\` is bumped on every write (optimistic concurrency for several users at once).
-- ═══════════════════════════════════════════════════════════════════════════
SET NAMES utf8mb4;

`;
for (const store of appStores) {
  const t = T[store], name = snake(store), lines = [], idx = [];
  lines.push(`  ${q('pk')} VARCHAR(128) NOT NULL COMMENT 'record key = ${t.pk}'`);
  lines.push(`  ${q('doc')} LONGTEXT NOT NULL`);
  lines.push(`  ${q('rev')} INT UNSIGNED NOT NULL DEFAULT 1`);
  /* not `updated_at`: the app's own records carry an `updatedAt` field that becomes a column */
  lines.push(`  ${q('row_updated_at')} TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`);
  const seen = new Set(['pk', 'doc', 'rev', 'row_updated_at']);
  for (const spec of t.cols || []) {
    const [f, ty = 's', flag] = spec.split(':');
    const g = gen[ty](f), col = snake(f);
    if (seen.has(col)) { console.error(`column name clash in ${store}: ${col}`); process.exit(1); }
    seen.add(col);
    lines.push(`  ${q(col)} ${g.sql} GENERATED ALWAYS AS (${g.expr}) STORED`);
    idx.push(flag === 'u' ? `  UNIQUE KEY ${q('uq_' + col)} (${q(col)})` : `  KEY ${q('ix_' + col)} (${q(col)})`);
  }
  lines.push(`  PRIMARY KEY (${q('pk')})`);
  lines.push(`  CONSTRAINT ${q('doc_is_json_' + name)} CHECK (JSON_VALID(${q('doc')}))`);
  sql += `CREATE TABLE IF NOT EXISTS ${q(name)} (\n${[...lines, ...idx].join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`;
}
fs.writeFileSync(OUT, sql);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${appStores.length} tables`);
