/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 42
   PAGE LAYOUT — one row of actions, long lists in pages

   Two things every screen was doing badly:

     1. ACTION BARS. Several modules each put their own row of buttons under a
        page's title ("Edit products", "Pricing settings", then the base
        "Add stock / Transfer / Adjust"). Each row was right-aligned on a line
        of its own, so the top of a screen was three or four mostly-empty
        strips before the first figure. Consecutive rows that hold ONLY buttons
        are now folded into the title row (its right-hand side), in the order
        they were drawn. A row that holds a search box, a filter or a date is a
        filter bar, not an action bar, and is left where it is.

     2. LONG LISTS. The dashboard's "Products needing attention" drew all 136
        products, Inventory drew 408 rows, Customers drew 409 cards — one page
        the height of a building. A list of more than LIMIT rows now shows the
        first page and a "Show more" bar under it (48 more each time, or all).
        Nothing is lost: the search and every filter still work over the WHOLE
        list (a row hidden only by the page limit counts as a match), CSV export
        takes every matching row, and printing expands the list first.

   Lists with their own paging (the invoice list, the Payments screen) do not
   use data-row, so they are not touched.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP; if (!ERP) return;
var D = global.document; if (!D) return;
function I(n) { try { return global.I ? global.I(n) : ''; } catch (e) { return ''; } }
function nf(n) { return Number(n || 0).toLocaleString('en-US'); }

var LIMIT = 48;                 /* rows a list shows before "Show more" (a property so a test can shrink it) */

var CSS = `
.fc-lim{display:none !important}
.fc-more{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin:0;padding:14px 16px 16px;
  border-top:1px solid var(--line-2);color:var(--muted);font-size:13px;font-weight:600;text-align:center}
.fc-more .btn{min-height:34px}
.fc-grid-more{border:1px dashed var(--line);border-radius:var(--r-lg);margin-top:14px;background:var(--surface)}
/* ONE vertical rhythm. A summary strip (.ledger), a card, a banner and a filter bar had no margin of their own, so on
   most screens they touched (0-2px) while a few used 18px or 24px. Stacked blocks are now 16px apart; a block that
   already sets its own margin inline keeps it. */
#view>:is(.ledger,.card,.banner,.bar,.g2,.g3,.g4)+:is(.ledger,.card,.banner,.bar,.g2,.g3,.g4){margin-top:16px}
#view>.bar+.tw,#view>.bar+.card{margin-top:0}
#view>.banner+.banner{margin-top:10px}
/* a labelled field inside a filter bar ("Amount from [ ]", "From [date]") sits INLINE with the selects around it, at their
   height, instead of stacking its caption above the box and making the whole bar uneven */
.bar label.f{display:flex;align-items:center;gap:8px;margin:0}
.bar label.f>span{margin:0;white-space:nowrap}
.bar label.f input,.bar label.f select{min-height:36px;width:auto;min-width:0}
.bar label.f input:not([type=date]){width:104px}
/* a section title with buttons at its right ("Stock by product and warehouse … Transfer, Adjust, Add product") wraps instead of
   pushing the page sideways on a phone */
.sec-t{flex-wrap:wrap}
.sec-t .r{display:flex;gap:8px;flex-wrap:wrap;max-width:100%}
/* the merged action row lives in the title row */
.page-head .r{align-items:center;justify-content:flex-end}
.page-head .r{min-width:0;max-width:100%}
.page-head .r .btn{white-space:nowrap}
@media (max-width:640px){
  .page-head .r{flex:1 1 100%;margin-left:0;justify-content:stretch}
  .page-head .r .btn{flex:1 1 auto;justify-content:center}
}
/* Notices in dark mode: their text colours were fixed dark tones (#234764, #7A4E0F, #7C2717) meant for a light background,
   so on the dark theme's tinted panels they were nearly unreadable. */
html[data-theme="dark"] .banner.info{color:#B7D6F2;border-color:#2C4560}
html[data-theme="dark"] .banner.warn{color:#F0C27A;border-color:#5B4519}
html[data-theme="dark"] .banner.err{color:#FFB4A6;border-color:#5A2A25}
/* a table wider than its card scrolls inside the card; the profit table just fits */
table.fcb-list{min-width:0}
@media print{ .fc-more{display:none !important} }
`;
(function () {
  var st = D.createElement('style'); st.id = 'fc-layout-css'; st.textContent = CSS; D.head.appendChild(st);
})();

/* ══════════════════════════════════════════════════════════════════════════
   1. ACTION BARS → THE TITLE ROW
   ══════════════════════════════════════════════════════════════════════════ */
function isActionBar(el) {
  if (!el || !el.classList || !el.classList.contains('bar')) return false;
  if (el.querySelector('input,select,textarea,.tsearch,.fld,.rel')) return false;
  return !!el.querySelector('button,a.btn');
}
function consolidate() {
  var view = D.getElementById('view'); if (!view) return;
  var head = view.querySelector('.page-head'); if (!head) return;
  var bars = [], n = head.nextElementSibling;
  while (n && isActionBar(n)) { bars.push(n); n = n.nextElementSibling; }
  if (!bars.length) return;
  var r = head.querySelector('.r');
  if (!r) { r = D.createElement('div'); r.className = 'r'; head.appendChild(r); }
  bars.forEach(function (b) {
    Array.prototype.slice.call(b.children).forEach(function (c) {
      if (c.classList && c.classList.contains('grow')) return;
      r.appendChild(c);
    });
    b.parentNode.removeChild(b);
  });
}

