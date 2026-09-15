/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 1/5
   PERSISTENCE  ·  FDB
   A real relational-style store on IndexedDB with atomic multi-store
   transactions, database-backed number sequences, integer-paisa money and
   a safe backup/restore path. Falls back to localStorage, then to memory,
   and always reports which driver is live (§17 §20 §23 §25 §28 §45 §56).
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var UPGRADE_VERSION = '2026-09-09-invoicing-v1';

/* ── Money: every calculation happens in integer paisa, never in floats ──
   §45. Rupees are only ever produced at the edges (display, storage of a
   rounded figure). 0.1 + 0.2 problems cannot reach a customer balance.     */
var Money = {
  toP: function (v) {                       // rupees (any shape) → paisa int
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Math.round(v * 100);
    var s = String(v).replace(/[^0-9.\-]/g, '');
    if (!s || s === '-' || s === '.') return 0;
    return Math.round(parseFloat(s) * 100) || 0;
  },
  toR: function (p) { return Math.round(p || 0) / 100; },           // paisa → rupees
  mul: function (p, qty) {                  // paisa × quantity (qty may be fractional)
    return Math.round((p || 0) * (Number(qty) || 0));
  },
  sum: function (list) { return (list || []).reduce(function (a, b) { return a + (b || 0); }, 0); },
  fmt: function (p) {                       // paisa → "PKR 425,000" / "PKR 425,000.50"
    var r = Money.toR(p), neg = r < 0; r = Math.abs(r);
    var whole = Math.floor(r), cents = Math.round((r - whole) * 100);
    var s = whole.toLocaleString('en-US') + (cents ? '.' + String(cents).padStart(2, '0') : '');
    return (neg ? '− ' : '') + 'PKR ' + s;
  },
  fmtPlain: function (p) {                  // for Word/CSV — no currency word
    var r = Money.toR(p), neg = r < 0; r = Math.abs(r);
    var whole = Math.floor(r), cents = Math.round((r - whole) * 100);
    return (neg ? '-' : '') + whole.toLocaleString('en-US') + '.' + String(cents).padStart(2, '0');
  },
  qty: function (v) { var n = Number(v); return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; }
};

/* ── Store definitions. Every business-critical record has its own store,
      a primary key and the indexes §24 asks for. Line items live in their
      own store (normalised, never a JSON blob) §19.                        */
