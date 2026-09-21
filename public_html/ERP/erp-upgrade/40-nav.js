/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 40
   THE SIDEBAR — one icon per screen, groups that read as groups

   Three things were wrong with the left menu:
     1. The group names ("Inventory & supply", "Finance"…) were a line of small
        grey text with no shape of their own, so on a menu of 24 screens they
        blended into the buttons around them.
     2. Fifteen of the 24 screens shared an icon with another screen (three
        "wallets", three "people", three "charts", three "mills"…), so the icon
        column told you nothing.
     3. The company name was shown twice: the round logo already spells
        "FAROOQ & CO", and the words "Farooq & Co Traders" sat right beside it.

   What this module does (nothing here renames a screen, moves a route or
   changes who may open what):
     · Every menu entry gets its OWN icon (ICONS below). The icons are added to
       the app's one icon set (window.P, exposed by the bridge), so the same
       names work everywhere else (command palette, phone "More" sheet…).
     · Each group is a real section header: a caps label, a hairline running out
       to a chevron, and a hairline between groups. The header is a button that
       folds its group away; the choice is remembered on this device, and the
       group holding the screen you are on always stays open. In the narrow icon
       rail the headers are gone and a thin divider marks each group instead —
       nothing is ever hidden there.
     · The logo is shown as an EMBLEM (the F-and-wheat monogram, cropped by
       CSS from the same logo.png) wherever the name is written next to it, so
       the name appears once.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP; if (!ERP) return;
var D = global.document; if (!D) return;

/* ══════════════════════════════════════════════════════════════════════════
   ICONS  (24×24 outline, same 1.7 stroke as the rest of the set)
   Only added when the name is free, so nothing the app already draws changes.
   ══════════════════════════════════════════════════════════════════════════ */
var EXTRA = {
  coins:     'M4 6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5-3.6-2.5-8-2.5S4 4.6 4 6zM4 6v4.5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V6M4 10.5V15c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-4.5M4 15v3.5C4 19.9 7.6 21 12 21s8-1.1 8-2.5V15',
  wheat:     'M12 22V7M12 7c-2.3 0-3.6-1.6-3.6-3.6C10.7 3.4 12 5 12 7zM12 7c2.3 0 3.6-1.6 3.6-3.6C13.3 3.4 12 5 12 7zM12 12.5c-2.3 0-3.6-1.6-3.6-3.6 2.3 0 3.6 1.6 3.6 3.6zM12 12.5c2.3 0 3.6-1.6 3.6-3.6-2.3 0-3.6 1.6-3.6 3.6zM12 18c-2.3 0-3.6-1.6-3.6-3.6 2.3 0 3.6 1.6 3.6 3.6zM12 18c2.3 0 3.6-1.6 3.6-3.6-2.3 0-3.6 1.6-3.6 3.6z',
  warehouse: 'M3 21V9l9-6 9 6v12M3 21h18M8 21v-7h8v7M8 17.5h8',
  receipt:   'M5 3h14v18l-2.5-1.8L14 21l-2-1.8L10 21l-2.5-1.8L5 21zM9 8h6M9 12h6M9 16h3',
  ledger:    'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13M8 7.5h7M8 11.5h5',
  banknote:  'M2 6h20v12H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 10.01V10M18 14.01V14',
  calc:      'M5 3h14v18H5zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
  card:      'M2 5h20v14H2zM2 10h20M6 15h4',
  trend:     'M3 17l6-6 4 4 8-8M15 7h6v6',
  map:       'M9 4L3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5zM9 4v14M15 6.5v14',
  folder:    'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  message:   'M4 5h16v11H9l-5 4zM8 9h8M8 12.5h5',
  shield:    'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2 2 4-4',
  edit:      'M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17zM14.5 7.5l3 3',
  eye:       'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  check2:    'M4 12.5l4.5 4.5L20 6.5M8 12.5l4.5 4.5',
  arrowR:    'M5 12h14M13 6l6 6-6 6',
  info:      'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
  package:   'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9M8 5.3l8 4.4'
};
(function () {
  var P = null; try { P = global.P; } catch (e) {}
  if (!P) return;
  Object.keys(EXTRA).forEach(function (k) { if (!P[k]) P[k] = EXTRA[k]; });
})();

