/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 1b
   THE SERVER DRIVER  ·  FDB on the company's MySQL database

   01-db.js keeps the business data in this browser's IndexedDB. This module lets the SAME FDB
   interface (open / hydrate / tx / nextNumber / exportAll …) run on the server instead, so
   nothing above it — 02-services and every screen — changes. Which one is used is decided by the
   server: `data_backend` in private/erp-config.php ('browser' is the default and the kill-switch).

   THE RULES THAT MAKE IT SAFE (read before changing anything here)
   1. Never guess. If the switch says "server" and the server cannot be reached at start-up, the
      screen says so and stops — it must NEVER fall back to this browser's old local copy, which
      would quietly split the books in two. (`farooqco_backend=server` in localStorage remembers that
      this browser has run on the server, so even a failed status call cannot fall back.)
   2. Every save is ONE atomic commit, and says which revision of each record it was based on. Loaded
      records carry their revision in an invisible property (`__r`, non-enumerable — it never reaches
      JSON, exports or the database). If someone else saved that record first the server refuses the
      WHOLE save and nothing is written: a save can never silently overwrite another user's change.
   3. The services edit their in-memory copy (`S`) INSIDE the transaction body, before the commit. So a
      failed commit can leave the screen showing something that was not saved. Therefore a failed
      commit is never retried quietly: a blocking notice tells the user and offers "Reload", which
      rebuilds everything from the server. (A refused save is rare: two people editing the same record.)
   4. Per-browser values that happen to live in shared records (`meta.sessionUserId`, `lastSaveAt`,
      `appVersion`, `adoptedFrom`) stay in THIS browser; they never go to the server.
   5. The invoice/receipt counters are re-read from the server at the start of every save, so two
      users never take the same number (the database also has UNIQUE indexes as a second wall).
   6. Restoring a backup from a browser is disabled in server mode (it would replace everyone's data);
      the administrator does that on the server with scripts/import-backup.php.
   7. Saving what the server already holds is NOT a change and is never sent. 02-services re-saves ALL master
      data after start-up and after ordinary repaints (ERP.persistMasterAndLegacy); without this, every page
      load would rewrite ~600 records, bump the shared change counter (everyone sees "Someone else has saved")
      and collide with other users. Records are compared by content, ignoring key order, and ignoring the
      roll-ups Mirror.refresh recomputes from the ledgers on every refresh (DERIVED: shop bal/tot, supplier
      due/paid). Found by test-server-db.mjs (G1–G5) — do not remove without re-running them.
   8. The original screens' whole-list scratch state (`legacy`, `documents` stores) is saved last-writer-wins
      (no revision check): it is a snapshot, not a transaction, and a routine repaint must never raise a
      "NOT saved" error. Real business records keep the strict revision check.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var FDB = global.FDB;
if (!FDB || !FDB.STORES) return;

var API = 'api/data/';
var STICKY_KEY = 'farooqco_backend';
var LOCAL_META_KEY = 'farooqco_local_meta';
var PER_BROWSER_META = { sessionUserId: 1, lastSaveAt: 1, appVersion: 1, adoptedFrom: 1 };
var HOT_STORES = ['sequences'];
/* The original screens keep some state as whole-list snapshots that 02-services re-saves after ordinary
   repaints (ERP.persistMasterAndLegacy -> the `legacy` and `documents` stores). Those are scratch state,
   not transactions: they are written last-writer-wins so a routine repaint can never raise a conflict. */
var SNAPSHOT_STORES = { legacy: 1, documents: 1 };
/* Roll-ups that Mirror.refresh (02-services) recomputes from the ledgers on EVERY refresh and then re-saves inside the
   shared shop / supplier records. They are not data — every browser recomputes them — so a record that differs only in
   these is "unchanged". (Otherwise each routine save would bump the version and clash with other users.) */
var DERIVED = { customers: ['bal', 'tot'], suppliers: ['due', 'paid'] };
function core(store, obj) {
  var d = DERIVED[store]; if (!d || !obj || typeof obj !== 'object') return obj;
  var c = {}; Object.keys(obj).forEach(function (k) { if (d.indexOf(k) < 0) c[k] = obj[k]; }); return c;
}
var POLL_MS = 15000;
var REQUEST_MS = 20000;

var SD = FDB.server = {
  active: false,        /* true once this page runs on the server database */
  csrf: null,
  version: 0,           /* the server's change counter as of our last own commit / load */
  seenVersion: 0,       /* the newest counter we have heard of */
  stale: false,         /* somebody else has saved since we loaded */
  failed: null,         /* the error of a commit that did not go through (blocks further saves) */
  cache: {},            /* store -> key -> { r: revision, t: JSON text, own: bool } */
  loaded: false,
  requests: 0
};

/* ── small helpers ─────────────────────────────────────────────────────── */
function J(v) { return JSON.stringify(v); }
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function tag(obj, rev) {
  try { Object.defineProperty(obj, '__r', { value: rev, writable: true, configurable: true, enumerable: false }); } catch (e) {}
  return obj;
}
function idOf(s, k) { return s + '\u0000' + k; }
/* same content, whatever the key order (the app merges embedded and stored fields, so the order can differ) */
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  var aa = Array.isArray(a), ba = Array.isArray(b);
  if (aa !== ba) return false;
  if (aa) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false; return true; }
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var j = 0; j < ka.length; j++) { var k = ka[j]; if (!Object.prototype.hasOwnProperty.call(b, k) || !same(a[k], b[k])) return false; }
  return true;
}
function keyPathOf(store) { return FDB.STORES[store].keyPath; }
function store_(s) { return SD.cache[s] || (SD.cache[s] = {}); }
function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { global.localStorage.removeItem(k); } catch (e) {} }