var STORES = {
  meta:                  { keyPath: 'k' },
  sequences:             { keyPath: 'k' },
  business:              { keyPath: 'id' },
  warehouses:            { keyPath: 'id' },
  regions:               { keyPath: 'id' },
  products:              { keyPath: 'id',    idx: { category: 'cat', active: 'activeIdx' } },
  customers:             { keyPath: 'id',    idx: { region: 'region', legacyCode: 'legacyCode' } },
  suppliers:             { keyPath: 'id',    idx: { legacyCode: 'legacyCode' } },
  inventory:             { keyPath: 'id',    idx: { productId: 'productId', warehouseId: 'warehouseId' } },
  stockMovements:        { keyPath: 'id',    idx: { productId: 'productId', warehouseId: 'warehouseId', createdAt: 'createdAt', ref: 'ref' } },
  invoices:              { keyPath: 'id',    idx: { invoiceNumber: ['invoiceNumber', true], customerId: 'customerId', warehouseId: 'warehouseId', invoiceDate: 'invoiceDate', status: 'status', orderNumber: 'orderNumber' } },
  invoiceItems:          { keyPath: 'id',    idx: { invoiceId: 'invoiceId', productId: 'productId' } },
  purchases:             { keyPath: 'id',    idx: { purchaseNumber: ['purchaseNumber', true], supplierId: 'supplierId', warehouseId: 'warehouseId', purchaseDate: 'purchaseDate' } },
  purchaseItems:         { keyPath: 'id',    idx: { purchaseId: 'purchaseId', productId: 'productId' } },
  payments:              { keyPath: 'id',    idx: { receiptNumber: ['receiptNumber', true], partyId: 'partyId', paymentDate: 'paymentDate', direction: 'direction' } },
  paymentAllocations:    { keyPath: 'id',    idx: { paymentId: 'paymentId', invoiceId: 'invoiceId' } },
  customerReturns:       { keyPath: 'id',    idx: { returnNumber: ['returnNumber', true], customerId: 'customerId', invoiceId: 'invoiceId', returnDate: 'returnDate' } },
  customerReturnItems:   { keyPath: 'id',    idx: { returnId: 'returnId', productId: 'productId' } },
  supplierReturns:       { keyPath: 'id',    idx: { returnNumber: ['returnNumber', true], supplierId: 'supplierId', purchaseId: 'purchaseId' } },
  supplierReturnItems:   { keyPath: 'id',    idx: { returnId: 'returnId', productId: 'productId' } },
  orders:                { keyPath: 'id',    idx: { orderNumber: ['orderNumber', true], customerId: 'customerId', orderDate: 'orderDate', status: 'status', kind: 'kind' } },
  orderItems:            { keyPath: 'id',    idx: { orderId: 'orderId', productId: 'productId' } },
  stockDocs:             { keyPath: 'id',    idx: { docNumber: ['docNumber', true], type: 'type', docDate: 'docDate', warehouseId: 'warehouseId', invoiceId: 'invoiceId' } },
  stockDocItems:         { keyPath: 'id',    idx: { docId: 'docId', productId: 'productId' } },
  migrationBackups:      { keyPath: 'id',    idx: { createdAt: 'createdAt' } },
  operations:            { keyPath: 'opId',  idx: { entity: 'entity', createdAt: 'createdAt' } },
  documentEdits:         { keyPath: 'id',    idx: { entityId: 'entityId', updatedAt: 'updatedAt' } },
  supplierProducts:      { keyPath: 'id',    idx: { supplierId: 'supplierId', productId: 'productId' } },
  priceHistory:          { keyPath: 'id',    idx: { productId: 'productId', changedAt: 'changedAt', field: 'field' } },
  priceApprovals:        { keyPath: 'id',    idx: { productId: 'productId', status: 'status', requestedAt: 'requestedAt' } },
  costHistory:           { keyPath: 'id',    idx: { productId: 'productId', effectiveDate: 'effectiveDate', kind: 'kind' } },
  users:                 { keyPath: 'id',    idx: { name: 'name', role: 'role', active: 'active' } },
  salesmen:              { keyPath: 'id',    idx: { employeeId: 'employeeId', active: 'active' } },
  accountAdjustments:    { keyPath: 'id',    idx: { adjustmentNumber: ['adjustmentNumber', true], customerId: 'customerId', adjustmentDate: 'adjustmentDate' } },
  expenses:              { keyPath: 'id',    idx: { expenseNumber: ['expenseNumber', true], category: 'category', expenseDate: 'expenseDate', paidTo: 'paidTo' } },
  documents:             { keyPath: 'no',    idx: { kind: 'kind', createdAt: 'createdAt' } },
  auditLog:              { keyPath: 'id',    idx: { entity: 'entity', entityId: 'entityId', createdAt: 'createdAt', userId: 'userId' } },
  /* ── landed cost: operational expenses added after a purchase and spread
     over the bags. Deliberately separate stores so nothing here can reach a
     supplier balance. ── */
  landedCosts:           { keyPath: 'id',    idx: { referenceNumber: ['referenceNumber', true], purchaseId: 'purchaseId', transferId: 'transferId', warehouseId: 'warehouseId', costDate: 'costDate', status: 'status' } },
  landedCostExpenses:    { keyPath: 'id',    idx: { landedCostId: 'landedCostId', category: 'category', expenseDate: 'expenseDate', paymentStatus: 'paymentStatus' } },
  inventoryCostAdjust:   { keyPath: 'id',    idx: { landedCostId: 'landedCostId', productId: 'productId', purchaseItemId: 'purchaseItemId', warehouseId: 'warehouseId' } },
  syncQueue:             { keyPath: 'opId',  idx: { state: 'state' } },
  legacy:                { keyPath: 'k' }   /* orders, dispatch, activity, rules, users, devices … */
};
var STORE_NAMES = Object.keys(STORES);

/* The earlier in-house build also called its database 'farooqco_erp', but
   stored a single JSON snapshot in a `state` store with out-of-line keys.
   Opening that database under this schema would corrupt it, so this build
   uses its own name and adopts the old one on first run instead. */
