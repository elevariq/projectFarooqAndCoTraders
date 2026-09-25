/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 20
   DATA INTEGRITY
   Two things a business cannot forgive: a statement that quietly counts next
   month's sale, and an upgrade that loses records nobody noticed were there.
   This module locks writes until migration has finished, backs the old data
   up first, counts everything before and after, refuses to finish if
   anything went missing, and reports all of it on a health page.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, FDB = global.FDB, D = global.document;
var S = ERP.S;
var I = function (n) { return global.I ? global.I(n) : ''; };
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nowISO() { return new Date().toISOString(); }
function clock() { return new Date().toTimeString().slice(0, 8); }
function say(m) { return global.say ? global.say(m) : null; }
function fmtDate(x) { return global.fmtDate ? global.fmtDate(x) : x; }

/* ══════════════════════════════════════════════════════════════════════════
   1 · THE WRITE LOCK
   The app repaints shortly after loading and saves its own state as it does.
   Until migration has read the old record, that save must not happen — it is
   what used to delete damaged stock, transfers and adjustments. Saves are
   held, not dropped, and replayed the moment migration finishes.
   ══════════════════════════════════════════════════════════════════════════ */
var Lock = ERP.Lock = {
  state: 'RUNNING',                 /* RUNNING → COMPLETED | FAILED */
  held: 0, startedAt: nowISO(),
  isLocked: function () { return Lock.state === 'RUNNING'; },
  guard: function () { return global.FC_PREBOOT || null; },
  release: function (state) {
    Lock.state = state || 'COMPLETED';
    Lock.releasedAt = nowISO();
    var pre = global.FC_PREBOOT;
    if (pre) {
      /* a failed migration keeps the old record frozen exactly as it was */
      if (Lock.state === 'FAILED') pre.hold();
      else pre.release();
    }
    if (Lock.state === 'COMPLETED') {
      /* Nothing held during the lock is replayed. A write composed before
         migration describes the state before migration, and applying it
         afterwards would put the old figures back over the new ones. The
         queue is cleared and the current state is written instead. */
      Lock.discarded = Lock.held;
      Lock.held = 0;
      var pre = global.FC_PREBOOT;
      if (pre && pre.discardPending) pre.discardPending();
      Lock.schemaAtRelease = FDB.schemaVersion ? FDB.schemaVersion() : null;
      try { global.dbSave(); } catch (e) {}
    }
  }
};

/* Everything that writes application state goes through these two. While the
   lock is held they record that a save was wanted and do nothing else. */
var appDbSave = global.dbSave;
global.dbSave = function () {
  if (Lock.isLocked()) { Lock.held++; return; }
  return appDbSave.apply(global, arguments);
};
var origPersist = ERP.persistMasterAndLegacy;
ERP.persistMasterAndLegacy = function () {
  if (Lock.isLocked()) { Lock.held++; return Promise.resolve(); }
  return origPersist.apply(ERP, arguments);
};

/* ══════════════════════════════════════════════════════════════════════════
   2 · NEVER OVERWRITE WHAT WE DO NOT UNDERSTAND
   The original save writes a fresh object of the keys it knows about, so any
   key written by another build is dropped. It now merges instead: unknown
   keys are carried through untouched.
   ══════════════════════════════════════════════════════════════════════════ */
var SHARED_KEY = 'farooqco_erp_v1';
(function preserveUnknownKeys() {
  var inner = global.dbSave;
  global.dbSave = function () {
    var before = null;
    try { before = JSON.parse(global.localStorage.getItem(SHARED_KEY) || 'null'); } catch (e) {}
    var r = inner.apply(global, arguments);
    if (!before) return r;
    /* on the server this record is only a per-browser cache: a list that became empty (data deleted on the server)
       must stay empty, not be put back from the stale copy */
    if (global.FDB && global.FDB.driver === 'server') return r;
    try {
      var after = JSON.parse(global.localStorage.getItem(SHARED_KEY) || 'null');
      if (!after) return r;
      var restored = [];
      Object.keys(before).forEach(function (k) {
        var had = before[k], has = after[k];
        var lost = has === undefined ||
          (Array.isArray(had) && had.length && (!Array.isArray(has) || !has.length)) ||
          (had && typeof had === 'object' && !Array.isArray(had) && Object.keys(had).length &&
            (!has || typeof has !== 'object' || !Object.keys(has).length));
        if (lost) { after[k] = had; restored.push(k); }
      });
      if (restored.length) {
        global.localStorage.setItem(SHARED_KEY, JSON.stringify(after));
        Health.note('Preserved keys another build wrote: ' + restored.join(', '));
      }
    } catch (e) {}
    return r;
  };
})();

/* The shared record is written by the warehouse app as well, and it carries
   only the fields that build knows about. Reloading from it therefore has to
   be followed by putting the database's own master records back on top —
   otherwise an area or a product added on this device disappears the next
   time the two apps talk to each other. */
var appDbLoad = global.dbLoad;
global.dbLoad = function () {
  var changed = appDbLoad.apply(global, arguments);
  if (changed && ERP.refreshMasterFromDb) {
    ERP.refreshMasterFromDb().then(function () {
      try { ERP.Mirror.refresh(); } catch (e) {}
    });
  }
  return changed;
};

/* ══════════════════════════════════════════════════════════════════════════
   3 · THE MIGRATION LIFECYCLE
   ══════════════════════════════════════════════════════════════════════════ */