/* per-browser meta keys (rule 4) */
function localMeta() { try { return JSON.parse(lsGet(LOCAL_META_KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveLocalMeta(o) { lsSet(LOCAL_META_KEY, J(o)); }

/* ── HTTP ──────────────────────────────────────────────────────────────── */
function request(path, opts) {
  opts = opts || {};
  if (typeof global.fetch !== 'function') return Promise.reject(Object.assign(new Error('fetch unavailable'), { network: true }));
  var headers = { 'Accept': 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.method === 'POST' && SD.csrf) headers['X-CSRF-Token'] = SD.csrf;
  var o = { method: opts.method || 'GET', credentials: 'same-origin', headers: headers, cache: 'no-store' };
  if (opts.body !== undefined) o.body = opts.body;
  try { if (global.AbortSignal && global.AbortSignal.timeout) o.signal = global.AbortSignal.timeout(opts.timeout || REQUEST_MS); } catch (e) {}
  SD.requests++;
  return global.fetch(API + path, o).then(function (res) {
    return res.text().then(function (txt) {
      var data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
      return { status: res.status, data: data };
    });
  }, function (e) { throw Object.assign(new Error('Cannot reach the server (' + (e && e.message || 'network') + ').'), { network: true }); });
}

/* ── notices: blocking (boot / failed save) and non-blocking (stale) ──────── */
function overlay(id, title, body, buttons, blocking) {
  var D = global.document; if (!D || !D.body) return;
  var old = D.getElementById(id); if (old) old.parentNode.removeChild(old);
  var el = D.createElement('div'); el.id = id;
  el.setAttribute('role', 'alertdialog');
  el.style.cssText = blocking
    ? 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,Segoe UI,Arial,sans-serif'
    : 'position:fixed;left:0;right:0;bottom:0;z-index:2147482000;background:#0f766e;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;font:14px system-ui,Segoe UI,Arial,sans-serif';
  var btns = (buttons || []).map(function (b, i) {
    return '<button type="button" data-fcsd="' + i + '" style="' + (blocking
      ? 'padding:10px 18px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-size:15px;cursor:pointer;margin-top:14px;margin-right:8px'
      : 'padding:6px 14px;border:0;border-radius:6px;background:#fff;color:#0f766e;font-size:14px;cursor:pointer') + '">' + esc(b.label) + '</button>';
  }).join('');
  el.innerHTML = blocking
    ? '<div style="background:#fff;color:#0f172a;max-width:460px;width:100%;border-radius:14px;padding:22px 24px;box-shadow:0 20px 50px rgba(0,0,0,.35)">' +
        '<h2 style="margin:0 0 8px;font-size:19px">' + esc(title) + '</h2><p style="margin:0;line-height:1.5;font-size:15px">' + esc(body) + '</p>' + btns + '</div>'
    : '<span><b>' + esc(title) + '</b> ' + esc(body) + '</span>' + btns;
  D.body.appendChild(el);
  Array.prototype.forEach.call(el.querySelectorAll('[data-fcsd]'), function (btn) {
    btn.addEventListener('click', function () { buttons[+btn.getAttribute('data-fcsd')].run(); });
  });
  return el;
}
function reload() { try { global.location.reload(); } catch (e) {} }
function blockBoot(title, msg) {
  SD.bootBlocked = { title: title, message: msg };
  /* the DOM may not be parsed yet when the app starts — wait for it rather than lose the message */
  var show = function () { overlay('fcsd-boot', title, msg, [{ label: 'Try again', run: reload }], true); };
  if (global.document && global.document.body) show();
  else if (global.document) global.document.addEventListener('DOMContentLoaded', show);
  return new Promise(function () {});          /* never resolves: the app must not start on nothing */
}
function showStale() {
  if (!SD.stale) return;
  overlay('fcsd-stale', 'Someone else has saved changes.', 'Refresh to see them before you continue.',
    [{ label: 'Refresh now', run: reload }], false);
}
function commitFailed(err) {
  SD.failed = err;
  var why = err.conflict
    ? 'Someone else changed the same record just before you, so nothing was saved. Reload to see the latest data, then repeat your change.'
    : err.duplicate
      ? 'That document number was taken by another user a moment ago, so nothing was saved. Reload and try again.'
      : err.network
        ? 'The connection to the server was lost while saving, so it is not certain that your change was saved. Reload to see what the server has.'
        : (err.message || 'The server did not accept the change.') + ' Reload to see what the server has.';
  overlay('fcsd-failed', 'Your last change was NOT saved', why, [{ label: 'Reload', run: reload }], true);
}

/* ── which backend? (rule 1) ───────────────────────────────────────────── */
var decision = null;
function decide() {
  if (decision) return decision;
  var sticky = lsGet(STICKY_KEY) === 'server';
  var proto = ''; try { proto = global.location.protocol; } catch (e) {}
  if (typeof global.fetch !== 'function' || proto === 'file:') {
    decision = Promise.resolve(sticky ? blockBoot('This program needs a browser that can reach the server', 'Open it from the company website in an up-to-date browser.') : 'browser');
    return decision;
  }
  decision = request('status.php', { timeout: 6000 }).then(function (res) {
    var d = res.data || {};
    if (res.status === 200 && d.backend === 'server') {
      if (d.available === false) return blockBoot('The server database is not reachable', 'Nothing was loaded, so nothing can be lost. Check the connection and try again.');
      if (d.empty) return blockBoot('The server database is empty', 'Start-up was stopped so nothing is created by mistake. The administrator must import the company data first.');
      SD.csrf = d.csrf || null; SD.version = SD.seenVersion = d.version || 0;
      return 'server';
    }
    if (res.status === 200) { lsDel(STICKY_KEY); return 'browser'; }            /* the switch is off: data stays in this browser */
    if (sticky) return blockBoot('Please sign in again', 'The server did not accept this session. Reload the page and sign in.');
    return 'browser';                                                        /* not signed in / no server API (local or file use) */
  }, function (e) {
    if (sticky) return blockBoot('Cannot reach the server', 'Your data lives on the company server, so the program cannot start without it. Nothing is lost. Check the internet connection and try again.');
    return 'browser';
  });
  return decision;
}

/* ── loading ───────────────────────────────────────────────────────────── */
function load(data) {
  var cache = {};
  FDB.STORE_NAMES.forEach(function (s) { cache[s] = {}; });
  var stores = (data && data.stores) || {};
  Object.keys(stores).forEach(function (s) {
    if (!cache[s]) return;
    (stores[s] || []).forEach(function (row) { cache[s][row[0]] = { r: row[1], t: J(row[2]), own: false }; });
  });
  SD.cache = cache; SD.version = SD.seenVersion = data.version || 0; SD.loaded = true; SD.stale = false;
  var st = global.document && global.document.getElementById('fcsd-stale'); if (st) st.parentNode.removeChild(st);
}
function output() {
  var out = {};
  FDB.STORE_NAMES.forEach(function (s) {
    var m = SD.cache[s] || {};
    out[s] = Object.keys(m).map(function (k) { return tag(JSON.parse(m[k].t), m[k].r); });
  });
  var lm = localMeta();
  out.meta = out.meta.filter(function (r) { return !PER_BROWSER_META[r.k]; })
    .concat(Object.keys(lm).filter(function (k) { return PER_BROWSER_META[k]; }).map(function (k) { return lm[k]; }));
  return out;
}
function migrated() {
  var m = (SD.cache.meta || {}).migration;
  try { return !!m && JSON.parse(m.t).v === '1'; } catch (e) { return false; }
}

var origOpen = FDB.open, origHydrate = FDB.hydrate, origTx = FDB.tx, origStatus = FDB.status,
    origAdopt = FDB.adoptLegacyDatabase, origLegacy = FDB.readLegacyBlob;
var firstLoad = true;

FDB.open = function () {
  var args = arguments;
  return decide().then(function (mode) {
    if (mode !== 'server') return origOpen.apply(FDB, args);
    SD.active = true; FDB.driver = 'server'; FDB.ready = true; FDB.lastError = null;
    FDB.adoptLegacyDatabase = function () { return Promise.resolve({ kind: 'none' }); };   /* never fold an old browser DB into shared data */
    FDB.readLegacyBlob = function () { return {}; };
    startPolling();
    return FDB;
  });
};

var loading = null;
function fetchAll() {
  return request('hydrate.php', { timeout: 60000 }).then(function (res) {
    if (res.status !== 200 || !res.data || !res.data.stores) throw Object.assign(new Error('The server returned status ' + res.status + ' while loading the data.'), { status: res.status });
    return res.data;
  });
}
FDB.hydrate = function (opts) {
  if (!SD.active) return origHydrate.apply(FDB, arguments);
  if (SD.loaded && !(opts && opts.fresh)) return Promise.resolve(output());   /* one download per page load; our own commits keep the cache current */
  if (loading) return loading.then(output);                                   /* several modules ask at start-up: they share one download */
  var boot = firstLoad; firstLoad = false;
  loading = fetchAll().then(function (data) {
    load(data);
    if (boot) {
      lsSet(STICKY_KEY, 'server');
      if (!migrated()) return blockBoot('The server data was not set up from a backup', 'Start-up was stopped so nothing is created by mistake. The administrator must import the company data first.');
    }
  }, function (e) {
    if (boot) return blockBoot('Cannot load the company data', (e && e.message ? e.message + ' ' : '') + 'Nothing was changed. Check the connection and try again.');
    throw e;
  });
  var p = loading; p.then(function () { loading = null; }, function () { loading = null; });
  return p.then(output);
};

/* ── transactions ──────────────────────────────────────────────────────── */
function refreshHot() {
  return request('read.php?stores=' + HOT_STORES.join(','), { timeout: 8000 }).then(function (res) {
    if (res.status !== 200 || !res.data || !res.data.stores) throw Object.assign(new Error('Could not check the latest numbers on the server (status ' + res.status + ').'), { refresh: true });
    HOT_STORES.forEach(function (s) {
      var fresh = {}; ((res.data.stores || {})[s] || []).forEach(function (row) { fresh[row[0]] = { r: row[1], t: J(row[2]), own: false }; });
      SD.cache[s] = fresh;
    });
    noteVersion(res.data.version);
  });
}
function noteVersion(v) {
  if (typeof v !== 'number') return;
  if (v > SD.seenVersion) SD.seenVersion = v;
  if (SD.seenVersion !== SD.version) { SD.stale = true; showStale(); }
}

function serverTx(storeNames, fn) {
  storeNames = (storeNames || []).filter(function (n) { return FDB.STORE_NAMES.indexOf(n) > -1; });
  if (SD.failed) return Promise.reject(Object.assign(new Error('A previous change was not saved. Reload the page first.'), { reloadRequired: true }));

  var needFresh = storeNames.some(function (n) { return HOT_STORES.indexOf(n) > -1; });
  return (needFresh ? refreshHot() : Promise.resolve()).then(function () {
    var ops = {}, order = [], reads = {};

    function baseFor(store, key, rec) {
      var id = idOf(store, key), e = SD.cache[store] && SD.cache[store][key];
      if (ops[id]) return ops[id].base;                                  /* the state this whole transaction started from */
      var r = rec && typeof rec.__r === 'number' ? rec.__r : undefined;
      if (r !== undefined) {
        /* our OWN later commit of a copy of this record moved the revision on — that is not somebody else's change */
        if (e && e.own && e.r > r) return e.r;
        return r;
      }
      if (reads[id] !== undefined) return reads[id];
      return e ? e.r : 0;
    }

    var api = {
      get: function (store, key) {
        key = String(key);
        if (store === 'meta' && PER_BROWSER_META[key]) { var lm = localMeta()[key]; return Promise.resolve(lm ? JSON.parse(J(lm)) : null); }
        var id = idOf(store, key), op = ops[id];
        if (op) return Promise.resolve(op.t === null ? null : tag(JSON.parse(op.t), op.base));
        var e = SD.cache[store] && SD.cache[store][key];
        reads[id] = e ? e.r : 0;
        return Promise.resolve(e ? tag(JSON.parse(e.t), e.r) : null);
      },
      put: function (store, rec) {
        var key = String(rec[keyPathOf(store)]);
        if (store === 'meta' && PER_BROWSER_META[key]) { var lm = localMeta(); lm[key] = JSON.parse(J(rec)); saveLocalMeta(lm); return rec; }
        var id = idOf(store, key);
        var base = SNAPSHOT_STORES[store] ? null : baseFor(store, key, rec);
        var text = J(rec), e = SD.cache[store] && SD.cache[store][key];
        /* saving exactly what the server already holds is not a change: nothing is sent (and nobody else is told to refresh) */
        var noop = !!e && same(core(store, JSON.parse(e.t)), core(store, JSON.parse(text)));
        if (!ops[id]) order.push(id);
        ops[id] = { s: store, k: key, t: text, base: base, ref: rec, noop: noop };
        return rec;
      },
      del: function (store, key) {
        key = String(key);
        if (store === 'meta' && PER_BROWSER_META[key]) { var lm = localMeta(); delete lm[key]; saveLocalMeta(lm); return; }
        var id = idOf(store, key), e = SD.cache[store] && SD.cache[store][key];
        var base = ops[id] ? ops[id].base : (reads[id] !== undefined ? reads[id] : (e ? e.r : 0));
        if (!ops[id] && !e) return;                                     /* nothing there to delete */
        if (!ops[id]) order.push(id);
        ops[id] = { s: store, k: key, t: null, base: base, ref: null };
      },
      all: function (store) {
        var m = SD.cache[store] || {}, rows = [];
        Object.keys(m).forEach(function (k) { var op = ops[idOf(store, k)]; if (!op) rows.push(tag(JSON.parse(m[k].t), m[k].r)); });
        order.forEach(function (id) { var op = ops[id]; if (op.s === store && op.t !== null) rows.push(JSON.parse(op.t)); });
        return Promise.resolve(rows);
      },
      abort: function () { throw new Error('aborted'); }
    };

    FDB.pendingWrites++;
    var done = function () { FDB.pendingWrites--; };
    return Promise.resolve().then(function () { return fn(api); }).then(function (result) {
      var list = order.map(function (id) { return ops[id]; }).filter(function (o) { return !o.noop; });
      if (!list.length) { done(); return result; }                     /* nothing to save (only per-browser values, or nothing changed) */
      return commit(list, reads, ops).then(function () { done(); return result; }, function (err) { done(); throw err; });
    }, function (err) { done(); throw err; });                            /* a business rule threw: nothing was sent, exactly like the browser driver */
  });
}

function commit(list, reads, ops) {
  var body = '{"ops":[' + list.map(function (o) {
    return '{"s":' + J(o.s) + ',"k":' + J(o.k) + ',"d":' + (o.t === null ? 'null' : o.t) + ',"r":' + (o.base === null || o.base === undefined ? 'null' : o.base) + '}';
  }).join(',') + '],"reads":[' + Object.keys(reads).filter(function (id) { return !ops[id]; }).map(function (id) {
    var p = id.split('\u0000'); return '{"s":' + J(p[0]) + ',"k":' + J(p[1]) + ',"r":' + reads[id] + '}';
  }).join(',') + ']}';

  return request('commit.php', { method: 'POST', body: body, timeout: 60000 }).then(function (res) {
    var d = res.data || {};
    if (res.status === 200 && d.ok) {
      (d.revs || []).forEach(function (row) {
        var s = row[0], k = row[1], r = row[2], op = ops[idOf(s, k)];
        if (r === 0) { if (SD.cache[s]) delete SD.cache[s][k]; return; }
        store_(s)[k] = { r: r, t: op ? op.t : '{}', own: true };
        if (op && op.ref && typeof op.ref === 'object') tag(op.ref, r);   /* the caller's live object now stands at the new revision */
      });
      FDB.lastWriteAt = Date.now();
      var expected = SD.version + 1;
      SD.version = d.version;
      if (typeof d.version === 'number' && d.version !== expected) { SD.seenVersion = Math.max(SD.seenVersion, d.version); SD.stale = true; showStale(); }
      else SD.seenVersion = d.version;
      return;
    }
    var err = new Error(res.status === 401 || res.status === 419
      ? 'Your sign-in expired. Reload the page and sign in again.'
      : (d.error || (res.status === 409 ? 'Someone else changed this record first.' : 'The server refused the change (status ' + res.status + ').')));
    err.status = res.status;
    if (d.conflict) { err.conflict = true; err.detail = d.conflict; }
    if (d.duplicate) { err.duplicate = true; err.detail = d; }
    if (d.retry) err.retry = true;
    commitFailed(err);
    throw err;
  }, function (netErr) { commitFailed(netErr); throw netErr; });
}

FDB.tx = function (storeNames, fn) {
  if (!SD.active) return origTx.apply(FDB, arguments);
  return serverTx(storeNames, fn);
};

/* ── the rest of the FDB surface ───────────────────────────────────────── */
FDB.status = function () {
  if (!SD.active) return origStatus.apply(FDB, arguments);
  return {
    driver: 'server',
    label: SD.failed ? 'Not saved — reload' : (SD.stale ? 'Server database (refresh)' : 'Server database connected'),
    healthy: !SD.failed,
    detail: 'Records are saved on the company server and shared by everyone who signs in. Nothing is kept only in this browser.',
    error: SD.failed ? SD.failed.message : null
  };
};

var origExportAll = FDB.exportAll;
FDB.exportAll = function () {
  if (!SD.active) return origExportAll.apply(FDB, arguments);
  return fetchAll().then(function (raw) {                              /* a backup is always the server's current truth … */
    var data = {};                                                       /* … read straight from it, without touching what this screen believes */
    FDB.STORE_NAMES.forEach(function (s) { data[s] = ((raw.stores || {})[s] || []).map(function (row) { return row[2]; }); });
    var lm = localMeta();
    data.meta = data.meta.filter(function (r) { return !PER_BROWSER_META[r.k]; })
      .concat(Object.keys(lm).filter(function (k) { return PER_BROWSER_META[k]; }).map(function (k) { return lm[k]; }));
    return {
      format: 'farooq-co-erp-backup', formatVersion: 1, appVersion: global.FAROOQ_UPGRADE_VERSION || '',
      exportedAt: new Date().toISOString(), driver: 'server',
      counts: FDB.STORE_NAMES.reduce(function (a, n) { a[n] = (data[n] || []).length; return a; }, {}),
      data: data
    };
  });
};

var origImportAll = FDB.importAll;
FDB.importAll = function () {
  if (!SD.active) return origImportAll.apply(FDB, arguments);
  return Promise.reject(new Error('Restoring a backup would replace everyone\'s data on the server, so it is not done from a browser. Ask the administrator to import it on the server.'));
};

/* ── noticing other people's saves ─────────────────────────────────────── */
function check() {
  if (!SD.active || (global.document && global.document.hidden)) return Promise.resolve();
  return request('version.php', { timeout: 8000 }).then(function (res) {
    if (res.status === 200 && res.data) noteVersion(res.data.version);
  }, function () { /* offline: the next save says so plainly */ });
}
SD.check = check;
var pollTimer = null;
function startPolling() {
  if (pollTimer || !global.setInterval) return;
  pollTimer = global.setInterval(check, POLL_MS);
  if (global.document) global.document.addEventListener('visibilitychange', function () { if (!global.document.hidden) check(); });
}
SD._decide = decide; SD._request = request;
})(typeof window !== 'undefined' ? window : globalThis);
