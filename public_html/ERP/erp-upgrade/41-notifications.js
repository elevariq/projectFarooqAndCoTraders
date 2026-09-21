/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 41
   NOTIFICATIONS — what the bell opens

   The bell used to answer with a three-second toast ("136 products need stock
   attention.") that vanished before it could be read, said nothing about WHICH
   products, and offered no way to go and deal with them. It is now a panel:

     · a popover under the bell on a computer, a bottom sheet on a phone
     · every item says what is wrong, gives the figures, and one tap takes the
       person to the screen that fixes it (already filtered, e.g. Inventory on
       "No stock")
     · nothing is stored: the list is worked out from the books each time it is
       opened, so it can never be out of date or contradict a screen
     · the red dot follows what the person has SEEN: opening the panel marks the
       present set as seen (per device), and the dot comes back only when
       something new appears or a figure changes

   What raises a notification (each shown only when it applies):
     · the data is not being saved (the "Saved" chip in the account menu is warning)   — urgent
     · products with no stock, products at or below their reorder level
     · orders still waiting to be approved
     · shops that owe money (the Receivables figure) and mills/suppliers we owe
     · finished goods still lying at a mill
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP; if (!ERP) return;
var D = global.document; if (!D) return;

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function I(n) { try { return global.I ? global.I(n) : ''; } catch (e) { return ''; } }
function nf(n) { try { return global.nf ? global.nf(n) : String(n); } catch (e) { return String(n); } }
function rs(n) { try { return global.rs ? global.rs(n) : String(n); } catch (e) { return String(n); } }
function can(p) { try { return ERP.Can ? ERP.Can(p) : true; } catch (e) { return false; } }
function $id(id) { return D.getElementById(id); }

var SEEN_KEY = 'farooqco_notif_seen';
var MAX_NAMES = 3;

/* ══════════════════════════════════════════════════════════════════════════
   THE LIST — worked out from the books, most urgent first
   Each item: { id, tone: 'bad'|'warn'|'info', icon, title, detail, go, status, sig }
   ══════════════════════════════════════════════════════════════════════════ */
function names(list) {
  var out = list.slice(0, MAX_NAMES).map(function (p) {
    var en = (p.en || '').trim(), ur = (p.ur || '').trim();
    return esc(en || ur || 'Product');
  });
  var more = list.length - out.length;
  return out.join(', ') + (more > 0 ? ' and ' + nf(more) + ' more' : '');
}

function items() {
  var out = [];
  try {
    /* 1. the data is not being saved — the one thing that must never be missed */
    var db = $id('fcDbChip');
    if (db && /\b(bad|warn)\b/.test(db.className)) {
      var bad = /\bbad\b/.test(db.className);
      out.push({ id: 'save', tone: 'bad', icon: 'alert', title: bad ? 'Your last change was not saved' : 'Saving is running slowly',
        detail: 'Check your connection. Do not close this page until the status says Saved.', go: null, sig: 'save:' + (bad ? 'bad' : 'warn') });
    }
  } catch (e) {}

  try {
    /* the same definition as the Inventory badge and the dashboard card, so the three numbers always agree */
    var prods = (global.PRODUCTS || []).filter(Boolean);
    var none = [], low = [];
    prods.forEach(function (p) {
      var l = global.levelOf(p);
      if (l === 'out') none.push(p); else if (l === 'low') low.push(p);
    });
    if (none.length) out.push({ id: 'out', tone: 'bad', icon: 'box',
      title: nf(none.length) + (none.length === 1 ? ' product has no stock' : ' products have no stock'),
      detail: names(none), go: 'inventory', status: 'No stock', sig: 'out:' + none.length });
    if (low.length) out.push({ id: 'low', tone: 'warn', icon: 'alert',
      title: nf(low.length) + (low.length === 1 ? ' product is running low' : ' products are running low'),
      detail: names(low), go: 'inventory', status: 'Low stock', sig: 'low:' + low.length });
  } catch (e) {}

  try {
    var pend = (global.ORDERS || []).filter(function (o) { return o && o.st === 'Pending'; });
    if (pend.length) out.push({ id: 'orders', tone: 'warn', icon: 'clip',
      title: nf(pend.length) + (pend.length === 1 ? ' order is waiting for approval' : ' orders are waiting for approval'),
      detail: 'Open Orders to approve or hold them.', go: 'orders', status: 'Pending', sig: 'orders:' + pend.length });
  } catch (e) {}

  try {
    if (can('COLLECTION_VIEW') || can('FINANCIAL_REPORT_VIEW') || can('PAYMENT_CREATE')) {
      var owing = (global.CUSTOMERS || []).filter(function (c) { return c && (c.bal || 0) > 0; });
      var total = owing.reduce(function (a, c) { return a + (c.bal || 0); }, 0);
      if (owing.length) out.push({ id: 'recv', tone: 'info', icon: 'wallet',
        title: nf(owing.length) + (owing.length === 1 ? ' shop owes you money' : ' shops owe you money'),
        detail: 'Together ' + esc(rs(total)) + ' to collect.', go: 'customers', sig: 'recv:' + owing.length + ':' + Math.round(total) });
      var due = (global.SUPPLIERS || []).filter(function (s) { return s && (s.due || 0) > 0; });
      var dueTotal = due.reduce(function (a, s) { return a + (s.due || 0); }, 0);
      if (due.length) out.push({ id: 'pay', tone: 'info', icon: 'mill',
        title: 'You owe ' + nf(due.length) + (due.length === 1 ? ' supplier' : ' suppliers'),
        detail: 'Together ' + esc(rs(dueTotal)) + ' to pay.', go: 'suppliers', sig: 'pay:' + due.length + ':' + Math.round(dueTotal) });
    }
  } catch (e) {}

  try {
    if (ERP.Milling && ERP.Milling.atMillTotals) {
      var t = ERP.Milling.atMillTotals();
      if (t && t.qty > 0) out.push({ id: 'mills', tone: 'info', icon: 'warehouse',
        title: nf(t.qty) + (t.qty === 1 ? ' bag is' : ' bags are') + ' still lying at the mills',
        detail: 'Finished goods that have not reached a warehouse yet.', go: 'millstock', sig: 'mills:' + Math.round(t.qty) });
    }
  } catch (e) {}
  return out;
}

function signature(list) { return list.map(function (i) { return i.sig; }).join('|'); }
function readSeen() { try { return global.localStorage.getItem(SEEN_KEY) || ''; } catch (e) { return ''; } }
function writeSeen(v) { try { global.localStorage.setItem(SEEN_KEY, v); } catch (e) {} }

/* ══════════════════════════════════════════════════════════════════════════
   STYLE
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
.fcn{position:fixed;z-index:130;width:392px;max-width:calc(100vw - 20px);max-height:min(560px,calc(100vh - 84px));
  display:none;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:16px;
  box-shadow:var(--sh-lg);overflow:hidden}
.fcn.on{display:flex}
.fcn-h{display:flex;align-items:center;gap:10px;padding:14px 14px 12px 18px;border-bottom:1px solid var(--line-2)}
.fcn-h h2{margin:0;font-size:15.5px;font-weight:800;letter-spacing:-.02em}
.fcn-h .fcn-n{font-size:12px;font-weight:800;padding:2px 9px;border-radius:99px;background:var(--violet-50);color:var(--violet)}
.fcn-h .fcn-x{margin-left:auto;width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:var(--muted)}
.fcn-h .fcn-x:hover{background:var(--surface-2);color:var(--ink)}
.fcn-h .fcn-x svg{width:17px;height:17px}
.fcn-b{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:2px;overscroll-behavior:contain}
.fcn-row{display:flex;align-items:flex-start;gap:12px;width:100%;padding:11px 10px;border-radius:12px;text-align:left;
  background:none;border:0;font:inherit;color:inherit;cursor:pointer}
.fcn-row:hover,.fcn-row:focus-visible{background:var(--surface-2)}
.fcn-row:focus-visible{outline:2px solid var(--violet);outline-offset:-2px}
.fcn-row[disabled]{cursor:default}
.fcn-row[disabled]:hover{background:none}
.fcn-ic{width:36px;height:36px;flex:0 0 36px;border-radius:10px;display:grid;place-items:center}
.fcn-ic svg{width:18px;height:18px}
.fcn-row.bad .fcn-ic{background:var(--clay-50);color:var(--clay)}
.fcn-row.warn .fcn-ic{background:var(--ochre-50);color:var(--ochre)}
.fcn-row.info .fcn-ic{background:var(--steel-50);color:var(--steel)}
.fcn-t{min-width:0;flex:1}
.fcn-t b{display:block;font-size:13.5px;font-weight:700;line-height:1.35;color:var(--ink)}
.fcn-t span{display:block;margin-top:2px;font-size:12.5px;line-height:1.4;color:var(--muted);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fcn-go{flex:0 0 auto;align-self:center;color:var(--faint);display:grid}
.fcn-go svg{width:16px;height:16px}
.fcn-row:hover .fcn-go{color:var(--violet)}
.fcn-empty{padding:34px 22px 30px;text-align:center}
.fcn-empty .ei{width:48px;height:48px;margin:0 auto 12px;border-radius:14px;display:grid;place-items:center;background:var(--green-50);color:var(--green)}
.fcn-empty .ei svg{width:24px;height:24px}
.fcn-empty b{display:block;font-size:14.5px;font-weight:800}
.fcn-empty p{margin:4px 0 0;font-size:13px;color:var(--muted)}
.fcn-f{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--line-2);background:var(--surface-2)}
.fcn-f button{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 10px;border-radius:9px;font-size:13px;font-weight:700;color:var(--violet)}
.fcn-f button:hover{background:var(--violet-50)}
.fcn-f button svg{width:15px;height:15px}
.fcn-scrim{position:fixed;inset:0;z-index:129;background:rgba(14,11,24,.4);display:none}
.fcn-scrim.on{display:block}
.top #bellBtn .dot.fcn-seen{display:none}
.top #bellBtn[aria-expanded="true"]{background:var(--violet-50);color:var(--violet)}

/* a phone: a bottom sheet, thumb-reachable, with room for the home bar */
@media (max-width:640px){
  .fcn{left:0 !important;right:0 !important;top:auto !important;bottom:0;width:auto;max-width:none;max-height:82vh;
    border-radius:18px 18px 0 0;border-width:1px 0 0;padding-bottom:env(safe-area-inset-bottom,0px)}
  .fcn-h::before{content:'';position:absolute;left:50%;top:6px;width:38px;height:4px;margin-left:-19px;border-radius:4px;background:var(--line)}
  .fcn-h{padding-top:18px}
  .fcn-row{padding:13px 10px}
}
@media print{ .fcn,.fcn-scrim{display:none !important} }
`;
(function () {
  var st = D.createElement('style'); st.id = 'fc-notif-css'; st.textContent = CSS; D.head.appendChild(st);
})();

/* ══════════════════════════════════════════════════════════════════════════
   BUILD / OPEN / CLOSE
   ══════════════════════════════════════════════════════════════════════════ */
var lastFocus = null;

function ensure() {
  var el = $id('fcNotif');
  if (el) return el;
  el = D.createElement('div');
  el.id = 'fcNotif'; el.className = 'fcn'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Notifications');
  el.tabIndex = -1;
  var sc = D.createElement('div'); sc.id = 'fcNotifScrim'; sc.className = 'fcn-scrim';
  D.body.appendChild(sc); D.body.appendChild(el);
  return el;
}

function render() {
  var el = ensure(), list = items();
  var body;
  if (!list.length) {
    body = '<div class="fcn-empty"><div class="ei">' + I('checkC') + '</div><b>You are all caught up</b>' +
      '<p>Nothing needs your attention right now.</p></div>';
  } else {
    body = '<div class="fcn-b">' + list.map(function (n) {
      var tag = n.go ? 'button' : 'div';
      return '<' + tag + (n.go ? ' type="button" data-fcn-go="' + esc(n.go) + '"' + (n.status ? ' data-fcn-status="' + esc(n.status) + '"' : '') : '') +
        ' class="fcn-row ' + n.tone + '"' + (n.go ? '' : ' style="cursor:default"') + '>' +
        '<span class="fcn-ic">' + I(n.icon) + '</span>' +
        '<span class="fcn-t"><b>' + esc(n.title) + '</b><span>' + n.detail + '</span></span>' +
        (n.go ? '<span class="fcn-go" aria-hidden="true">' + I('chev') + '</span>' : '') +
        '</' + tag + '>';
    }).join('') + '</div>';
  }
  el.innerHTML =
    '<div class="fcn-h"><h2>Notifications</h2>' + (list.length ? '<span class="fcn-n">' + list.length + '</span>' : '') +
      '<button type="button" class="fcn-x" data-fcn-close="1" aria-label="Close notifications">' + I('x') + '</button></div>' +
    body +
    '<div class="fcn-f"><button type="button" data-fcn-go="alerts">' + I('message') + 'WhatsApp &amp; SMS alerts</button></div>';
  return list;
}

function place() {
  var el = $id('fcNotif'), bell = $id('bellBtn'); if (!el || !bell) return;
  var narrow = (global.innerWidth || 1200) <= 640;
  if (narrow) { el.style.top = ''; el.style.left = ''; el.style.right = ''; return; }
  var r = bell.getBoundingClientRect(), w = Math.min(392, (global.innerWidth || 1200) - 20);
  var left = Math.max(10, Math.min(r.right - w, (global.innerWidth || 1200) - w - 10));
  el.style.left = left + 'px'; el.style.right = 'auto'; el.style.top = Math.round(r.bottom + 8) + 'px';
}

function isOpen() { var el = $id('fcNotif'); return !!(el && el.classList.contains('on')); }

function open() {
  try { if (ERP.TopBar && ERP.TopBar.close) ERP.TopBar.close(); } catch (e) {}
  var list = render(), el = ensure(), bell = $id('bellBtn'), sc = $id('fcNotifScrim');
  place();
  el.classList.add('on');
  if ((global.innerWidth || 1200) <= 640 && sc) sc.classList.add('on');
  if (bell) { bell.setAttribute('aria-expanded', 'true'); bell.setAttribute('aria-haspopup', 'dialog'); }
  lastFocus = D.activeElement;
  writeSeen(signature(list));
  refresh();
  try { el.focus({ preventScroll: true }); } catch (e) {}
}
function close(restore) {
  var el = $id('fcNotif'), bell = $id('bellBtn'), sc = $id('fcNotifScrim');
  if (el) el.classList.remove('on');
  if (sc) sc.classList.remove('on');
  if (bell) bell.setAttribute('aria-expanded', 'false');
  if (restore !== false && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  lastFocus = null;
}

/* the dot: only for what the person has not seen yet */
function refresh() {
  var bell = $id('bellBtn'); if (!bell) return;
  bell.setAttribute('aria-haspopup', 'dialog'); if (!bell.hasAttribute('aria-expanded')) bell.setAttribute('aria-expanded', 'false');
  var dot = bell.querySelector('.dot'), list = items();
  var unseen = list.length > 0 && signature(list) !== readSeen();
  if (dot) dot.classList.toggle('fcn-seen', !unseen);
  bell.setAttribute('aria-label', list.length
    ? 'Notifications — ' + list.length + (list.length === 1 ? ' item' : ' items') + (unseen ? ', new' : '')
    : 'Notifications — none');
}

/* ══════════════════════════════════════════════════════════════════════════
   EVENTS
   ══════════════════════════════════════════════════════════════════════════ */
D.addEventListener('click', function (e) {
  var t = e.target; if (!t || !t.closest) return;
  var bell = t.closest('#bellBtn');
  if (bell) {
    /* the app's own handler would answer with a toast — this replaces it */
    e.preventDefault(); e.stopPropagation();
    if (isOpen()) close(); else open();
    return;
  }
  if (!isOpen()) return;
  if (t.closest('[data-fcn-close]') || t.closest('#fcNotifScrim')) { e.preventDefault(); close(); return; }
  var go = t.closest('[data-fcn-go]');
  if (go) {
    e.preventDefault(); e.stopPropagation();
    var page = go.getAttribute('data-fcn-go'), status = go.getAttribute('data-fcn-status');
    close(false);
    try {
      global.go(page);
      if (status && global.FIL) { global.FIL.status = status; global.paint(); }
    } catch (err) {}
    return;
  }
  if (t.closest('#fcNotif')) return;
  close(false);                                               /* a click anywhere else */
}, true);

D.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); }
}, true);
global.addEventListener('resize', function () { if (isOpen()) { var sc = $id('fcNotifScrim'); place(); if (sc) sc.classList.toggle('on', (global.innerWidth || 1200) <= 640); } });
D.addEventListener('scroll', function () { if (isOpen()) place(); }, true);

/* keep the dot honest after every screen change, and re-list if the panel is open while something changes */
var origPaint = global.paint;
if (typeof origPaint === 'function') {
  global.paint = function () {
    origPaint.apply(global, arguments);
    try { if (isOpen()) { render(); writeSeen(signature(items())); } refresh(); } catch (e) {}
  };
}
try { refresh(); } catch (e) {}

ERP.Notifications = { items: items, open: open, close: close, isOpen: isOpen, refresh: refresh, seenKey: SEEN_KEY };

})(typeof window !== 'undefined' ? window : globalThis);