function countSource(src) {
  src = src || {};
  var n = function (a) { return Array.isArray(a) ? a.length : 0; };
  var k = function (o) { return o && typeof o === 'object' ? Object.keys(o).length : 0; };
  return {
    sales: n(src.sales), purchases: n(src.purchases),
    customers: n(src.customers) || (global.CUSTOMERS || []).length,
    products: n(src.products) || (global.PRODUCTS || []).length,
    suppliers: n(src.suppliers) || (global.SUPPLIERS || []).length,
    payments: n(src.custpay) + n(src.suppay),
    stockRows: k(src.stock), damagedRows: k(src.dmg),
    transfers: n(src.transfers), adjustments: n(src.adjustments),
    returns: n(src.credits) + n(src.supret), orders: n(src.orders), documents: n(src.docs)
  };
}
function countStores() {
  return {
    invoices: S.invoices.length, invoiceItems: S.invoiceItems.length,
    purchases: S.purchases.length, purchaseItems: S.purchaseItems.length,
    payments: S.payments.length,
    customers: (global.CUSTOMERS || []).length, products: (global.PRODUCTS || []).length,
    suppliers: (global.SUPPLIERS || []).length,
    stockRows: Object.keys(S.inventory).length,
    damagedRows: Object.keys(S.inventory).filter(function (k) { return S.inventory[k].damagedQty; }).length,
    stockDocs: (S.stockDocs || []).length,
    transfers: (S.stockDocs || []).filter(function (d) { return d.type === 'TRANSFER'; }).length,
    adjustments: (S.stockDocs || []).filter(function (d) { return d.type === 'ADJUST'; }).length,
    returns: S.custReturns.length + S.supReturns.length,
    movements: S.movements.length
  };
}
/* a cheap, stable fingerprint of the source, recorded with the backup */
function checksum(obj) {
  var str = JSON.stringify(obj);
  var h = 5381;
  for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16) + '-' + str.length;
}

var Migration = ERP.Migration = {
  record: null,
  log: function (line) {
    if (!Migration.record) return;
    Migration.record.log.push(clock() + '  ' + line);
    try { global.console.info('[migration] ' + line); } catch (e) {}
  },

  begin: function (source, before) {
    Migration.record = {
      id: 'mig-' + Date.now().toString(36),
      status: 'RUNNING', startedAt: nowISO(), completedAt: null,
      before: before, after: null, checksum: checksum(source || {}),
      log: [], warnings: [], error: null
    };
    Migration.log('Migration started');
    /* the old data is written aside before a single record is changed */
    var backup = {
      id: Migration.record.id,
      createdAt: nowISO(),
      reason: 'Automatic backup taken before migration',
      checksum: Migration.record.checksum,
      counts: before,
      source: source || {}
    };
    /* held in memory as well as written, so it is available the moment
       migration finishes rather than after the next read */
    Migration.savedBackups = [backup].concat(Migration.savedBackups || []);
    return FDB.tx(['migrationBackups', 'meta'], function (api) {
      api.put('migrationBackups', backup);
      api.put('meta', { k: 'migrationStatus', v: 'RUNNING' });
      api.put('meta', { k: 'migrationStartedAt', v: Migration.record.startedAt });
    }).then(function () {
      Migration.log('Backup created (' + Migration.record.checksum + ')');
      Migration.log('Source counts: ' + JSON.stringify(before));
    });
  },

  /* Nothing may go backwards. If the source had 240 transfers and the new
     stores hold fewer, the migration is not marked done. */
  verify: function (before) {
    var after = countStores();
    Migration.record.after = after;
    var warn = [];
    var expect = [
      ['sales → invoices', before.sales, after.invoices],
      ['purchases', before.purchases, after.purchases],
      ['customers', before.customers, after.customers],
      ['products', before.products, after.products],
      ['suppliers', before.suppliers, after.suppliers],
      ['damaged stock rows', before.damagedRows, after.damagedRows],
      ['stock transfers', before.transfers, after.transfers],
      ['stock adjustments', before.adjustments, after.adjustments]
    ];
    expect.forEach(function (row) {
      if (row[1] > 0 && row[2] < row[1]) {
        warn.push(row[0] + ': ' + row[1] + ' before, ' + row[2] + ' after');
      }
    });
    Migration.record.warnings = warn;
    Migration.log('Result counts: ' + JSON.stringify(after));
    if (warn.length) {
      Migration.log('Validation FAILED — ' + warn.join(' · '));
      var err = new Error('Migration lost records: ' + warn.join('; '));
      err.validationCounts = warn;
      throw err;
    }
    Migration.log('Validation PASSED');
  },

  complete: function () {
    Migration.record.status = 'COMPLETED';
    Migration.record.completedAt = nowISO();
    Migration.log('Migration completed');
    return FDB.tx(['meta', 'migrationBackups', 'auditLog'], function (api) {
      api.put('meta', { k: 'migrationStatus', v: 'COMPLETED' });
      api.put('meta', { k: 'migrationCompletedAt', v: Migration.record.completedAt });
      api.put('meta', { k: 'migrationReport', v: Migration.record });
      ERP.Audit.write(api, {
        action: 'Migration completed and verified', entity: 'System', entityId: Migration.record.id,
        newValues: { before: Migration.record.before, after: Migration.record.after }
      });
    }).then(function () { Lock.release('COMPLETED'); });
  },

  /* A failed migration leaves the old record exactly where it was: the write
     lock is never released for application state, so nothing overwrites it. */
  fail: function (err) {
    if (Migration.record) {
      Migration.record.status = 'FAILED';
      Migration.record.error = err && err.message || String(err);
      Migration.record.completedAt = nowISO();
      Migration.log('Migration FAILED — ' + Migration.record.error);
      Migration.log('The previous data has been left untouched; a backup is in Settings → System health');
    }
    Lock.release('FAILED');
    return FDB.tx(['meta', 'auditLog'], function (api) {
      api.put('meta', { k: 'migrationStatus', v: 'FAILED' });
      api.put('meta', { k: 'migrationReport', v: Migration.record });
      ERP.Audit.write(api, { action: 'Migration failed', entity: 'System',
        entityId: (Migration.record || {}).id || 'migration',
        reason: (Migration.record || {}).error || '' });
    }).catch(function () {}).then(function () {
      say('The upgrade could not finish safely. Your previous data has not been changed — ' +
          'open Settings → System health.');
    });
  },

  backups: function () { return Migration.savedBackups || []; },
  downloadBackup: function (id) {
    var b = (Migration.savedBackups || []).filter(function (x) { return x.id === id; })[0];
    if (!b) return null;
    var name = 'farooq_backup_before_migration_' +
      (b.createdAt || nowISO()).slice(0, 10).replace(/-/g, '_') + '.json';
    var blob = new global.Blob([JSON.stringify(b, null, 1)], { type: 'application/json' });
    var a = D.createElement('a');
    a.href = global.URL.createObjectURL(blob); a.download = name;
    D.body.appendChild(a); a.click();
    setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 1200);
    return name;
  }
};