/* the icon each screen uses. One per screen — a test fails if two share one. */
var ICONS = {
  dashboard: 'grid',
  inventory: 'box',
  stockvalue: 'coins',
  purchases: 'cart',
  milling: 'wheat',
  millstock: 'warehouse',
  suppliers: 'mill',
  sales: 'receipt',
  orders: 'clip',
  dispatch: 'truck',
  customers: 'shop',
  payments: 'wallet',
  soa: 'ledger',
  payroll: 'banknote',
  landed: 'calc',
  expenses: 'card',
  profit: 'trend',
  reports: 'chart',
  areawise: 'map',
  documents: 'folder',
  alerts: 'message',
  users: 'shield',
  accounts: 'users',
  settings: 'gear'
};

function applyIcons() {
  try {
    (global.NAV || []).forEach(function (n) { if (ICONS[n.id] && n.i !== ICONS[n.id]) n.i = ICONS[n.id]; });
  } catch (e) {}
}

/* ══════════════════════════════════════════════════════════════════════════
   STYLE
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
/* a group: header (a real button) + its items */
.nav-grp{margin:0}
.nav-grp+.nav-grp{margin-top:6px;padding-top:6px;border-top:1px solid var(--line-2)}
.nav button.nav-sec{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;margin:0;padding:6px 8px 6px 12px;
  border:0;border-radius:8px;background:none;text-align:left;font:inherit;font-size:10.5px;font-weight:800;
  letter-spacing:.1em;text-transform:uppercase;color:var(--faint);cursor:pointer}
