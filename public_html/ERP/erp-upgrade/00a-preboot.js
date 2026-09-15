/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 00a
   THE PRE-BOOT GUARD  ·  loads before the application itself
   The app writes its own state as it first renders, and that write rebuilds
   the shared record from only the keys it knows about — which is how damaged
   stock, transfers and adjustments used to disappear before migration could
   read them. This runs first: it takes a copy of the record as found, holds
   every write to it until migration says it is safe, and merges back any key
   a write would otherwise have dropped.
   ══════════════════════════════════════════════════════════════════════════ */
(function (w) {
'use strict';
var KEY = 'farooqco_erp_v1';

var raw = null, snapshot = null;
try { raw = w.localStorage.getItem(KEY); } catch (e) { raw = null; }
try { snapshot = raw ? JSON.parse(raw) : null; } catch (e) { snapshot = null; }

var best = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;  /* fullest version seen */
var locked = true;          /* released once migration has finished */
var pending = null;         /* the last write, held back while locked */
var restored = [], heldWrites = 0;

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/* Whatever the app writes, anything the record used to hold and this write
   does not is put back. New keys are kept; nothing is ever removed. */
function merge(text) {
  var next;
  try { next = JSON.parse(text); } catch (e) { return text; }
  if (!next || typeof next !== 'object') return text;
  if (best) {
    Object.keys(best).forEach(function (k) {
      if (isEmpty(next[k]) && !isEmpty(best[k])) {
        next[k] = best[k];
        if (restored.indexOf(k) === -1) restored.push(k);
      }
    });
  }
  best = JSON.parse(JSON.stringify(next));
  return JSON.stringify(next);
}

try {
  var proto = w.Storage && w.Storage.prototype;
  var store = w.localStorage;
  var origSet = (proto && proto.setItem) || store.setItem;
  var origGet = (proto && proto.getItem) || store.getItem;

  var setItem = function (k, v) {
    if (k !== KEY) return origSet.call(this, k, v);
    /* Merging only happens while the record is still the only copy of the old
       data. Once migration has taken it into the database, the database is the
       master and putting old values back would overwrite migrated state. */
    if (!locked) return origSet.call(this, k, String(v));
    pending = merge(String(v));
    heldWrites++;
  };
  var getItem = function (k) {
    if (k === KEY && pending !== null) return pending;   /* reads see the full record */
    return origGet.call(this, k);
  };

  if (proto) { proto.setItem = setItem; proto.getItem = getItem; }
  else { store.setItem = setItem; store.getItem = getItem; }

  w.FC_PREBOOT = {
    key: KEY,
    snapshot: snapshot,
    hasSnapshot: !!snapshot,
    restoredKeys: restored,
    heldWrites: function () { return heldWrites; },
    isLocked: function () { return locked; },
    current: function () { return best; },
    /* Called by the integrity module once migration has completed. The held
       write is thrown away rather than replayed: it was composed before
       migration finished and would put the pre-migration state back. The
       caller saves again immediately, which writes the current state through
       the same merge. */
    release: function () {
      if (!locked) return;
      locked = false;
      pending = null;
    },
    /* a failed migration keeps the lock on, so the old record stays as it is */
    hold: function () { locked = true; },
    /* nothing held is ever replayed — the caller writes current state instead */
    discardPending: function () { pending = null; }
  };
} catch (e) {
  w.FC_PREBOOT = {
    key: KEY, snapshot: snapshot, hasSnapshot: !!snapshot, restoredKeys: [],
    heldWrites: function () { return 0; }, isLocked: function () { return false; },
    current: function () { return snapshot; }, release: function () {}, hold: function () {}
  };
}
})(typeof window !== 'undefined' ? window : globalThis);