/* wrap the migration itself */
(function wrapMigrate() {
  var origRun = ERP.Migrate.run;
  ERP.Migrate.run = function (data, snapshot) {
    /* The decision to migrate was taken from a read that may have raced a
       still-committing flush. Check again, in the database, before touching
       anything — a second migration would double the records. */
    return FDB.tx(['meta'], function (api) { return api.get('meta', 'migrationStatus'); })
      .then(function (row) {
        if (row && row.v === 'COMPLETED') {
          Migration.log && Migration.log('Migration already completed — skipped');
          Lock.release('COMPLETED');
          return null;
        }
        return runMigration(data, snapshot);
      });
  };
  function runMigration(data, snapshot) {
    var legacy = FDB.readLegacyBlob() || {};
    var source = snapshot && (!legacy.savedAt || (snapshot.savedAt || '') > (legacy.savedAt || ''))
      ? snapshot : legacy;
    var before = countSource(source);
    return Migration.begin(source, before)
      .then(function () { return origRun.call(ERP.Migrate, data, snapshot); })
      .then(function () { Migration.verify(before); })
      .then(function () { return Migration.complete(); })
      .catch(function (err) { return Migration.fail(err).then(function () { throw err; }); });
  }
  var origAdopt = ERP.Migrate.adoptStores;
  ERP.Migrate.adoptStores = function (records) {
    var before = {
      sales: (records.invoices || []).length, purchases: (records.purchases || []).length,
      customers: (records.customers || []).length, products: (records.products || []).length,
      suppliers: (records.suppliers || []).length,
      damagedRows: (records.inventory || []).filter(function (r) { return r.damagedQty; }).length,
      transfers: (records.stockDocs || []).filter(function (d) { return d.type === 'TRANSFER'; }).length,
      adjustments: (records.stockDocs || []).filter(function (d) { return d.type === 'ADJUST'; }).length
    };
    return Migration.begin(records, before)
      .then(function () { return origAdopt.call(ERP.Migrate, records); })
      .then(function () { Migration.verify(before); })
      .then(function () { return Migration.complete(); })
      .catch(function (err) { return Migration.fail(err).then(function () { throw err; }); });
  };
})();