var DB_NAME = 'farooqco_erp_ledger';
var DB_VER  = 9;   /* … v7 price history and approvals · v8 user accounts · v9 landed cost */
var OLD_DB_NAME = 'farooqco_erp';
var LS_KEY  = 'farooqco_erp_idb_mirror';
var LEGACY_LS_KEY = 'farooqco_erp_v1';

var FDB = {
  version: UPGRADE_VERSION,
  driver: 'memory',          // 'indexeddb' | 'localstorage' | 'memory'
  ready: false,
  lastError: null,
  lastWriteAt: null,
  pendingWrites: 0,
  _db: null,
  _mem: {},                  // driver-of-last-resort mirror
  Money: Money,
  STORE_NAMES: STORE_NAMES
};
STORE_NAMES.forEach(function (n) { FDB._mem[n] = {}; });

/* ── open ────────────────────────────────────────────────────────────── */
FDB.open = function () {
  return new Promise(function (resolve) {
    var idb = null;
    try { idb = global.indexedDB || global.mozIndexedDB || global.webkitIndexedDB; } catch (e) { idb = null; }
    if (!idb) { FDB._fallback('IndexedDB is not available in this browser'); return resolve(FDB); }
    var req;
    try { req = idb.open(DB_NAME, DB_VER); }
    catch (e) { FDB._fallback('IndexedDB blocked: ' + e.message); return resolve(FDB); }

    req.onupgradeneeded = function (ev) {
      var db = ev.target.result;
      STORE_NAMES.forEach(function (name) {
        var def = STORES[name], os;
        if (db.objectStoreNames.contains(name)) os = req.transaction.objectStore(name);
        else os = db.createObjectStore(name, { keyPath: def.keyPath });
        Object.keys(def.idx || {}).forEach(function (ixName) {
          var spec = def.idx[ixName], path = Array.isArray(spec) ? spec[0] : spec,
              uniq = Array.isArray(spec) ? !!spec[1] : false;
          if (!os.indexNames.contains(ixName)) {
            try { os.createIndex(ixName, path, { unique: uniq }); } catch (e) {}
          }
        });
      });
    };
    req.onsuccess = function (ev) {
      FDB._db = ev.target.result;
      FDB.driver = 'indexeddb';
      FDB.ready = true;
      FDB._db.onversionchange = function () { try { FDB._db.close(); } catch (e) {} };
      resolve(FDB);
    };
    req.onerror = function () {
      FDB._fallback('IndexedDB could not be opened: ' + (req.error && req.error.message || 'unknown'));
      resolve(FDB);
    };
    setTimeout(function () {                       // never hang the boot
      if (!FDB.ready) { FDB._fallback('IndexedDB did not respond'); resolve(FDB); }
    }, 4000);
  });
};

FDB._fallback = function (why) {
  FDB.lastError = why;
  var ok = false;
  try { global.localStorage.setItem('__fdb_probe', '1'); global.localStorage.removeItem('__fdb_probe'); ok = true; } catch (e) { ok = false; }
  FDB.driver = ok ? 'localstorage' : 'memory';
  FDB.ready = true;
  if (ok) {
    try {
      var raw = global.localStorage.getItem(LS_KEY);
      if (raw) FDB._mem = JSON.parse(raw);
      STORE_NAMES.forEach(function (n) { if (!FDB._mem[n]) FDB._mem[n] = {}; });
    } catch (e) {}
  }
};

/* ── tx(stores, fn) — ONE atomic unit of work ─────────────────────────────
   fn receives {put,del,get,all}. Anything thrown inside aborts the whole
   transaction, so a sale can never leave an invoice without its stock
   movement, or a payment without its allocation (§20).                    */