/* a table that sits straight in a card (no scroll wrapper) pushed the whole page sideways on a phone */
function wrapTables() {
  var view = D.getElementById('view'); if (!view) return;
  Array.prototype.forEach.call(view.querySelectorAll('table'), function (t) {
    var p = t.parentNode;
    if (!p || t.closest('.tw,.lc-tablewrap,.docsheet,.fcv-page,.fcv-scroll,.fce-page,.fcm')) return;
    var w = D.createElement('div'); w.className = 'tw';
    p.insertBefore(w, t); w.appendChild(t);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   2. LONG LISTS → PAGES
   ══════════════════════════════════════════════════════════════════════════ */
var printing = false;

function groups() {
  var view = D.getElementById('view'), map = [];
  if (!view) return map;
  Array.prototype.forEach.call(view.querySelectorAll('[data-row]'), function (el) {
    var p = el.parentNode; if (!p) return;
    for (var i = 0; i < map.length; i++) if (map[i].parent === p) { map[i].rows.push(el); return; }
    map.push({ parent: p, rows: [el] });
  });
  return map;
}
function anchorOf(parent) {
  /* a table body's list ends after the table's scroll wrapper; a card grid ends after the grid itself */
  if (parent.tagName === 'TBODY') { var t = parent.closest('.tw') || parent.closest('table'); return t; }
  return parent;
}
function barFor(anchor) {
  var next = anchor.nextElementSibling;
  return next && next.classList && next.classList.contains('fc-more') ? next : null;
}
function relimit() {
  var view = D.getElementById('view'); if (!view) return;
  var old = view.querySelectorAll('.fc-lim');
  Array.prototype.forEach.call(old, function (e) { e.classList.remove('fc-lim'); });
  var gs = groups(), keep = [];
  gs.forEach(function (g) {
    var anchor = anchorOf(g.parent); if (!anchor) return;
    var visible = g.rows.filter(function (r) { return r.style.display !== 'none' && !r.classList.contains('er'); });
    var lim = printing ? 1e9 : (Number(g.parent.getAttribute('data-fclim')) || LIMIT);
    var bar = barFor(anchor);
    if (visible.length <= lim) { if (bar) bar.parentNode.removeChild(bar); return; }
    visible.slice(lim).forEach(function (r) { r.classList.add('fc-lim'); });
    if (!bar) {
      bar = D.createElement('div');
      bar.className = 'fc-more' + (g.parent.tagName === 'TBODY' ? '' : ' fc-grid-more');
      anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    }
    var step = Math.min(LIMIT, visible.length - lim);
    bar.innerHTML = '<span>Showing ' + nf(lim) + ' of ' + nf(visible.length) + '</span>' +
      '<button type="button" class="btn sm" data-fcmore="1">' + I('down') + 'Show ' + nf(step) + ' more</button>' +
      (visible.length - lim > LIMIT ? '<button type="button" class="btn sm ghost" data-fcmore="all">Show all ' + nf(visible.length) + '</button>' : '');
    bar.__fcParent = g.parent;
    keep.push(bar);
  });
  /* bars whose list no longer exists (a screen change re-draws #view, so this is only a safety net) */
  Array.prototype.forEach.call(view.querySelectorAll('.fc-more'), function (b) { if (keep.indexOf(b) === -1 && b.parentNode) b.parentNode.removeChild(b); });
}

D.addEventListener('click', function (e) {
  var b = e.target && e.target.closest && e.target.closest('[data-fcmore]'); if (!b) return;
  var bar = b.closest('.fc-more'), parent = bar && bar.__fcParent; if (!parent) return;
  e.preventDefault(); e.stopPropagation();
  var cur = Number(parent.getAttribute('data-fclim')) || LIMIT;
  parent.setAttribute('data-fclim', b.getAttribute('data-fcmore') === 'all' ? '1000000' : String(cur + LIMIT));
  relimit();
  /* keep the keyboard where it was: on the first row that has just appeared */
  var vis = Array.prototype.filter.call(parent.children, function (r) { return r.hasAttribute('data-row') && r.style.display !== 'none' && !r.classList.contains('fc-lim'); });
  var first = vis[cur]; if (first) { try { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); } catch (x) {} }
}, true);

global.addEventListener('beforeprint', function () { printing = true; try { relimit(); } catch (e) {} });
global.addEventListener('afterprint', function () { printing = false; try { relimit(); } catch (e) {} });

/* ══════════════════════════════════════════════════════════════════════════
   HOOKS
   ══════════════════════════════════════════════════════════════════════════ */
var origPaint = global.paint;
if (typeof origPaint === 'function') {
  global.paint = function () {
    var r = origPaint.apply(global, arguments);
    try { consolidate(); wrapTables(); relimit(); } catch (e) {}
    return r;
  };
}
var origFilters = global.applyFilters;
if (typeof origFilters === 'function') {
  global.applyFilters = function () {
    var r = origFilters.apply(global, arguments);
    try { relimit(); } catch (e) {}
    return r;
  };
}
try { consolidate(); wrapTables(); relimit(); } catch (e) {}
/* the top bar's search box is 270px wide: its long placeholder was cut off mid-word ("Search orders, customers, bi") */
try { var gq = D.getElementById('gq'); if (gq) gq.setAttribute('placeholder', 'Search anything'); } catch (e) {}

ERP.Layout = {
  relimit: relimit, consolidate: consolidate, wrapTables: wrapTables,
  get limit() { return LIMIT; }, set limit(v) { LIMIT = Math.max(1, Number(v) || 48); }
};

})(typeof window !== 'undefined' ? window : globalThis);