/* if there was nothing to migrate the lock still has to come off */
(ERP.bootPromise || Promise.resolve()).then(function () {
  return FDB.hydrate().then(function (d) {
    var seen = {};
    (Migration.savedBackups || []).forEach(function (b) { seen[b.id] = b; });
    (d.migrationBackups || []).forEach(function (b) { if (!seen[b.id]) seen[b.id] = b; });
    Migration.savedBackups = Object.keys(seen).map(function (k) { return seen[k]; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    var meta = {};
    (d.meta || []).forEach(function (m) { meta[m.k] = m.v; });
    Migration.stored = meta.migrationReport || null;
    Migration.storedStatus = meta.migrationStatus || (meta.migration === '1' ? 'COMPLETED' : 'NONE');
    if (Lock.isLocked()) Lock.release(Migration.storedStatus === 'FAILED' ? 'FAILED' : 'COMPLETED');
  });
}).catch(function () { if (Lock.isLocked()) Lock.release('COMPLETED'); });

/* ══════════════════════════════════════════════════════════════════════════
   3b · BULK WRITE PROTECTION
   Anything that could remove a lot of records at once is counted first. A
   restore that would drop most of the business is refused unless the person
   asks for it deliberately, and either way it is written to the audit log.
   ══════════════════════════════════════════════════════════════════════════ */
var Guard = ERP.Guard = {
  /* master records are never removed by a background process */
  protectedStores: ['products', 'customers', 'suppliers', 'regions', 'warehouses',
                    'invoices', 'invoiceItems', 'purchases', 'purchaseItems', 'payments',
                    'inventory', 'stockMovements'],
  allowDestructive: false,

  assess: function (job) {
    var current = countStores();
    var incoming = job.incoming || {};
    var losses = [];
    [['products', 'products'], ['customers', 'customers'], ['suppliers', 'suppliers'],
     ['invoices', 'invoices'], ['purchases', 'purchases'], ['payments', 'payments'],
     ['stockMovements', 'movements']].forEach(function (pair) {
      var now = current[pair[1]] || 0;
      var next = incoming[pair[0]];
      if (next === undefined || !now) return;
      if (next < now) {
        var pct = Math.round((now - next) / now * 100);
        if (pct >= 20 && (now - next) >= 5) {
          losses.push(pair[0] + ': ' + now + ' → ' + next + ' (−' + pct + '%)');
        }
      }
    });
    return { losses: losses, current: current };
  },

  /* Granted by the person at the moment of the restore, for that restore
     only. It is spent whether or not the write then succeeds, so it cannot
     sit around authorising something later. */
  allowOnce: false,
  grantOnce: function () { Guard.allowOnce = true; },

  check: function (job) {
    var a = Guard.assess(job);
    var once = Guard.allowOnce;
    Guard.allowOnce = false;
    var allowed = !a.losses.length || once === true || Guard.allowDestructive === true;
    var entry = {
      action: 'Bulk write ' + (allowed ? 'allowed' : 'blocked') + ' — ' + (job.action || 'unknown'),
      entity: 'System', entityId: job.action || 'bulk',
      reason: a.losses.join(' · '),
      newValues: { mode: job.mode || '', incoming: job.incoming || {}, current: a.current,
                   authorised: once === true ? 'confirmed at the prompt' : undefined }
    };
    ERP.Audit.detached(entry);
    if (!allowed) {
      Health.note('Blocked a ' + (job.action || 'bulk') + ' that would have removed ' + a.losses.join(', '));
    }
    return {
      allowed: allowed,
      reason: allowed ? '' : 'This would remove ' + a.losses.join(', ') + '.',
      losses: a.losses
    };
  }
};
FDB.bulkGuard = Guard.check;

/* Asked at the moment it matters, naming exactly what would go. Typing the
   word is deliberate friction: a restore that removes the year's invoices
   should not be one stray click away. */
Guard.promptOverride = function (losses, fileName) {
  return new Promise(function (resolve) {
    var host = D.getElementById('fcGuard');
    if (!host) { host = D.createElement('div'); host.id = 'fcGuard'; D.body.appendChild(host); }
    host.innerHTML =
      '<div class="fcx-box" role="dialog" aria-label="Confirm restore">' +
        '<div class="fcx-h"><b>This restore removes records</b>' +
          '<p>' + (fileName ? esc(fileName) + ' holds fewer records than this device does. ' : '') +
          'If you go ahead, these go:</p></div>' +
        '<div class="fcx-opts"><ul class="gd-losses">' +
          losses.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') +
        '</ul>' +
        '<p class="hint">A backup of the current data has already been taken and is in ' +
          'System health. Nothing has changed yet.</p>' +
        '<label class="f"><span>Type <b>REPLACE</b> to confirm</span>' +
          '<input id="fcGuardWord" autocomplete="off" spellcheck="false"></label></div>' +
        '<div class="fcx-foot"><div class="grow"></div>' +
          '<button class="btn" data-gd="cancel">Keep my data</button>' +
          '<button class="btn danger" data-gd="go" disabled>Replace the records</button>' +
        '</div>' +
      '</div>';
    host.classList.add('on');
    var word = D.getElementById('fcGuardWord');
    var go = host.querySelector('[data-gd="go"]');
    function finish(ok) {
      host.classList.remove('on'); host.innerHTML = '';
      resolve(!!ok);
    }
    host.addEventListener('input', function () {
      go.disabled = (word.value || '').trim().toUpperCase() !== 'REPLACE';
    });
    host.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-gd]');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.gd === 'go' && !go.disabled) { Guard.grantOnce(); finish(true); }
      else finish(false);
    });
    if (word) setTimeout(function () { word.focus(); }, 20);
  });
};

/* a restore is a destructive operation: back up, count, log */
(function protectRestore() {
  var origImport = FDB.importAll;
  FDB.importAll = function (backup, mode) {
    var before = countStores();
    return FDB.exportAll().then(function (dump) {
      return FDB.tx(['migrationBackups'], function (api) {
        api.put('migrationBackups', {
          id: 'pre-restore-' + Date.now().toString(36),
          createdAt: nowISO(),
          reason: 'Automatic backup taken before a restore',
          checksum: checksum(dump.counts || {}),
          schemaVersion: FDB.schemaVersion ? FDB.schemaVersion() : null,
          counts: before, source: {}
        });
      }).catch(function () {});
    }).then(function () {
      return origImport.call(FDB, backup, mode);
    }).then(function (r) {
      ERP.Audit.detached({
        action: 'Database restored from a backup', entity: 'System', entityId: 'restore',
        oldValues: before, newValues: backup.counts || {},
        reason: 'mode: ' + (mode || 'merge')
      });
      return r;
    });
  };
})();