FDB.tx = function (storeNames, fn) {
  storeNames = storeNames.filter(function (n) { return STORE_NAMES.indexOf(n) > -1; });
  if (FDB.driver !== 'indexeddb') return FDB._txMem(storeNames, fn);

  return new Promise(function (resolve, reject) {
    var t, done = false, result;
    try { t = FDB._db.transaction(storeNames, 'readwrite'); }
    catch (e) { return reject(e); }
    var api = {
      put: function (store, rec) { t.objectStore(store).put(rec); return rec; },
      del: function (store, key) { t.objectStore(store).delete(key); },
      get: function (store, key) {
        return new Promise(function (res, rej) {
          var r = t.objectStore(store).get(key);
          r.onsuccess = function () { res(r.result || null); };
          r.onerror = function () { rej(r.error); };
        });
      },
      all: function (store) {
        return new Promise(function (res, rej) {
          var r = t.objectStore(store).getAll();
          r.onsuccess = function () { res(r.result || []); };
          r.onerror = function () { rej(r.error); };
        });
      },
      abort: function () { try { t.abort(); } catch (e) {} }
    };
    FDB.pendingWrites++;
    t.oncomplete = function () { done = true; FDB.pendingWrites--; FDB.lastWriteAt = Date.now(); resolve(result); };
    t.onabort    = function () { if (!done) { FDB.pendingWrites--; reject(t.error || new Error('Transaction rolled back')); } };
    t.onerror    = function () { if (!done) { FDB.pendingWrites--; reject(t.error || new Error('Transaction failed')); } };
    Promise.resolve()
      .then(function () { return fn(api); })
      .then(function (r) { result = r; })
      .catch(function (err) { try { t.abort(); } catch (e) {} if (!done) { done = true; FDB.pendingWrites--; reject(err); } });
  });
};

/* Memory / localStorage transaction: work on a deep copy, publish only on
   success. Same all-or-nothing guarantee, same API. */
FDB._txMem = function (storeNames, fn) {
  var snapshot = JSON.parse(JSON.stringify(FDB._mem));
  var api = {
    put: function (store, rec) {
      var key = STORES[store].keyPath;
      FDB._mem[store] = FDB._mem[store] || {};
      FDB._mem[store][rec[key]] = rec; return rec;
    },
    del: function (store, key) { if (FDB._mem[store]) delete FDB._mem[store][key]; },
    get: function (store, key) { return Promise.resolve((FDB._mem[store] || {})[key] || null); },
    all: function (store) {
      return Promise.resolve(Object.keys(FDB._mem[store] || {}).map(function (k) { return FDB._mem[store][k]; }));
    },
    abort: function () { throw new Error('aborted'); }
  };
  return Promise.resolve()
    .then(function () { return fn(api); })
    .then(function (r) { FDB._flushMem(); FDB.lastWriteAt = Date.now(); return r; })
    .catch(function (err) { FDB._mem = snapshot; throw err; });
};

FDB._flushMem = function () {
  if (FDB.driver !== 'localstorage') return;
  try { global.localStorage.setItem(LS_KEY, JSON.stringify(FDB._mem)); }
  catch (e) { FDB.lastError = 'Browser storage is full — export a backup from Settings'; }
};

/* ── bulk read of every store, used once at boot ───────────────────────── */
FDB.hydrate = function () {
  if (FDB.driver !== 'indexeddb') {
    var out = {};
    STORE_NAMES.forEach(function (n) {
      out[n] = Object.keys(FDB._mem[n] || {}).map(function (k) { return FDB._mem[n][k]; });
    });
    return Promise.resolve(out);
  }
  return new Promise(function (resolve, reject) {
    var t = FDB._db.transaction(STORE_NAMES, 'readonly'), out = {}, left = STORE_NAMES.length;
    STORE_NAMES.forEach(function (n) {
      var r = t.objectStore(n).getAll();
      r.onsuccess = function () { out[n] = r.result || []; if (!--left) resolve(out); };
      r.onerror   = function () { out[n] = []; if (!--left) resolve(out); };
    });
    t.onerror = function () { reject(t.error); };
  });
};

/* ── database-backed sequences (§25) ───────────────────────────────────────
   The counter is read and written inside the caller's own transaction, so
   two invoices saved in the same second cannot take the same number. The
   returned number is never recycled — a cancelled invoice keeps its number. */