.nav button.nav-sec::after{content:'';flex:1 1 auto;height:1px;background:var(--line-2);order:1;min-width:8px}
.nav button.nav-sec .nav-sec-t{order:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav button.nav-sec .nav-chv{order:2;display:grid;place-items:center;width:18px;height:18px;border-radius:5px;color:var(--faint);
  transition:transform .18s ease}
.nav button.nav-sec .nav-chv svg{width:13px;height:13px}
.nav button.nav-sec:hover{background:var(--surface-2);color:var(--ink)}
.nav button.nav-sec:hover::after{background:var(--line)}
.nav button.nav-sec:focus-visible{outline:2px solid var(--violet);outline-offset:-2px}
.nav-grp.closed .nav-chv{transform:rotate(-90deg)}
.nav-grp.closed .nav-items{display:none}
.nav-grp:first-child>button.nav-sec{padding-top:2px}
/* the group holding the open screen gets a marker on its header */
.nav-grp.here>button.nav-sec{color:var(--violet)}
.nav-grp.here>button.nav-sec .nav-chv{color:var(--violet)}

/* the narrow icon rail: no headers, a divider between groups, and nothing ever folded away */
@media (max-width:1200px) and (min-width:901px){
  body:not(.fc-wide) .nav-grp.closed .nav-items{display:block}
  body:not(.fc-wide) .nav button.nav-sec{display:none}
  body:not(.fc-wide) .nav-grp+.nav-grp{margin-top:8px;padding-top:8px}
}
body.mini .nav-grp.closed .nav-items{display:block}
body.mini .nav button.nav-sec{display:none}
body.mini .nav-grp+.nav-grp{margin-top:8px;padding-top:8px}
@media (min-width:1201px){ body.mini .nav a{justify-content:center;padding:9px} }

/* item polish: a steady 40px row, the label truncates instead of pushing the count out */
.nav a{transition:background .14s ease,color .14s ease}
.nav a .lbl{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav a.on{font-weight:700}

/* the logo is shown whole (the base .mark img is object-fit:contain) — a crop to the monogram was tried and reverted */
.mark{box-shadow:0 0 0 1px var(--line)}

/* small buttons that used to hold a text glyph (a cross, an arrow, a pencil) now hold an icon */
.fcv-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px}
.fcv-btn svg{width:15px;height:15px;flex:0 0 15px}
.icon-btn.sm{display:inline-grid;place-items:center}
.icon-btn.sm svg,.fcb-acts .icon-btn svg{width:15px;height:15px}
.st-chip button{display:inline-grid;place-items:center}
.st-chip button svg,.fce-charge button svg,.fce-line .rm svg{width:13px;height:13px}
td .ic svg,button.ic svg{width:15px;height:15px}
@media print{ .nav{display:none} }
`;
(function () {
  var st = D.createElement('style'); st.id = 'fc-nav-css'; st.textContent = CSS; D.head.appendChild(st);
})();

/* ══════════════════════════════════════════════════════════════════════════
   STATE — which groups the person folded away (per device)
   ══════════════════════════════════════════════════════════════════════════ */
var KEY = 'farooqco_nav_closed';
function readClosed() {
  try { var v = JSON.parse(global.localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function writeClosed(list) { try { global.localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function I(n) { try { return global.I ? global.I(n) : ''; } catch (e) { return ''; } }

/* ══════════════════════════════════════════════════════════════════════════
   BUILD — take the flat list the app draws and fold it into groups
   ══════════════════════════════════════════════════════════════════════════ */
function regroup() {
  var nav = D.getElementById('nav'); if (!nav) return;
  if (nav.querySelector('.nav-grp')) return;             /* already grouped (a second call in the same paint) */
  var closed = readClosed();
  var kids = Array.prototype.slice.call(nav.children);
  var groups = [], curG = null;
  kids.forEach(function (el) {
    if (el.classList && el.classList.contains('nav-sec')) {
      curG = { name: el.textContent.trim(), items: [] }; groups.push(curG);
    } else if (curG) curG.items.push(el);
  });
  if (!groups.length) return;
  var frag = D.createDocumentFragment();
  groups.forEach(function (g, ix) {
    var here = g.items.some(function (a) { return a.classList && a.classList.contains('on'); });
    var shut = closed.indexOf(g.name) > -1 && !here;
    var wrap = D.createElement('div');
    wrap.className = 'nav-grp' + (shut ? ' closed' : '') + (here ? ' here' : '');
    wrap.setAttribute('data-g', g.name);
    var head = D.createElement('button');
    head.type = 'button'; head.className = 'nav-sec'; head.setAttribute('data-navgrp', g.name);
    head.setAttribute('aria-expanded', shut ? 'false' : 'true');
    head.id = 'navg' + ix;
    head.innerHTML = '<span class="nav-sec-t">' + esc(g.name) + '</span><span class="nav-chv" aria-hidden="true">' + I('chevD') + '</span>';
    var body = D.createElement('div');
    body.className = 'nav-items'; body.setAttribute('role', 'group'); body.setAttribute('aria-labelledby', head.id);
    g.items.forEach(function (a) {
      var lbl = a.querySelector && a.querySelector('.lbl');
      if (lbl && !a.getAttribute('title')) a.setAttribute('title', lbl.textContent.trim());   /* the narrow rail shows only the icon */
      if (a.classList && a.classList.contains('on')) a.setAttribute('aria-current', 'page');
      body.appendChild(a);
    });
    /* a role that may open none of a group's screens (other modules hide their links) sees no header for it either */
    if (g.items.length && g.items.every(function (a) { return a.style && a.style.display === 'none'; })) wrap.style.display = 'none';
    wrap.appendChild(head); wrap.appendChild(body); frag.appendChild(wrap);
  });
  nav.innerHTML = '';
  nav.appendChild(frag);
}

function toggle(head) {
  var wrap = head.closest('.nav-grp'); if (!wrap) return;
  var name = head.getAttribute('data-navgrp');
  var shut = !wrap.classList.contains('closed');
  /* the group of the open screen cannot be folded: the person would lose sight of where they are */
  if (shut && wrap.classList.contains('here')) return;
  wrap.classList.toggle('closed', shut);
  head.setAttribute('aria-expanded', shut ? 'false' : 'true');
  var list = readClosed().filter(function (n) { return n !== name; });
  if (shut) list.push(name);
  writeClosed(list);
}
D.addEventListener('click', function (e) {
  var h = e.target && e.target.closest && e.target.closest('button[data-navgrp]');
  if (!h) return;
  e.preventDefault(); e.stopPropagation();
  toggle(h);
}, true);

/* ══════════════════════════════════════════════════════════════════════════
   HOOKS
   ══════════════════════════════════════════════════════════════════════════ */
var origPaintNav = global.paintNav;
if (typeof origPaintNav === 'function') {
  global.paintNav = function () {
    applyIcons();
    origPaintNav.apply(global, arguments);
    try { regroup(); } catch (e) {}
  };
}
applyIcons();
try { global.paintNav && global.paintNav(); } catch (e) {}

ERP.Nav = { ICONS: ICONS, EXTRA_ICONS: EXTRA, regroup: regroup, closed: readClosed };

})(typeof window !== 'undefined' ? window : globalThis);