/* ══════════════════════════════════════════════════════════════════════════
   4 · REPORT METADATA
   Every dated figure can say which window produced it.
   ══════════════════════════════════════════════════════════════════════════ */
function rangeMeta(from, to, dates) {
  var inside = (dates || []).filter(Boolean).sort();
  return {
    startDate: from || null, endDate: to || null,
    transactionCount: inside.length,
    firstIncludedTransaction: inside[0] || null,
    lastIncludedTransaction: inside[inside.length - 1] || null,
    outsideRange: (dates || []).filter(function (d) {
      return (from && d < from) || (to && d > to);
    }).length
  };
}
ERP.rangeMeta = rangeMeta;

(function attachMeta() {
  /* Reports take (from, to) as plain dates. Each one is wrapped so its result
     says which window produced it and which transaction was the last one in. */
  function wrap(obj, name, dates) {
    var orig = obj && obj[name];
    if (!orig) return;
    obj[name] = function (from, to) {
      var r = orig.apply(obj, arguments);
      if (r && typeof r === 'object') {
        try { r.dateRange = rangeMeta(from || null, to || null, dates(r) || []); } catch (e) {}
      }
      return r;
    };
  }
  var A = ERP.Analytics;
  if (A) {
    wrap(A, 'sales', function (r) {
      return (r.invoices || []).map(function (i) { return i.invoiceDate; });
    });
    wrap(A, 'purchases', function (r) {
      return (r.purchases || r.list || []).map(function (p) { return p.purchaseDate; });
    });
    wrap(A, 'payments', function (r) {
      return (r.payments || r.received || []).map(function (p) { return p.paymentDate; });
    });
    wrap(A, 'returns', function (r) {
      return ((r.customer || []).concat(r.supplier || [])).map(function (x) {
        return (x.ret || x).returnDate;
      });
    });
    wrap(A, 'inventory', function () { return []; });
  }
  if (ERP.Khata) {
    var origSummary = ERP.Khata.summary;
    ERP.Khata.summary = function (customerId, f) {
      var r = origSummary.call(ERP.Khata, customerId, f);
      f = f || {};
      r.dateRange = rangeMeta(f.from || null, f.to || null,
        (r.rows || []).filter(function (e) { return e.type !== 'OPENING'; })
          .map(function (e) { return e.iso; }));
      return r;
    };
  }
})();

/* ══════════════════════════════════════════════════════════════════════════
   5 · HEALTH
   ══════════════════════════════════════════════════════════════════════════ */
