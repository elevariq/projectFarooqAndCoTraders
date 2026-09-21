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
     · signing out forgets it (the next person starts on the Dashboard)
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
var GIVE_UP_MS = 20000;                     /* if boot never finishes, stop holding the screen back */

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

/* Is the remembered screen still a real, openable screen? */
function usable(rec) {
  if (!rec || SKIP[rec.id]) return false;
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

var signedOut = false;       /* between a sign-out and the next sign-in nothing is remembered (the sign-out repaints the page) */
function remember() {
  if (signedOut) return;
  var id = global.cur;
  if (typeof id !== 'string' || !id || SKIP[id]) return;
  var rec = { id: id };
  if (NEEDS[id]) rec.arg = global.curArg;   /* curArg goes stale on other pages, so it is only kept where it means something */
  write(rec);
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

function release() {
  if (!holding) return;
  holding = false;
  try {
    if (usable(saved)) {
      global.cur = saved.id;
      if (NEEDS[saved.id]) global.curArg = saved.arg;
    }
  } catch (e) {}
  try { global.paint(); } catch (e) {}
}

if (holding) {
  ERP.bootPromise.then(release, release);
  setTimeout(release, GIVE_UP_MS);
}

/* Signing out ends the person's session — the next one starts fresh */
if (ERP.Auth && typeof ERP.Auth.logout === 'function') {
  var baseLogout = ERP.Auth.logout;
  ERP.Auth.logout = function () {
    signedOut = true;
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
