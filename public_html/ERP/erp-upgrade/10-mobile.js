/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 10
   THE PHONE
   The office runs on a desktop, but the loads are counted on a phone in the
   godown and the bazaar. On a small screen the ERP becomes a proper mobile
   app: bottom navigation, tables that stack into readable cards, the
   product list as a bottom sheet, thumb-sized controls and an invoice
   preview that fits the width without pinching.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, D = global.document;
var I = function (n) { return global.I ? global.I(n) : ''; };

var MOBILE_Q = '(max-width: 760px)';
var mq = global.matchMedia ? global.matchMedia(MOBILE_Q) : null;
/* Evaluated fresh each time rather than read from a cached query object, so
   turning the phone, splitting the screen or resizing a window is picked up
   even where the cached object does not update. */
function isMobile() {
  try { if (global.matchMedia) return global.matchMedia(MOBILE_Q).matches; } catch (e) {}
  return (global.innerWidth || 1024) <= 760;
}
ERP.isMobile = isMobile;

/* ══════════════════════════════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
:root{--fc-tab:60px;--fc-safe:env(safe-area-inset-bottom,0px)}

/* ── things that help on every screen ── */
.fcb-in,.fcb-mini,.fcb-search input,.fcb-fallback select{font-size:16px}
.tw{-webkit-overflow-scrolling:touch}

/* Hidden unconditionally by default — the version of this rule that only
   hid it on desktop used to live inside the @media block below, so it
   simply never fired outside that width and the bar could render as a
   plain unstyled block at the end of the page. Found 2026-09-16 from a
   client screenshot: on a real phone the bar WAS being fixed to the
   bottom (so the media query was matching), but the desktop sidebar rail
   was never being hidden alongside it and sat on top of it, cutting off
   the first one or two tabs. Both fixed here, defensively, regardless of
   the exact reason the base app's own 900px rail-hiding rule wasn't
   enough on its own. */
.fc-tabbar{display:none}
body.fc-mobile:not(.fc-hidechrome) .fc-tabbar{display:grid}