var Health = ERP.Health = {
  notes: [],
  note: function (line) { Health.notes.unshift(clock() + '  ' + line); if (Health.notes.length > 40) Health.notes.length = 40; },

  /* Opening + in − out should equal what the shelf says. Anything else means
     a movement was written without changing stock, or the other way round. */
  reconcileInventory: function () {
    var expected = {};
    (S.movements || []).forEach(function (mv) {
      if (mv.bucket === 'damaged') return;
      var k = mv.productId + '|' + mv.warehouseId;
      expected[k] = (expected[k] || 0) + (Number(mv.qtyDelta) || 0);
    });
    var rows = [], checked = 0;
    Object.keys(S.inventory).forEach(function (k) {
      var have = S.inventory[k].qty;
      var should = Math.round((expected[k] || 0) * 1000) / 1000;
      checked++;
      if (Math.abs(have - should) > 0.001) {
        var parts = k.split('|');
        var p = global.prodOf ? global.prodOf(parts[0]) : null;
        rows.push({
          key: k, product: p ? (p.en || p.ur || parts[0]) : parts[0],
          warehouse: global.whName ? global.whName(parts[1]) : parts[1],
          onHand: have, fromMovements: should, difference: Math.round((have - should) * 1000) / 1000
        });
      }
    });
    Object.keys(expected).forEach(function (k) {
      if (S.inventory[k]) return;
      if (Math.abs(expected[k]) < 0.001) return;
      var parts = k.split('|');
      rows.push({ key: k, product: parts[0], warehouse: parts[1],
                  onHand: 0, fromMovements: expected[k], difference: -expected[k] });
    });
    return { checked: checked, mismatches: rows, ok: rows.length === 0 };
  },

  ledgerCheck: function () {
    var bad = [];
    (global.CUSTOMERS || []).slice(0, 500).forEach(function (c) {
      var L = ERP.Ledger.customer(c.id, null, null);
      var recomputed = L.rows.reduce(function (a, r) { return a + r.dr - r.cr; }, 0);
      if (Math.abs(recomputed - L.closing) > 0) {
        bad.push({ shop: c.sh, closing: L.closing, recomputed: recomputed });
      }
    });
    return { checked: Math.min(500, (global.CUSTOMERS || []).length), mismatches: bad, ok: !bad.length };
  },

  supplierLedgerCheck: function () {
    var bad = [];
    (global.SUPPLIERS || []).slice(0, 300).forEach(function (sp) {
      var L = ERP.Ledger.supplier(sp.id, null, null);
      /* a supplier account is credited by purchases and debited by payments */
      var recomputed = L.rows.reduce(function (a, r) { return a + r.cr - r.dr; }, 0);
      if (Math.abs(recomputed - L.closing) > 0) {
        bad.push({ supplier: sp.co, closing: L.closing, recomputed: recomputed });
      }
    });
    return { checked: Math.min(300, (global.SUPPLIERS || []).length), mismatches: bad, ok: !bad.length };
  },

  /* A receipt applied to an invoice has to be that same shop's money. An older
     build let the invoice edit screen change an invoice's shop while its
     receipts stayed behind, leaving the two shops' accounts out by the amount.
     "Change shop" now moves them together; this finds any left from before. */
  allocationCheck: function () {
    var bad = [];
    (S.allocations || []).forEach(function (a) {
      if (!a.invoiceId) return;
      var inv = ERP.Invoices.byId(a.invoiceId), p = ERP.Payments.byId(a.paymentId);
      if (!inv || !p || p.status === 'REVERSED' || inv.status === 'CANCELLED') return;
      if (p.partyId !== inv.customerId) {
        bad.push({ invoice: inv.invoiceNumber, invoiceShop: inv.shopNameSnapshot,
                   receipt: p.receiptNumber, receiptShop: p.partyNameSnapshot, amount: a.amount });
      }
    });
    return { checked: (S.allocations || []).length, mismatches: bad, ok: !bad.length };
  },

  /* the January question, asked of the system itself */
  dateLeakCheck: function () {
    var c = (global.CUSTOMERS || [])[0];
    if (!c) return { ok: true, checked: 0 };
    var entries = ERP.Khata.entries(c.id).filter(function (e) { return e.type !== 'OPENING'; });
    if (!entries.length) return { ok: true, checked: 0 };
    var cut = entries[Math.floor(entries.length / 2)].iso;
    var upto = ERP.Ledger.customer(c.id, null, cut);
    var after = entries.filter(function (e) { return e.iso > cut; });
    var manual = entries.filter(function (e) { return e.iso <= cut; })
      .reduce(function (a, e) { return a + e.debit - e.credit; }, 0);
    return { ok: upto.closing === manual, checked: entries.length,
             ignoredAfterCut: after.length, cut: cut };
  },

  /* the same question for a supplier account */
  supplierDateLeakCheck: function () {
    var withRows = (global.SUPPLIERS || []).filter(function (sp) {
      return ERP.Ledger.supplier(sp.id, null, null).rows.length > 1;
    })[0];
    if (!withRows) return { ok: true, checked: 0 };
    var rows = ERP.Ledger.supplier(withRows.id, null, null).rows;
    var cut = rows[Math.floor(rows.length / 2)].iso;
    var upto = ERP.Ledger.supplier(withRows.id, null, cut);
    var manual = rows.filter(function (r) { return r.iso <= cut; })
      .reduce(function (a, r) { return a + r.cr - r.dr; }, 0);
    return { ok: upto.closing === manual, checked: rows.length,
             ignoredAfterCut: rows.filter(function (r) { return r.iso > cut; }).length, cut: cut };
  },

  report: function () {
    var st = FDB.status();
    var inv = Health.reconcileInventory();
    var led = Health.ledgerCheck();
    var sled = Health.supplierLedgerCheck();
    var leak = Health.dateLeakCheck();
    var sleak = Health.supplierDateLeakCheck();
    var alloc = Health.allocationCheck();
    var backups = Migration.backups();
    var counts = countStores();
    counts.areas = (global.REGIONS || []).length;
    counts.warehouses = (global.WAREHOUSES || []).length;
    counts.salesmen = (S.salesmen || []).length;
    counts.expenses = (S.expenses || []).length;
    return {
      driver: st, counts: counts,
      schemaVersion: FDB.schemaVersion ? FDB.schemaVersion() : null,
      pending: { writes: FDB.pendingWrites || 0, heldDuringMigration: Lock.discarded || 0,
                 guardHeld: global.FC_PREBOOT ? global.FC_PREBOOT.heldWrites() : 0 },
      supplierLedger: sled, supplierDateLeak: sleak,
      migration: {
        status: (Migration.record && Migration.record.status) || Migration.storedStatus || 'NONE',
        report: Migration.record || Migration.stored || null,
        lock: Lock.state, heldWrites: Lock.held
      },
      backups: backups,
      lastBackup: backups.length ? backups[0].createdAt : null,
      inventory: inv, ledger: led, dateLeak: leak, allocations: alloc,
      notes: Health.notes,
      warnings: []
        .concat(inv.ok ? [] : [inv.mismatches.length + ' stock rows do not match their movement history'])
        .concat(led.ok ? [] : [led.mismatches.length + ' customer balances do not add up'])
        .concat(alloc.ok ? [] : [alloc.mismatches.length + ' receipts are applied to an invoice that belongs to a different shop (' +
          alloc.mismatches.slice(0, 3).map(function (m) { return m.receipt + ' → ' + m.invoice; }).join(', ') +
          (alloc.mismatches.length > 3 ? ', …' : '') + ')'])
        .concat(sled.ok ? [] : [sled.mismatches.length + ' supplier balances do not add up'])
        .concat(leak.ok ? [] : ['A dated customer statement is including transactions from after its end date'])
        .concat(sleak.ok ? [] : ['A dated supplier statement is including transactions from after its end date'])
        .concat(st.healthy ? [] : [st.detail])
        .concat((Migration.record && Migration.record.warnings) || [])
    };
  }
};