FDB.nextNumber = function (api, kind, year) {
  year = year || new Date().getFullYear();
  var key = kind + ':' + year;
  return api.get('sequences', key).then(function (row) {
    var n = ((row && row.n) || 0) + 1;
    api.put('sequences', { k: key, kind: kind, year: year, n: n, updatedAt: new Date().toISOString() });
    return kind + '-' + year + '-' + String(n).padStart(6, '0');
  });
};
/* Peek without consuming — for "next number will be …" hints in the UI. */
FDB.peekNumber = function (kind, year, seqCache) {
  year = year || new Date().getFullYear();
  var row = (seqCache || {})[kind + ':' + year];
  return kind + '-' + year + '-' + String(((row && row.n) || 0) + 1).padStart(6, '0');
};

/* ── idempotency (§34) ────────────────────────────────────────────────────
   Every parent transaction claims its client operation id inside its own
   transaction. A double-clicked Save, a retried API call or a replayed
   offline queue therefore cannot produce a second invoice, a second set of
   line items or a second stock deduction — the claim fails and the whole
   transaction rolls back. */
FDB.claimOperation = function (api, opId, entity, meta) {
  return api.get('operations', opId).then(function (existing) {
    if (existing) {
      var err = new Error('This operation has already been saved as ' +
        (existing.ref || existing.entityId || opId) + '.');
      err.duplicate = true;
      err.existing = existing;
      throw err;
    }
    api.put('operations', {
      opId: opId, entity: entity, entityId: (meta && meta.entityId) || '',
      ref: (meta && meta.ref) || '', createdAt: new Date().toISOString(), state: 'applied'
    });
    return true;
  });
};
FDB.releaseOperation = function (api, opId) { api.del('operations', opId); };

/* ── ids ──────────────────────────────────────────────────────────────── */
FDB.uid = function (prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
         Math.random().toString(36).slice(2, 8);
};

/* ── backup / restore (§28 §29) ───────────────────────────────────────── */
FDB.exportAll = function () {
  return FDB.hydrate().then(function (data) {
    return {
      format: 'farooq-co-erp-backup',
      formatVersion: 1,
      appVersion: UPGRADE_VERSION,
      exportedAt: new Date().toISOString(),
      driver: FDB.driver,
      counts: STORE_NAMES.reduce(function (a, n) { a[n] = (data[n] || []).length; return a; }, {}),
      data: data
    };
  });
};
FDB.schemaVersion = function () { return DB_VER; };
/* A hook the integrity layer installs. It sees what a bulk write is about to
   do and may refuse it. */
FDB.bulkGuard = null;
FDB.importAll = function (backup, mode) {          // mode: 'replace' | 'merge'
  if (!backup || backup.format !== 'farooq-co-erp-backup') {
    return Promise.reject(new Error('That file is not a Farooq & Co ERP backup.'));
  }
  var data = backup.data || {};
  var check = FDB.bulkGuard
    ? FDB.bulkGuard({ action: 'restore', mode: mode, incoming: backup.counts || {} })
    : { allowed: true };
  if (check && check.allowed === false) {
    return Promise.reject(Object.assign(new Error(check.reason || 'Blocked by the safety check'),
      { blocked: true, detail: check }));
  }
  return FDB.tx(STORE_NAMES, function (api) {
    var chain = Promise.resolve();
    STORE_NAMES.forEach(function (name) {
      chain = chain.then(function () {
        if (mode === 'replace') {
          return api.all(name).then(function (rows) {
            rows.forEach(function (r) { api.del(name, r[STORES[name].keyPath]); });
          });
        }
      }).then(function () {
        (data[name] || []).forEach(function (rec) { api.put(name, rec); });
      });
    });
    return chain;
  });
};

/* ── adopt whatever the previous build left behind ────────────────────────
   Two shapes are possible in the old `farooqco_erp` database:
     • a `state` store holding one JSON snapshot  → the in-house build
     • the normalised stores of the earlier upgrade → copy them across
   Either way the old database is read, never written and never deleted, so
   the previous build still opens on its own data if it is ever needed.    */