@media (max-width:760px){
  body.fc-mobile{--fc-on:1}

  /* room for the bottom bar and, in the editor, the action bar above it */
  body.fc-mobile .page{padding:12px 12px calc(var(--fc-tab) + var(--fc-safe) + 12px)}
  body.fc-mobile.fc-builder .page{padding-bottom:calc(var(--fc-tab) + var(--fc-safe) + 132px)}

  /* the desktop rail must stay off-screen unless the drawer is explicitly
     open — the base app already does this at max-width:900px, but that
     rule was losing to the sidebar's own collapsed/"mini" state in
     practice, so it's reasserted here with !important, scoped to mobile */
  body.fc-mobile:not(.drawer) .rail{transform:translateX(-100%) !important}
  body.fc-mobile.drawer .rail{transform:none !important;width:250px !important;
    flex-basis:250px !important;z-index:70}
  body.fc-mobile .main{margin-left:0 !important}

  /* ── bottom navigation ── */
  .fc-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:80;
    grid-auto-flow:column;grid-auto-columns:1fr;background:var(--surface);
    border-top:1px solid var(--line);padding-bottom:var(--fc-safe);
    box-shadow:0 -6px 20px rgba(18,17,26,.07)}
  .fc-tabbar button{display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:2px;min-height:var(--fc-tab);border:none;background:none;color:var(--muted);
    font-size:10.5px;font-weight:600;letter-spacing:.2px;padding:6px 2px}
  .fc-tabbar button svg{width:21px;height:21px}
  .fc-tabbar button.on{color:var(--violet)}
  .fc-tabbar button.on svg{stroke:var(--violet)}
  body:not(.fc-mobile) .fc-tabbar{display:none}
  body.fc-hidechrome .fc-tabbar{display:none}

  /* the top bar itself is styled in module 35 */
  body.fc-mobile .page-head{margin-bottom:10px}

  /* dashboard figures: two tiles across instead of one long column */
  body.fc-mobile .ledger,body.fc-mobile .ledger.l4{grid-template-columns:1fr 1fr}
  body.fc-mobile .kpi{padding:12px 12px;border-right:none !important;border-bottom:1px solid var(--line-2) !important}
  body.fc-mobile .kpi:nth-child(odd){border-right:1px solid var(--line-2) !important}
  body.fc-mobile .kpi:last-child,
  body.fc-mobile .kpi:nth-last-child(2):nth-child(odd){border-bottom:none !important}
  body.fc-mobile .kpi .k{font-size:12px;gap:6px}
  body.fc-mobile .kpi .v{font-size:19px;overflow-wrap:anywhere}
  body.fc-mobile .kpi .d{font-size:11.5px}
  /* a notice with a button: the button drops under the text instead of
     squeezing the words into a narrow column beside it */
  body.fc-mobile .banner{flex-wrap:wrap}
  body.fc-mobile .banner>div:not(.r){flex:1 1 0;min-width:0}
  body.fc-mobile .banner>.r{flex:0 0 100%;margin:4px 0 0}
  body.fc-mobile .banner>.r .btn{width:100%;justify-content:center;min-height:44px}
  /* card headings keep their title on one line; the badge wraps below it */
  body.fc-mobile .card-h{flex-wrap:wrap;gap:6px 10px}
  body.fc-mobile .card-h h2,body.fc-mobile .card-h h3{white-space:nowrap}
  body.fc-mobile .page-head p{display:none}
  body.fc-mobile .card-b{padding:14px}
  body.fc-mobile .card-h{padding:12px 14px}

  /* toolbars wrap and fill the width */
  body.fc-mobile .bar{flex-wrap:wrap;gap:8px}
  body.fc-mobile .bar .tsearch{width:100%;order:-1}
  body.fc-mobile .bar .fld{flex:1 1 46%;min-width:0}
  body.fc-mobile .bar .fld select{width:100%}
  body.fc-mobile .bar .btn{flex:1 1 46%;justify-content:center;min-height:44px}

  /* ── the line editor: one card per product ── */
  body.fc-mobile .fcb-tw{overflow:visible}
  body.fc-mobile table.fcb-table{min-width:0;display:block}
  body.fc-mobile table.fcb-table thead{display:none}
  body.fc-mobile table.fcb-table tbody{display:block}
  body.fc-mobile table.fcb-table tr{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;
    border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-bottom:10px;
    background:var(--surface);position:relative}
  body.fc-mobile table.fcb-table tr.over{border-color:var(--clay);background:var(--clay-50)}
  body.fc-mobile table.fcb-table td{display:block;border:none;padding:0;text-align:left}
  body.fc-mobile table.fcb-table td[data-label]::before{content:attr(data-label);display:block;
    font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
  body.fc-mobile table.fcb-table td[data-label=""]::before{display:none}
  body.fc-mobile .fcb-prodcell{grid-column:1/-1;padding-right:34px !important}
  body.fc-mobile table.fcb-table td[data-label="Line"]{position:absolute;top:10px;right:44px;
    font-size:11px;color:var(--muted)}
  body.fc-mobile table.fcb-table td[data-label="Line"]::before{display:none}
  body.fc-mobile table.fcb-table td[data-label="Package"]{display:none}
  body.fc-mobile .fcb-in{max-width:none;width:100%;min-height:46px;text-align:right;font-size:17px}
  body.fc-mobile .fcb-mini{max-width:none;width:100%;min-height:44px;font-size:15px}
  body.fc-mobile .fcb-amtcell{grid-column:1/-1;border-top:1px dashed var(--line);padding-top:8px !important;
    text-align:right;font-size:17px}
  body.fc-mobile .fcb-acts{position:absolute;top:8px;right:8px;display:flex;gap:2px}
  body.fc-mobile .fcb-acts .icon-btn{min-width:32px;min-height:32px}
  body.fc-mobile .fcb-acts [data-fcmove]{display:none}
  body.fc-mobile tr.fcb-empty{display:block;grid-template-columns:none}
  body.fc-mobile tr.fcb-empty td{text-align:center}

  /* ── the product list becomes a bottom sheet ── */
  body.fc-mobile .fcb-results{position:fixed;left:0;right:0;bottom:0;top:auto;z-index:95;
    max-height:72vh;border-radius:18px 18px 0 0;border:none;padding:6px 8px calc(12px + var(--fc-safe));
    box-shadow:0 -12px 40px rgba(18,17,26,.28);overscroll-behavior:contain}
  body.fc-mobile .fcb-results::before{content:'';display:block;width:38px;height:4px;border-radius:9px;
    background:var(--line);margin:6px auto 10px}
  body.fc-mobile .fcb-res{padding:13px 12px;border-bottom:1px solid var(--line-2)}
  body.fc-mobile .fcb-res:last-child{border-bottom:none}
  body.fc-mobile .fcb-res-n{font-size:15.5px}
  .fc-sheet-scrim{position:fixed;inset:0;background:rgba(12,10,20,.4);z-index:94;display:none}
  body.fc-mobile.fc-sheet .fc-sheet-scrim{display:block}
  body.fc-mobile .fcb-search{position:relative;z-index:96}
  body.fc-mobile.fc-sheet .fcb-search{position:fixed;left:0;right:0;bottom:calc(72vh + var(--fc-safe));
    margin:0;border-radius:0;border-left:none;border-right:none;padding:8px 10px}
  body.fc-mobile .fcb-search input{min-height:46px}
  body.fc-mobile .fcb-search .btn{min-height:44px;padding:0 14px}
  body.fc-mobile .fcb-fallback{margin-top:10px}
  body.fc-mobile .fcb-fallback select,body.fc-mobile .fcb-fallback .btn{width:100%;min-height:46px}

  /* ── the action bar sits above the tab bar ── */
  body.fc-mobile .fcb-sticky{left:0;right:0;bottom:calc(var(--fc-tab) + var(--fc-safe));
    padding:8px 12px;border-top:1px solid var(--line)}
  body.fc-mobile .fcb-sticky-in{gap:8px}
  body.fc-mobile .fcb-stotals{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;flex:1 1 100%;order:-1}
  body.fc-mobile .fcb-stotals>div{display:flex;justify-content:space-between;font-size:12.5px}
  body.fc-mobile .fcb-stotals>div:not(.grand):not(:nth-child(-n+2)){display:none}
  body.fc-mobile .fcb-stotals .grand{grid-column:1/-1;border-top:1px solid var(--line-2);
    padding-top:5px;margin-top:3px}
  body.fc-mobile .fcb-stotals .grand b{font-size:19px}
  body.fc-mobile .fcb-btns{width:100%;margin-left:0;gap:8px}
  body.fc-mobile .fcb-btns .btn{flex:1;min-height:48px;justify-content:center}
  body.fc-mobile .fcb-btns .btn.lg{flex:2;font-size:15.5px}
  body.fc-mobile .fcb-btns [data-fcbact="cancel"]{flex:0 0 auto;padding:0 14px}
  body.fc-mobile .fcb-side{order:-1}
  body.fc-mobile .fcb-side .banner{display:none}
  body.fc-mobile .fcb-sum{display:none}
  body.fc-mobile .fcb-party{grid-template-columns:1fr 1fr}
  body.fc-mobile .f2{grid-template-columns:1fr}

  /* ── every list of records becomes cards ── */
  body.fc-mobile table.fcb-list{min-width:0;display:block}
  body.fc-mobile table.fcb-list thead{display:none}
  body.fc-mobile table.fcb-list tbody{display:block}
  body.fc-mobile table.fcb-list tr{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;
    border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-bottom:10px;background:var(--surface)}
  body.fc-mobile table.fcb-list td{display:block;border:none;padding:0;text-align:left;font-size:13.5px}
  body.fc-mobile table.fcb-list td[data-label]::before{content:attr(data-label);display:block;
    font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
  body.fc-mobile table.fcb-list td[data-label=""]::before{display:none}
  body.fc-mobile table.fcb-list td.fcb-key,
  body.fc-mobile table.fcb-list td[data-label="Shop"]{grid-column:1/-1}
  body.fc-mobile table.fcb-list td[data-label="Region"],
  body.fc-mobile table.fcb-list td[data-label="Warehouse"],
  body.fc-mobile table.fcb-list td[data-label="Items"]{display:none}
  body.fc-mobile table.fcb-list td[data-label="Balance"] b{font-size:15px}
  body.fc-mobile .fcb-rowacts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;
    border-top:1px solid var(--line-2);padding-top:9px;margin-top:3px}
  body.fc-mobile .fcb-rowacts .btn.sm{flex:1 1 30%;margin:0;min-height:40px;justify-content:center}

  /* ── the document preview fits the screen ── */
  body.fc-mobile .fcv-bar{padding:8px 10px;gap:6px;overflow-x:auto;flex-wrap:nowrap;
    scrollbar-width:none;-webkit-overflow-scrolling:touch}
  body.fc-mobile .fcv-bar::-webkit-scrollbar{display:none}
  body.fc-mobile .fcv-t{flex:0 0 auto}
  body.fc-mobile .fcv-t b{font-size:13px}
  body.fc-mobile .fcv-sp{display:none}
  body.fc-mobile .fcv-btn{flex:0 0 auto;min-height:40px;white-space:nowrap}
  body.fc-mobile .fcv-btn[data-fcv="zoomin"],body.fc-mobile .fcv-btn[data-fcv="zoomout"],
  body.fc-mobile .fcv-z{display:none}
  body.fc-mobile .fcv-scroll{padding:10px 0 40px}
  body.fc-mobile .fcv-page{box-shadow:0 6px 24px rgba(0,0,0,.3)}

  /* ── panels behave like sheets ── */
  body.fc-mobile .panel{width:100%;border-radius:0}
  body.fc-mobile .panel .f input,body.fc-mobile .panel .f select,
  body.fc-mobile .panel .f textarea{font-size:16px;min-height:46px}
  body.fc-mobile .fcret-row{grid-template-columns:1fr;gap:6px;padding:12px 0}
  body.fc-mobile .fcret-row input,body.fc-mobile .fcret-row select{min-height:46px;font-size:16px}
  body.fc-mobile .fcalloc{flex-wrap:wrap}
  body.fc-mobile .fcalloc input{width:100%;min-height:46px;font-size:16px}

  /* ── the app's own tables stack too, using headers copied in at runtime ── */
  body.fc-mobile #view .tw>table{min-width:0;display:block}
  body.fc-mobile #view .tw>table thead{display:none}
  body.fc-mobile #view .tw>table tbody{display:block}
  body.fc-mobile #view .tw>table tbody tr{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;
    border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-bottom:10px;background:var(--surface)}
  body.fc-mobile #view .tw>table tbody td{display:block;border:none;padding:0;text-align:left;font-size:13.5px}
  body.fc-mobile #view .tw>table tbody td[data-label]:not([data-label=""])::before{content:attr(data-label);
    display:block;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
  body.fc-mobile #view .tw>table tbody td[colspan]{grid-column:1/-1}
  body.fc-mobile #view .tw>table tbody tr.er{display:block;border:none;padding:0;background:none}
  body.fc-mobile #view .tw>table tbody td:first-child{grid-column:1/-1;font-weight:600}
  body.fc-mobile #fcviewer table{display:table !important}
  body.fc-mobile #fcviewer table thead{display:table-header-group !important}
  body.fc-mobile #fcviewer table tbody{display:table-row-group !important}
  body.fc-mobile #fcviewer table tr{display:table-row !important;border:none !important;
    padding:0 !important;margin:0 !important}
  body.fc-mobile #fcviewer table td{display:table-cell !important}
  body.fc-mobile #fcviewer table td::before{display:none !important}

  /* ── settings and the rest ── */
  body.fc-mobile .fcset-grid{grid-template-columns:1fr}
  body.fc-mobile .fcdb{font-size:11.5px;padding:3px 8px}
  body.fc-mobile .fcdoc{width:100%;min-height:auto;padding:10mm 6mm}
}