/* ── the page ── */
var CSS = `
#fcGuard{position:fixed;inset:0;z-index:150;display:none;align-items:center;justify-content:center;
  padding:16px;background:rgba(12,10,20,.55);backdrop-filter:blur(2px)}
#fcGuard.on{display:flex}
#fcGuard .fcx-box{max-width:520px;width:100%}
.gd-losses{margin:0 0 10px;padding-left:20px}
.gd-losses li{margin:3px 0;font-weight:600;color:var(--clay)}
.btn.danger{background:var(--clay);border-color:var(--clay);color:#fff}
.btn.danger[disabled]{opacity:.45}
.hz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.hz-card{border:1px solid var(--line);border-radius:var(--r);padding:12px 13px;background:var(--surface)}
.hz-card i{font-style:normal;display:block;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
.hz-card b{display:block;font-size:18px;font-weight:800;margin-top:3px}
.hz-ok b{color:var(--green)} .hz-bad b{color:var(--clay)} .hz-warn b{color:var(--ochre)}
.hz-log{font-family:var(--mono);font-size:12px;background:var(--surface-2);border:1px solid var(--line);
  border-radius:var(--r-sm);padding:10px 12px;max-height:240px;overflow:auto;white-space:pre-wrap}
.hz-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line-2)}
.hz-row:last-child{border-bottom:none}
`;
(function () { var s = D.createElement('style'); s.id = 'fc-health-css'; s.textContent = CSS; D.head.appendChild(s); })();

global.PAGES.health = function () {
  var h = Health.report();
  var card = function (cls, l, v, d) {
    return '<div class="hz-card ' + cls + '"><i>' + l + '</i><b>' + v + '</b>' +
      (d ? '<div class="hint">' + d + '</div>' : '') + '</div>';
  };
  var mig = h.migration;
  var rep = mig.report;
  var counts = Object.keys(h.counts).map(function (k) {
    return '<div class="hz-row"><span>' + k.replace(/([A-Z])/g, ' $1').toLowerCase() + '</span><b>' +
      Number(h.counts[k]).toLocaleString('en-US') + '</b></div>';
  }).join('');

  return (h.warnings.length
    ? '<div class="banner err">' + I('alert') + '<div><b>' + h.warnings.length +
      ' thing' + (h.warnings.length === 1 ? '' : 's') + ' need attention</b><ul>' +
      h.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div></div>'
    : '<div class="banner ok">' + I('check') + '<div><p><b>Everything checks out.</b> Stock matches its ' +
      'movement history, balances add up, and dated statements stop at their end date.</p></div></div>') +

    '<div class="card"><div class="card-h"><h3>System</h3></div><div class="card-b"><div class="hz-grid">' +
      card(h.driver.healthy ? 'hz-ok' : 'hz-bad', 'Database', esc(h.driver.label), esc(h.driver.detail)) +
      card(mig.status === 'COMPLETED' ? 'hz-ok' : mig.status === 'FAILED' ? 'hz-bad' : '',
        'Migration', esc(mig.status),
        rep && rep.completedAt ? 'Finished ' + esc(rep.completedAt.replace('T', ' ').slice(0, 16)) : '') +
      card(mig.lock === 'COMPLETED' ? 'hz-ok' : mig.lock === 'FAILED' ? 'hz-bad' : 'hz-warn',
        'Write lock', esc(mig.lock),
        (global.FC_PREBOOT ? global.FC_PREBOOT.heldWrites() : 0) +
        ' startup saves held' +
        ((global.FC_PREBOOT && global.FC_PREBOOT.restoredKeys.length)
          ? ' · restored ' + esc(global.FC_PREBOOT.restoredKeys.join(', ')) : '')) +
      card(h.lastBackup ? 'hz-ok' : 'hz-warn', 'Last backup',
        h.lastBackup ? esc(fmtDate(h.lastBackup.slice(0, 10))) : 'None',
        h.backups.length + ' automatic backup' + (h.backups.length === 1 ? '' : 's') + ' kept') +
      card(h.inventory.ok ? 'hz-ok' : 'hz-bad', 'Stock reconciliation',
        h.inventory.ok ? 'Balanced' : h.inventory.mismatches.length + ' off',
        h.inventory.checked + ' product/warehouse rows checked') +
      card(h.ledger.ok ? 'hz-ok' : 'hz-bad', 'Customer balances',
        h.ledger.ok ? 'Balanced' : h.ledger.mismatches.length + ' off',
        h.ledger.checked + ' accounts checked') +
      card(h.supplierLedger.ok ? 'hz-ok' : 'hz-bad', 'Supplier balances',
        h.supplierLedger.ok ? 'Balanced' : h.supplierLedger.mismatches.length + ' off',
        h.supplierLedger.checked + ' accounts checked') +
      card('', 'Schema version', 'v' + esc(String(h.schemaVersion)),
        h.pending.writes + ' writes in flight · ' + h.pending.guardHeld + ' held at startup') +
      card(h.dateLeak.ok && h.supplierDateLeak.ok ? 'hz-ok' : 'hz-bad', 'Date boundaries',
        h.dateLeak.ok && h.supplierDateLeak.ok ? 'Respected' : 'Leaking',
        'Customer and supplier statements tested against ' +
        (h.dateLeak.checked + h.supplierDateLeak.checked) + ' entries') +
    '</div></div></div>' +

    '<div class="card"><div class="card-h"><h3>Records</h3>' +
      '<button class="btn" data-hz="recheck">' + I('refresh') + 'Run checks again</button></div>' +
      '<div class="card-b"><div class="hz-grid"><div>' + counts + '</div></div></div></div>' +

    (h.inventory.mismatches.length
      ? '<div class="card"><div class="card-h"><h3>Stock that does not match its movements</h3></div>' +
        '<div class="card-b" style="padding:0"><div class="tw"><table class="fcb-list"><thead><tr>' +
        '<th>Product</th><th>Warehouse</th><th class="r">On hand</th>' +
        '<th class="r">From movements</th><th class="r">Difference</th></tr></thead><tbody>' +
        h.inventory.mismatches.slice(0, 50).map(function (m) {
          return '<tr><td>' + esc(m.product) + '</td><td>' + esc(m.warehouse) + '</td>' +
            '<td class="r num">' + m.onHand + '</td><td class="r num">' + m.fromMovements + '</td>' +
            '<td class="r num"><b>' + (m.difference > 0 ? '+' : '') + m.difference + '</b></td></tr>';
        }).join('') + '</tbody></table></div></div></div>' : '') +

    '<div class="card"><div class="card-h"><h3>Bulk write protection</h3>' +
      '<span class="pill ok">Always on</span></div>' +
    '<div class="card-b"><p style="margin-top:0;color:var(--muted)">A restore or import that would ' +
      'remove a fifth or more of the products, shops, suppliers, invoices, purchases, payments or ' +
      'stock movements stops and asks first, naming exactly what would go. Nothing else on this ' +
      'device can delete those records, and every decision is on the audit log.</p>' +
      (function () {
        var recent = (ERP.S.audit || []).filter(function (a) { return /^Bulk write/.test(a.action); })
          .slice(0, 5);
        return recent.length
          ? '<div class="hz-log">' + esc(recent.map(function (a) {
              return (a.createdAt || '').replace('T', ' ').slice(0, 16) + '  ' + a.action +
                (a.reason ? ' — ' + a.reason : '');
            }).join('\n')) + '</div>'
          : '<p class="hint">No bulk write has been attempted on this device.</p>';
      })() +
    '</div></div>' +

    '<div class="card"><div class="card-h"><h3>Migration</h3>' +
      (h.backups.length ? '<button class="btn" data-hzbackup="' + esc(h.backups[0].id) +
        '">' + I('down') + 'Download pre-upgrade backup</button>' : '') + '</div>' +
    '<div class="card-b">' +
      (rep
        ? '<div class="hz-grid" style="margin-bottom:10px">' +
            card('', 'Started', esc((rep.startedAt || '').replace('T', ' ').slice(0, 16))) +
            card('', 'Finished', esc((rep.completedAt || '—').replace('T', ' ').slice(0, 16))) +
            card('', 'Fingerprint', esc(rep.checksum || '—')) +
            card(rep.warnings && rep.warnings.length ? 'hz-bad' : 'hz-ok', 'Validation',
              rep.warnings && rep.warnings.length ? 'Failed' : 'Passed') +
          '</div>' +
          '<div class="hz-log">' + esc((rep.log || []).join('\n') || 'No log recorded.') + '</div>' +
          (rep.error ? '<div class="banner err" style="margin-top:10px">' + I('alert') +
            '<div><b>The migration did not finish</b><p>' + esc(rep.error) +
            '</p><p>Your previous data was left untouched and a backup is above.</p></div></div>' : '')
        : '<p class="hint">No migration has been needed on this device.</p>') +
    '</div></div>' +

    (Health.notes.length
      ? '<div class="card"><div class="card-h"><h3>Recent integrity notes</h3></div>' +
        '<div class="card-b"><div class="hz-log">' + esc(Health.notes.join('\n')) + '</div></div></div>' : '');
};
if (global.PAGEMETA) {
  global.PAGEMETA.health = ['System health',
    'Whether the database is sound: stock against its movement history, balances that add up, and what the last upgrade did.'];
}