FDB.adoptLegacyDatabase = function () {
  return new Promise(function (resolve) {
    var idb = null;
    try { idb = global.indexedDB; } catch (e) {}
    if (!idb) return resolve({ kind: 'none' });

    function open() {
      var rq;
      try { rq = idb.open(OLD_DB_NAME); }            // no version → never upgrades
      catch (e) { return resolve({ kind: 'none' }); }
      rq.onerror = function () { resolve({ kind: 'none' }); };
      rq.onblocked = function () { resolve({ kind: 'none' }); };
      rq.onsuccess = function (ev) {
        var db = ev.target.result;
        var names = Array.prototype.slice.call(db.objectStoreNames);
        if (!names.length) { try { db.close(); } catch (e) {} return resolve({ kind: 'none' }); }

        if (names.indexOf('state') > -1) {
          var t = db.transaction('state', 'readonly');
          var r = t.objectStore('state').get('current');
          r.onsuccess = function () {
            try { db.close(); } catch (e) {}
            resolve(r.result ? { kind: 'snapshot', snapshot: r.result } : { kind: 'none' });
          };
          r.onerror = function () { try { db.close(); } catch (e) {} resolve({ kind: 'none' }); };
          return;
        }
        if (names.indexOf('invoices') > -1) {
          var want = names.filter(function (n) { return STORE_NAMES.indexOf(n) > -1; });
          var tx = db.transaction(want, 'readonly'), data = {}, left = want.length;
          want.forEach(function (n) {
            var rr = tx.objectStore(n).getAll();
            rr.onsuccess = function () { data[n] = rr.result || []; if (!--left) done(); };
            rr.onerror = function () { data[n] = []; if (!--left) done(); };
          });
          function done() { try { db.close(); } catch (e) {} resolve({ kind: 'stores', records: data }); }
          return;
        }
        try { db.close(); } catch (e) {}
        resolve({ kind: 'none' });
      };
    }

    /* don't create the old database just by looking for it */
    if (idb.databases) {
      idb.databases().then(function (list) {
        var found = (list || []).some(function (d) { return d && d.name === OLD_DB_NAME; });
        if (!found) return resolve({ kind: 'none' });
        open();
      }).catch(open);
    } else open();
  });
};

/* ── one-time migration of the pre-upgrade localStorage record ──────────
   Never destructive: the old key is left exactly where it is (§47).      */
/* Taken the instant this module loads. The app rewrites its own shared
   record on its first repaint, and that rewrite drops the keys only the
   previous build wrote — damaged stock, transfers, adjustments. Reading it
   later is a race; reading it now is not. */
var LEGACY_SNAPSHOT = (function () {
  /* the pre-boot guard took its copy before the app could touch anything */
  var pre = global.FC_PREBOOT;
  if (pre && pre.snapshot) return pre.snapshot;
  try { return JSON.parse(global.localStorage.getItem(LEGACY_LS_KEY) || 'null'); }
  catch (e) { return null; }
})();
FDB.readLegacyBlob = function () {
  var live = null;
  try { live = JSON.parse(global.localStorage.getItem(LEGACY_LS_KEY) || 'null'); }
  catch (e) { live = null; }
  if (!LEGACY_SNAPSHOT) return live;
  if (!live) return LEGACY_SNAPSHOT;
  /* keep whatever the live record has, and add back anything the snapshot
     carried that the rewrite lost */
  Object.keys(LEGACY_SNAPSHOT).forEach(function (k) {
    var v = live[k];
    var empty = v === undefined || v === null ||
      (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
    if (empty) live[k] = LEGACY_SNAPSHOT[k];
  });
  return live;
};

FDB.status = function () {
  return {
    driver: FDB.driver,
    label: FDB.driver === 'indexeddb' ? 'Database connected'
         : FDB.driver === 'localstorage' ? 'Browser storage (limited)'
         : 'Memory only — not saved',
    healthy: FDB.driver === 'indexeddb',
    detail: FDB.driver === 'indexeddb'
      ? 'Records are written to the on-device database and survive restarts.'
      : FDB.driver === 'localstorage'
        ? 'IndexedDB is unavailable, so records go to browser storage. Take regular backups.'
        : 'This browser blocks storage for local files. Work is kept in memory only — export a backup before closing.',
    error: FDB.lastError
  };
};

global.FDB = FDB;
global.Money = Money;
global.FAROOQ_UPGRADE_VERSION = UPGRADE_VERSION;
})(typeof window !== 'undefined' ? window : globalThis);
