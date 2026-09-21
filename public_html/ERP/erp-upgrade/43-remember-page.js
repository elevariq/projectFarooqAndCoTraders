/* ═════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 43
   STAY ON THIS SCREEN — a reload no longer sends you back to the Dashboard

   The app always started on the Dashboard, so reloading a page — because
   someone else saved changes ("Refresh now"), because a save said "reload", or
   just by pressing F5 — threw the person out of the screen they were working
   on. Now the screen is remembered and shown again after the reload.

     · remembered per browser TAB (sessionStorage): two tabs on two screens do
       not disturb each other, and a brand-new tab still opens on the Dashboard
     · a shop / supplier / khata page comes back on the same shop or supplier;
       if that record no longer exists the Dashboard is shown instead
     · the new-invoice / new-purchase form is NOT reopened — its unsaved lines
       lived only in memory, so the person lands on the list they came from
     · permissions still apply: the screen is drawn by the same guarded page
       function as any click, so a role without access sees the lock notice
     · signing out forgets it (the next person starts on the Dashboard); a
       different person signing in on the same tab does not inherit it either
     · the scroll position comes back too (a long list stays where it was)
     · the screen is drawn only once the person's permissions are known, so a
       restricted screen never flashes open before its lock notice
     · while the data is still loading nothing is drawn but the skeleton, so
       there is no flash of the Dashboard before the remembered screen appears

   Nothing here touches the business data, the database or the API.
   ═════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP; if (!ERP) return;
var D = global.document; if (!D) return;

var KEY = 'farooqco_erp_page';
var WH_KEY = 'farooqco_wh_page';            /* the Warehouse app's copy (same tab) — forgotten together on sign-out */
var SKIP = { invoiceBuilder: 1 };           /* holds an unsaved draft in memory: never reopened */
var NEEDS = { customerProfile: 'cust', khata: 'cust', supplierProfile: 'sup' };   /* pages that need a record id */
var GIVE_UP_MS = +global.FC_REMEMBER_GIVE_UP_MS || 20000;   /* if boot never finishes, stop holding the screen back */
var IDENTITY_WAIT_MS = 4000;                /* how long to wait for "who is signed in" before showing the screen anyway */

function store() { try { return global.sessionStorage || null; } catch (e) { return null; } }
function read() {
  try {
    var s = store(); if (!s) return null;
    var r = JSON.parse(s.getItem(KEY) || 'null');
    return r && typeof r.id === 'string' ? r : null;
  } catch (e) { return null; }
}
function write(rec) { try { var s = store(); if (s) s.setItem(KEY, JSON.stringify(rec)); } catch (e) {} }
function forget() { try { var s = store(); if (s) { s.removeItem(KEY); s.removeItem(WH_KEY); } } catch (e) {} }

/* who is signed in (the server account id), or null while unknown / on a device with no server sign-in */
function whoAmI() {
  try { var A = ERP.Auth; return (A && A.identity && A.identity.id) ? String(A.identity.id) : null; } catch (e) { return null; }
}

/* Is the remembered screen still a real, openable screen — and was it this person's? */
function usable(rec) {
  if (!rec || SKIP[rec.id]) return false;
  var me = whoAmI();
  if (rec.u && me && String(rec.u) !== me) return false;      /* another person signed in on this tab */
  var pages = global.PAGES;
  if (!pages || typeof pages[rec.id] !== 'function') return false;
  var need = NEEDS[rec.id];
  if (need) {
    if (rec.arg === undefined || rec.arg === null || rec.arg === '') return false;
    try {
      if (need === 'cust' && !(global.custBy && global.custBy(rec.arg))) return false;
      if (need === 'sup' && !(global.supOf && global.supOf(rec.arg))) return false;
    } catch (e) { return false; }
  }
  return true;
}

var saved = read();
var holding = !!(saved && saved.id !== 'dashboard' && ERP.bootPromise);
var gaveUp = false, bootDone = false;
var signedOut = false;       /* between a sign-out and the next sign-in nothing is remembered (the sign-out repaints the page) */
var memo = null;             /* what is stored right now: { id, arg, u, y } */

function paused() { return signedOut || holding || (gaveUp && !bootDone); }
function scrollY() {
  try { return Math.max(0, Math.round(global.pageYOffset || (D.documentElement && D.documentElement.scrollTop) || 0)); }
  catch (e) { return 0; }
}