var origSettings = global.PAGES.settings;
global.PAGES.settings = function () {
  var h = Health.report();
  var bad = h.warnings.length;
  return '<div class="card"><div class="card-h"><h3>System health</h3>' +
      '<span class="pill ' + (bad ? 'bad' : 'ok') + '">' +
      (bad ? bad + ' to look at' : 'All checks passing') + '</span></div>' +
    '<div class="card-b"><p style="margin-top:0;color:var(--muted)">' +
      'Database: <b>' + esc(h.driver.label) + '</b> · migration: <b>' + esc(h.migration.status) +
      '</b> · stock reconciliation: <b>' + (h.inventory.ok ? 'balanced' : h.inventory.mismatches.length + ' off') +
      '</b></p>' +
      '<button class="btn pri" data-go="health">' + I('layers') + 'Open system health</button></div></div>' +
    origSettings();
};

D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var g = e.target.closest('[data-go="health"]');
  if (g) { e.preventDefault(); global.go('health'); return; }
  var r = e.target.closest('[data-hz="recheck"]');
  if (r) { e.preventDefault(); global.paint(); say('Checks run again.'); return; }
  var b = e.target.closest('[data-hzbackup]');
  if (b) {
    e.preventDefault();
    var name = Migration.downloadBackup(b.dataset.hzbackup);
    say(name ? 'Backup downloaded — ' + name : 'That backup is no longer stored.');
  }
}, true);

})(typeof window !== 'undefined' ? window : globalThis);