@media (max-width:420px){
  body.fc-mobile .fcb-rowacts .btn.sm{flex:1 1 46%}
  body.fc-mobile table.fcb-list tr,body.fc-mobile table.fcb-table tr{grid-template-columns:1fr}
  body.fc-mobile .fcb-party{grid-template-columns:1fr}
}

@media print{ .fc-tabbar,.fc-sheet-scrim{display:none !important} }

/* ── the sidebar toggle, at every width ─────────────────────────────────
   The base app forces the sidebar down to the narrow icon rail at <=1200px, and its own
   collapse button only sets the SAME 68px there — so on most laptop windows the button
   visibly did nothing and the labels could never be brought back. Between 901 and 1200px
   the button now EXPANDS the rail (body.fc-wide) and collapses it again; above 1200px the
   base behaviour (body.mini) is untouched; at <=900px the hamburger owns the drawer, so
   the collapse button (which cannot do anything there) is hidden. */
@media (max-width:1200px) and (min-width:901px){
  body.fc-wide{--rail:238px}
  body.fc-wide .brand-t,body.fc-wide .nav span.lbl,body.fc-wide .nav-count,
  body.fc-wide .who-t,body.fc-wide .nav-sec{display:block}
  body.fc-wide .nav a{justify-content:flex-start;padding:0 12px}
  body.fc-wide .who{justify-content:flex-start}
  body.fc-wide .rail-head{justify-content:flex-start;padding:18px 16px 16px}
}
@media (max-width:900px){#mini{display:none}}
`;
(function () {
  var st = D.createElement('style');
  st.id = 'fc-mobile-css';
  st.textContent = CSS;
  D.head.appendChild(st);
  /* the safe-area variables only resolve when the viewport covers the notch */
  var vp = D.querySelector('meta[name="viewport"]');
  if (vp && vp.content.indexOf('viewport-fit') === -1) {
    vp.content = vp.content + ', viewport-fit=cover';
  }
})();

/* ══════════════════════════════════════════════════════════════════════════
   BOTTOM NAVIGATION
   ══════════════════════════════════════════════════════════════════════════ */
var TABS = [
  { id: 'dashboard', label: 'Home',    icon: 'grid' },
  { id: 'invoices',  label: 'Sales',   icon: 'tag' },
  { id: 'newsale',   label: 'New',     icon: 'plus', primary: true },
  { id: 'inventory', label: 'Stock',   icon: 'box' },
  { id: 'more',      label: 'More',    icon: 'menu' }
];

function buildTabbar() {
  var bar = D.getElementById('fcTabbar');
  if (!bar) {
    bar = D.createElement('nav');
    bar.id = 'fcTabbar';
    bar.className = 'fc-tabbar';
    bar.setAttribute('aria-label', 'Main sections');
    D.body.appendChild(bar);
    var scrim = D.createElement('div');
    scrim.className = 'fc-sheet-scrim';
    scrim.id = 'fcSheetScrim';
    D.body.appendChild(scrim);
  }
  var cur = global.cur;
  bar.innerHTML = TABS.map(function (t) {
    var on = t.id === cur || (t.id === 'invoices' && cur === 'sales');
    return '<button data-fctab="' + t.id + '" class="' + (on ? 'on' : '') + '">' +
      I(t.icon) + '<span>' + t.label + '</span></button>';
  }).join('');
}

D.addEventListener('click', function (e) {
  var t = e.target.closest ? e.target.closest('[data-fctab]') : null;
  if (t) {
    e.preventDefault();
    var id = t.dataset.fctab;
    if (id === 'newsale') { ERP.Builder.start('sale'); return; }
    if (id === 'more') { D.body.classList.toggle('drawer'); return; }
    global.go(id);
    return;
  }
  /* tapping the dimmed area closes the product sheet */
  if (e.target.id === 'fcSheetScrim') {
    e.preventDefault();
    ERP.Builder.pickerOpen = false;
    ERP.BuilderRender.results();
    syncSheet();
  }
}, true);

/* ══════════════════════════════════════════════════════════════════════════
   STATE THE LAYOUT DEPENDS ON
   ══════════════════════════════════════════════════════════════════════════ */
function syncSheet() {
  D.body.classList.toggle('fc-sheet', isMobile() && !!(ERP.Builder && ERP.Builder.pickerOpen) &&
                                      global.cur === 'invoiceBuilder');
}
/* The app's own tables were written for a desktop and have no cell labels.
   Rather than rewrite fourteen screens, the header text is copied onto each
   cell after every render so the same card layout can be used. */
function labelTables() {
  if (!isMobile()) return;
  var tables = D.querySelectorAll('#view .tw > table');
  Array.prototype.forEach.call(tables, function (t) {
    if (t.getAttribute('data-fclabelled') === '1') return;
    var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) {
      return (th.textContent || '').trim();
    });
    if (!heads.length) return;
    Array.prototype.forEach.call(t.tBodies, function (b) {
      Array.prototype.forEach.call(b.rows, function (r) {
        Array.prototype.forEach.call(r.cells, function (c, i) {
          if (!c.hasAttribute('data-label') && heads[i] !== undefined) {
            c.setAttribute('data-label', heads[i]);
          }
        });
      });
    });
    t.setAttribute('data-fclabelled', '1');
  });
}
ERP.labelTables = labelTables;

function syncBody() {
  D.body.classList.toggle('fc-mobile', isMobile());
  D.body.classList.toggle('fc-builder', global.cur === 'invoiceBuilder');
  D.body.classList.toggle('fc-hidechrome',
    !!D.querySelector('#fcviewer.on') || D.body.classList.contains('printing'));
  syncSheet();
  buildTabbar();
  labelTables();
}

/* the product sheet is opened and closed by the builder — follow it */
var origResults = null;
function hookRenderer() {
  if (!ERP.BuilderRender || origResults) return;
  origResults = ERP.BuilderRender.results;
  ERP.BuilderRender.results = function () {
    origResults.apply(ERP.BuilderRender, arguments);
    syncSheet();
    /* on a phone the sheet should start at the top of the list */
    var box = D.querySelector('.fcb-results');
    if (box && isMobile()) box.scrollTop = 0;
  };
}

var origPaint = global.paint;
global.paint = function (loading) {
  origPaint.apply(global, arguments);
  try { hookRenderer(); syncBody(); } catch (e) {}
};

var origViewerOpen = ERP.Viewer.open, origViewerClose = ERP.Viewer.close;
ERP.Viewer.open = function (model, opts) {
  /* a phone screen is narrower than A4 — open the sheet already fitted */
  if (isMobile() && (!opts || !opts.zoom)) {
    opts = Object.assign({}, opts, { zoom: fitZoom() });
  }
  origViewerOpen.call(ERP.Viewer, model, opts);
  syncBody();
};
ERP.Viewer.close = function () { origViewerClose.call(ERP.Viewer); syncBody(); };

function fitZoom() {
  var w = global.innerWidth || 380;
  var A4 = 794;                                  /* 210 mm at 96 dpi */
  return Math.min(1, Math.max(0.3, Math.round((w - 16) / A4 * 100) / 100));
}

/* re-fit and re-lay-out when the phone is turned */
function onViewport() {
  syncBody();
  if (ERP.Viewer.current && isMobile()) {
    ERP.Viewer.zoom = fitZoom();
    var page = D.getElementById('fcvPage');
    if (page) page.style.transform = 'scale(' + ERP.Viewer.zoom + ')';
  }
  if (global.cur === 'invoiceBuilder') { try { ERP.BuilderRender.lines(); } catch (e) {} }
}
if (mq && mq.addEventListener) mq.addEventListener('change', onViewport);
else if (mq && mq.addListener) mq.addListener(onViewport);
global.addEventListener('resize', function () {
  clearTimeout(onViewport._t);
  onViewport._t = setTimeout(onViewport, 150);
});
global.addEventListener('orientationchange', function () { setTimeout(onViewport, 250); });

/* keep the field the person is typing in above the on-screen keyboard */
D.addEventListener('focusin', function (e) {
  if (!isMobile()) return;
  var el = e.target;
  if (!el.matches || !el.matches('.fcb-in, .fcb-search input, .fcb-mini')) return;
  setTimeout(function () {
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 250);
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SIDEBAR TOGGLE AT EVERY WIDTH
   See the CSS note above. Between 901 and 1200px the base app has already forced the
   narrow rail, so its collapse handler (which sets body.mini = the same 68px) does
   nothing visible. There, this handler runs FIRST (capture phase) and toggles
   body.fc-wide instead — and stops the click so the base handler never also fires.
   Everywhere else the base handler runs exactly as before. The choice is remembered.
   ══════════════════════════════════════════════════════════════════════════ */
var WIDE_KEY = 'farooqco_rail_wide';
function narrowDesktop() { var w = global.innerWidth || 1400; return w <= 1200 && w > 900; }
function syncRailLabel() {
  var b = D.getElementById('mini'); if (!b) return;
  var collapsed = narrowDesktop() ? !D.body.classList.contains('fc-wide') : D.body.classList.contains('mini');
  var t = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  b.setAttribute('aria-label', t); b.title = t;
}
D.addEventListener('click', function (e) {
  var hit = e.target && e.target.closest && e.target.closest('#mini');
  if (!hit) return;
  if (!narrowDesktop()) { setTimeout(syncRailLabel, 0); return; }     /* base handler toggles body.mini; refresh the label after it */
  e.stopPropagation();
  var on = D.body.classList.toggle('fc-wide');
  try { global.localStorage.setItem(WIDE_KEY, on ? '1' : '0'); } catch (x) {}
  syncRailLabel();
}, true);
try { if (global.localStorage.getItem(WIDE_KEY) === '1') D.body.classList.add('fc-wide'); } catch (x) {}
global.addEventListener('resize', syncRailLabel);
syncRailLabel();

/* on a phone the search box is the fastest way in — focus it when the
   product sheet opens, but never steal focus on a desktop */
ERP.mobile = {
  isMobile: isMobile, fitZoom: fitZoom, sync: syncBody, tabs: TABS
};

hookRenderer();
syncBody();
})(typeof window !== 'undefined' ? window : globalThis);