function remember() {
  if (paused()) return;
  var id = global.cur;
  if (typeof id !== 'string' || !id || SKIP[id]) return;
  var rec = { id: id };
  if (NEEDS[id]) rec.arg = global.curArg;   /* curArg goes stale on other pages, so it is only kept where it means something */
  var me = whoAmI(); if (me) rec.u = me;
  /* the same screen painted again (after a save, a filter…) keeps its scroll place; a different screen starts at the top */
  rec.y = (memo && memo.id === rec.id && memo.arg === rec.arg) ? scrollY() : 0;
  memo = rec; write(rec);
}

/* Every screen is drawn through paint(), so this sees every navigation, however
   it was started (menu, search, a link inside a page, the back-to-list button…).
   While the remembered screen is being waited for, a real paint is shown as the
   loading skeleton instead, so the Dashboard never flashes up first. */
var basePaint = global.paint;
if (typeof basePaint === 'function') {
  global.paint = function (loading) {
    if (holding && !loading) loading = true;
    basePaint.call(global, loading);
    if (!loading) { try { remember(); } catch (e) {} }
  };
}

/* the scroll place, kept up to date while the person reads (throttled) and once more as the page goes away */
var scrollTimer = null;
function saveScroll() {
  scrollTimer = null;
  if (paused() || !memo) return;
  var y = scrollY();
  if (y === memo.y) return;
  memo.y = y; write(memo);
}
try {
  global.addEventListener('scroll', function () { if (!scrollTimer) scrollTimer = setTimeout(saveScroll, 200); }, { passive: true });
  global.addEventListener('pagehide', saveScroll);
} catch (e) {}

function apply() {
  var ok = false;
  try {
    if (usable(saved)) {
      global.cur = saved.id;
      if (NEEDS[saved.id]) global.curArg = saved.arg;
      memo = { id: saved.id, arg: NEEDS[saved.id] ? saved.arg : undefined, u: saved.u, y: saved.y || 0 };
      ok = true;
    }
  } catch (e) {}
  try { global.paint(); } catch (e) {}
  if (ok && saved.y > 0) { try { global.scrollTo(0, saved.y); } catch (e) {} }
  /* the repaint above stored "top of the page"; put the restored place back so a second reload keeps it too */
  if (ok) { memo.y = saved.y || 0; write(memo); }
}

/* Boot finished (data loaded) and — where there is a server — the sign-in check has answered */
function finish() {
  bootDone = true;
  if (holding) { holding = false; apply(); }
  else if (gaveUp && global.cur === 'dashboard') apply();      /* boot was slow: the person is still on the fallback Dashboard */
}

function identityKnown() {
  var p = ERP.Auth && ERP.Auth._refreshing;
  if (!p || typeof p.then !== 'function') return Promise.resolve();
  return Promise.race([p.then(function () {}, function () {}), new Promise(function (r) { setTimeout(r, IDENTITY_WAIT_MS); })]);
}

/* Auth.refresh() (the "who is signed in" question) starts by itself right after boot; keep its promise */
if (ERP.Auth && typeof ERP.Auth.refresh === 'function') {
  var baseRefresh = ERP.Auth.refresh;
  ERP.Auth.refresh = function () {
    var p = baseRefresh.apply(this, arguments);
    if (!ERP.Auth._refreshing) ERP.Auth._refreshing = p;
    return p;
  };
}

if (holding) {
  ERP.bootPromise.then(identityKnown, function () {}).then(finish);
  setTimeout(function () {
    if (!holding) return;
    holding = false; gaveUp = true;                              /* stop holding the screen back; do not overwrite what is remembered */
    try { global.paint(); } catch (e) {}
  }, GIVE_UP_MS);
} else {
  bootDone = true;
}

/* Signing out ends the person's session — the next one starts fresh */
if (ERP.Auth && typeof ERP.Auth.logout === 'function') {
  var baseLogout = ERP.Auth.logout;
  ERP.Auth.logout = function () {
    signedOut = true; memo = null;
    forget();
    return baseLogout.apply(this, arguments);
  };
}
if (ERP.Auth && typeof ERP.Auth.login === 'function') {
  var baseLogin = ERP.Auth.login;
  ERP.Auth.login = function () {
    var p = baseLogin.apply(this, arguments);
    /* signed in again (in place, after the session ended): remembering resumes from the next paint */
    if (p && typeof p.then === 'function') p.then(function () { signedOut = false; }, function () {});
    return p;
  };
}

ERP.RememberPage = { KEY: KEY, read: read, forget: forget, usable: usable };
})(typeof window !== 'undefined' ? window : globalThis);
