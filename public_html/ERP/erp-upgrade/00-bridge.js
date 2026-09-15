/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 0/6
   BRIDGE
   The original app declares its state with top-level `let` / `const`, which
   live in the script scope and are therefore not properties of `window`.
   The upgrade modules are self-contained IIFEs, so they need a window-level
   view of that state. These accessors give them one — by reference, so both
   sides always see the same arrays and objects. Nothing is copied.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
function expose(name, get, set) {
  try {
    Object.defineProperty(window, name, {
      configurable: true,
      get: get,
      set: set || function () { /* const-backed: assignment ignored on purpose */ }
    });
  } catch (e) { /* already a window property (function declarations) — nothing to do */ }
}

/* mutable state (let) — readable and writable */
expose('PRODUCTS',   function () { return PRODUCTS; },   function (v) { PRODUCTS = v; });
expose('CUSTOMERS',  function () { return CUSTOMERS; },  function (v) { CUSTOMERS = v; });
expose('SUPPLIERS',  function () { return SUPPLIERS; },  function (v) { SUPPLIERS = v; });
expose('WAREHOUSES', function () { return WAREHOUSES; }, function (v) { WAREHOUSES = v; });
expose('REGIONS',    function () { return REGIONS; },    function (v) { REGIONS = v; });
expose('CATEGORIES', function () { return CATEGORIES; }, function (v) { CATEGORIES = v; });
expose('STOCKMAP',   function () { return STOCKMAP; },   function (v) { STOCKMAP = v; });
expose('MOVES',      function () { return MOVES; },      function (v) { MOVES = v; });
expose('SALES',      function () { return SALES; },      function (v) { SALES = v; });
expose('PURCHASES',  function () { return PURCHASES; },  function (v) { PURCHASES = v; });
expose('ORDERS',     function () { return ORDERS; },     function (v) { ORDERS = v; });
expose('DISPATCH',   function () { return DISPATCH; },   function (v) { DISPATCH = v; });
expose('CUSTPAY',    function () { return CUSTPAY; },    function (v) { CUSTPAY = v; });
expose('SUPPAY',     function () { return SUPPAY; },     function (v) { SUPPAY = v; });
expose('ACTIVITY',   function () { return ACTIVITY; },   function (v) { ACTIVITY = v; });
expose('CREDITS',    function () { return CREDITS; },    function (v) { CREDITS = v; });
expose('DOCS',       function () { return DOCS; },       function (v) { DOCS = v; });
expose('DOCSEQ',     function () { return DOCSEQ; },     function (v) { DOCSEQ = v; });
expose('AUDIT',      function () { return AUDIT; },      function (v) { AUDIT = v; });
expose('SEQ',        function () { return SEQ; },        function (v) { SEQ = v; });
expose('BIZ',        function () { return BIZ; },        function (v) { BIZ = v; });
expose('USERS',      function () { return USERS; },      function (v) { USERS = v; });
expose('RULES',      function () { return RULES; },      function (v) { RULES = v; });
expose('LOG',        function () { return LOG; },        function (v) { LOG = v; });
expose('WA',         function () { return WA; },         function (v) { WA = v; });
expose('DEVICES',    function () { return DEVICES; },    function (v) { DEVICES = v; });
expose('CURRENT_USER', function () { return CURRENT_USER; }, function (v) { CURRENT_USER = v; });
expose('cur',        function () { return cur; },        function (v) { cur = v; });
expose('curArg',     function () { return curArg; },     function (v) { curArg = v; });
expose('FIL',        function () { return FIL; },        function (v) { FIL = v; });
expose('TODAY_ISO',  function () { return TODAY_ISO; });

/* registries and helpers (const) — read-only bindings, mutable objects */
expose('PAGES',      function () { return PAGES; });
expose('PANELS',     function () { return PANELS; });
expose('NAV',        function () { return NAV; });
expose('NAVGROUPS',  function () { return NAVGROUPS; });
expose('PAGEMETA',   function () { return PAGEMETA; });
expose('DOCTYPE',    function () { return DOCTYPE; });
expose('PERIODS',    function () { return PERIODS; });
expose('prodOf',     function () { return prodOf; });
expose('custBy',     function () { return custBy; });
expose('supOf',      function () { return supOf; });
expose('regionOf',   function () { return regionOf; });
expose('regionTxt',  function () { return regionTxt; });
expose('regionLbl',  function () { return regionLbl; });
expose('whName',     function () { return whName; });
expose('activeWh',   function () { return activeWh; });
expose('stockAt',    function () { return stockAt; });
expose('stockTotal', function () { return stockTotal; });
expose('levelOf',    function () { return levelOf; });
expose('u',          function () { return u; });
expose('I',          function () { return I; });
expose('pill',       function () { return pill; });
expose('opts',       function () { return opts; });
expose('nf',         function () { return nf; });
expose('rs',         function () { return rs; });
expose('money',      function () { return money; });
expose('pLbl',       function () { return pLbl; });
expose('bagLbl',     function () { return bagLbl; });
expose('docBy',      function () { return docBy; });

/* Function declarations (paint, go, say, openPanel, dbSave, dbLoad, moveStock,
   custLedger, supLedger, openDoc, fmtDate, isoOf, stamp, words, table,
   toolbar, applyFilters …) are already properties of window and stay
   patchable, so they are deliberately not redefined here. */
/* If any of these did not come through, every list in the app would be
   empty and the reason would be invisible. Record it instead. */
var missing = [];
[['PRODUCTS', 'products'], ['CUSTOMERS', 'shops'], ['SUPPLIERS', 'suppliers'],
 ['WAREHOUSES', 'warehouses'], ['REGIONS', 'regions']].forEach(function (pair) {
  var v;
  try { v = window[pair[0]]; } catch (e) { v = null; }
  if (!Array.isArray(v) || !v.length) missing.push(pair[1]);
});
window.FC_BRIDGE_READY = true;
window.FC_BRIDGE_MISSING = missing;
if (missing.length) {
  try { console.error('[Farooq ERP] master data did not reach the upgrade layer:', missing.join(', ')); } catch (e) {}
}
})();
