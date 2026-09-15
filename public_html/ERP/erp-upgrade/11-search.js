/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 11
   GLOBAL SEARCH
   One box that finds a shop, a product, a mill, an invoice, a receipt or a
   transfer from a letter or two — in Urdu or English, and forgiving about
   spelling. Results are grouped, ranked, keyboard-driven, and the index is
   built once and kept warm.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, D = global.document;
var I = function (n) { return global.I ? global.I(n) : ''; };
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(x) { return global.fmtDate ? global.fmtDate(x) : x; }

/* ══════════════════════════════════════════════════════════════════════════
   NORMALISATION
   Urdu is written several ways for the same word — ی/ي, ک/ك, ہ/ه/ة, the alef
   forms, optional diacritics and the zero-width joiner. Digits arrive in
   both Arabic-Indic and Latin. Everything is folded to one form before it is
   compared, so ‘زم زم’ typed any of the usual ways still finds Zam Zam.
   ══════════════════════════════════════════════════════════════════════════ */
var DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
               '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
var LETTERS = { 'ي': 'ی', 'ﻱ': 'ی', 'ئ': 'ی', 'ى': 'ی', 'ﻲ': 'ی',
                'ك': 'ک', 'ﻙ': 'ک',
                'ه': 'ہ', 'ة': 'ہ', 'ۃ': 'ہ', 'ھ': 'ہ',
                'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ﺍ': 'ا',
                'ؤ': 'و', 'ۀ': 'ہ' };

function normalize(s) {
  if (s === null || s === undefined) return '';
  var out = String(s).toLowerCase();
  out = out.replace(/[\u064B-\u0652\u0670\u0640\u200c\u200d\u200e\u200f]/g, '');
  out = out.replace(/[٠-٩۰-۹]/g, function (c) { return DIGITS[c] || c; });
  out = out.replace(/[يﻱئىﻲكﻙهةۃھأإآٱﺍؤۀ]/g, function (c) { return LETTERS[c] || c; });
  out = out.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return out.replace(/\s+/g, ' ').trim();
}
function words(s) { return normalize(s).split(' ').filter(Boolean); }

/* ── scoring ─────────────────────────────────────────────────────────────
   Prefix beats word-start beats anywhere beats a forgiving match. A single
   letter is enough, and a slip of one or two letters still finds the row. */
function subsequenceScore(hay, q) {
  var hi = 0, qi = 0, gaps = 0, started = -1;
  while (hi < hay.length && qi < q.length) {
    if (hay[hi] === q[qi]) { if (started < 0) started = hi; qi++; }
    else if (qi > 0) gaps++;
    hi++;
  }
  if (qi < q.length) return 0;
  return Math.max(0, 46 - Math.min(gaps, 20) - Math.min(started, 10));
}
function editWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur[0] = i; var best = cur[0];
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur.slice();
  }
  return prev[b.length] <= max;
}
function tokenScore(hay, hayWords, q) {
  if (!q) return 0;
  if (hay.indexOf(q) === 0) return 100;
  for (var i = 0; i < hayWords.length; i++) {
    if (hayWords[i].indexOf(q) === 0) return 92 - Math.min(i, 8);
  }
  var at = hay.indexOf(q);
  if (at > -1) return 74 - Math.min(at, 20);
  if (q.length >= 3) {
    for (var k = 0; k < hayWords.length; k++) {
      var w = hayWords[k];
      if (Math.abs(w.length - q.length) <= 2 && editWithin(w, q, q.length >= 6 ? 2 : 1)) {
        return 58 - Math.min(k, 8);                      /* a typo, not a miss */
      }
    }
  }
  return q.length >= 2 ? subsequenceScore(hay, q) : 0;
}
function scoreRecord(rec, qWords) {
  var total = 0;
  for (var i = 0; i < qWords.length; i++) {
    var s = tokenScore(rec.hay, rec.words, qWords[i]);
    if (!s) return 0;                                     /* every word must land */
    total += s;
  }
  return total / qWords.length + (rec.boost || 0);
}

/* ══════════════════════════════════════════════════════════════════════════
   INDEX
   ══════════════════════════════════════════════════════════════════════════ */
var GROUPS = [
  { key: 'customers', label: 'Shops & customers', icon: 'shop' },
  { key: 'products',  label: 'Products',          icon: 'box' },
  { key: 'suppliers', label: 'Suppliers & mills', icon: 'mill' },
  { key: 'invoices',  label: 'Invoices & sales',  icon: 'tag' },
  { key: 'orders',    label: 'Orders & quotations', icon: 'doc' },
  { key: 'purchases', label: 'Purchases',         icon: 'truck' },
  { key: 'payments',  label: 'Payments & receipts', icon: 'wallet' },
  { key: 'documents', label: 'Stock documents',   icon: 'layers' },
  { key: 'places',    label: 'Regions & warehouses', icon: 'pin' }
];

var index = null, stamp = '';
function currentStamp() {
  var S = ERP.S;
  return [(global.PRODUCTS || []).length, (global.CUSTOMERS || []).length, (global.SUPPLIERS || []).length,
          S.invoices.length, S.invoiceItems.length, S.purchases.length, S.orders.length,
          S.payments.length, S.stockDocs.length, S.custReturns.length, S.supReturns.length].join('.');
}
function entry(group, id, title, subtitle, fields, action, boost, meta) {
  var hay = normalize(fields.filter(Boolean).join(' '));
  return { group: group, id: id, title: title, subtitle: subtitle, hay: hay,
           words: hay.split(' ').filter(Boolean), action: action, boost: boost || 0, meta: meta || null };
}

function build() {
  var S = ERP.S, out = [];
  var src = ERP.sources || {};
  var custs = src.CUSTS ? src.CUSTS() : (global.CUSTOMERS || []);
  var prods = src.PRODS ? src.PRODS() : (global.PRODUCTS || []);
  var sups  = src.SUPS  ? src.SUPS()  : (global.SUPPLIERS || []);

  custs.forEach(function (c) {
    var bal = ERP.Ledger.customerBalance(c.id);
    var region = global.regionTxt ? global.regionTxt(c.region) : '';
    out.push(entry('customers', c.id, c.sh || c.ow || c.id,
      [c.ow, region, c.ph].filter(Boolean).join(' · ') + (bal ? ' · ' + M.fmt(bal) + ' due' : ''),
      [c.sh, c.ow, c.nameUr, c.ph, c.wa, c.addr, c.area, c.route, c.legacyCode, c.id, region,
       M.toR(bal), bal > 0 ? 'due outstanding balance' : 'clear paid'],
      { type: 'customer', id: c.id }, bal > 0 ? 4 : 0));
  });

  prods.forEach(function (p) {
    var stock = ERP.Inventory.totalFor(p.id);
    out.push(entry('products', p.id, (p.ur ? p.ur + '  ' : '') + (p.en || ''),
      [p.brandEn || p.brand, p.cat, p.kg ? p.kg + ' KG' : '', Number(stock).toLocaleString('en-US') + ' bags']
        .filter(Boolean).join(' · '),
      [p.en, p.ur, p.nameEn, p.normalizedName, p.brand, p.brandEn, p.cat, p.sku, p.sourceFolio, p.id,
       p.kg ? p.kg + ' kg' : '', stock > 0 ? 'in stock available' : 'out of stock'],
      { type: 'product', id: p.id }, stock > 0 ? 3 : -2));
  });

  var supProducts = {};
  S.purchaseItems.forEach(function (it) {
    var pu = ERP.Purchases.byId(it.purchaseId); if (!pu) return;
    (supProducts[pu.supplierId] = supProducts[pu.supplierId] || []).push(
      it.descriptionEnSnapshot + ' ' + it.descriptionSnapshot);
  });
  sups.forEach(function (s) {
    out.push(entry('suppliers', s.id, s.co || s.id,
      [s.cp, s.ph, s.lo].filter(Boolean).join(' · ') || 'Supplier',
      [s.co, s.cp, s.ph, s.wa, s.lo, s.legacyCode, s.id, s.notes,
       (supProducts[s.id] || []).slice(0, 40).join(' ')],
      { type: 'supplier', id: s.id }));
  });

  S.invoices.forEach(function (i) {
    var items = ERP.Invoices.items(i.id);
    out.push(entry('invoices', i.id, i.invoiceNumber || 'Draft invoice',
      [i.shopNameSnapshot, fmtDate(i.invoiceDate), M.fmt(i.grandTotal),
       ERP.STATUS_LABEL[i.status]].filter(Boolean).join(' · '),
      [i.invoiceNumber, i.shopNameSnapshot, i.customerNameSnapshot, i.mobileSnapshot, i.orderNumber,
       i.dispatchNumber, i.referenceNo, i.regionSnapshot, i.warehouseSnapshot, i.invoiceDate,
       fmtDate(i.invoiceDate), ERP.STATUS_LABEL[i.status], ERP.STATUS_LABEL[i.paymentStatus],
       M.toR(i.grandTotal), i.paymentMethod,
       items.map(function (x) { return x.descriptionEnSnapshot + ' ' + x.descriptionSnapshot + ' ' + x.brandSnapshot; }).join(' '),
       i.description || '', i.notes || ''],
      { type: 'invoice', id: i.id }, 5));
  });

  S.orders.forEach(function (o) {
    out.push(entry('orders', o.id, o.orderNumber,
      [o.shopNameSnapshot, fmtDate(o.orderDate), M.fmt(o.grandTotal)].join(' · '),
      [o.orderNumber, o.shopNameSnapshot, o.customerNameSnapshot, o.regionSnapshot, o.orderDate,
       fmtDate(o.orderDate), ERP.STATUS_LABEL[o.status], M.toR(o.grandTotal), o.kind,
       ERP.Orders.items(o.id).map(function (x) { return x.descriptionEnSnapshot + ' ' + x.descriptionSnapshot; }).join(' ')],
      { type: 'order', id: o.id }, 3));
  });

  S.purchases.forEach(function (p) {
    out.push(entry('purchases', p.id, p.purchaseNumber,
      [p.supplierNameSnapshot, fmtDate(p.purchaseDate), M.fmt(p.grandTotal)].join(' · '),
      [p.purchaseNumber, p.supplierNameSnapshot, p.supplierInvoiceNo, p.vehicleNo, p.driver,
       p.warehouseSnapshot, p.purchaseDate, fmtDate(p.purchaseDate), M.toR(p.grandTotal),
       ERP.Purchases.items(p.id).map(function (x) { return x.descriptionEnSnapshot + ' ' + x.descriptionSnapshot; }).join(' '),
       p.description || '', p.notes || ''],
      { type: 'purchase', id: p.id }, 2));
  });

  S.payments.forEach(function (p) {
    out.push(entry('payments', p.id, p.receiptNumber,
      [p.partyNameSnapshot, p.method, M.fmt(p.amount), fmtDate(p.paymentDate)].join(' · '),
      [p.receiptNumber, p.partyNameSnapshot, p.partyOwnerSnapshot, p.method, p.reference,
       p.paymentDate, fmtDate(p.paymentDate), M.toR(p.amount),
       p.direction === 'IN' ? 'received receipt' : 'paid voucher',
       p.description || '', p.note || ''],
      { type: 'payment', id: p.id }, 2));
  });

  S.stockDocs.forEach(function (d) {
    out.push(entry('documents', d.id, d.docNumber,
      [ERP.StockDocs.TYPES[d.type] ? ERP.StockDocs.TYPES[d.type].title : d.type,
       d.warehouseSnapshot, fmtDate(d.docDate)].filter(Boolean).join(' · '),
      [d.docNumber, d.type, d.warehouseSnapshot, d.toWarehouseSnapshot, d.customerSnapshot,
       d.vehicleNo, d.driver, d.reason, d.docDate, fmtDate(d.docDate)],
      { type: 'stockdoc', id: d.id }, 1));
  });
  S.custReturns.forEach(function (r) {
    out.push(entry('documents', r.id, r.returnNumber,
      ['Customer return', r.customerNameSnapshot, M.fmt(r.creditAmount)].join(' · '),
      [r.returnNumber, r.customerNameSnapshot, r.invoiceNumber, r.reason, r.returnDate, 'return credit note'],
      { type: 'custreturn', id: r.id }, 1));
  });
  S.supReturns.forEach(function (r) {
    out.push(entry('documents', r.id, r.returnNumber,
      ['Supplier return', r.supplierNameSnapshot, M.fmt(r.debitAmount)].join(' · '),
      [r.returnNumber, r.supplierNameSnapshot, r.purchaseNumber, r.reason, r.returnDate, 'return supplier'],
      { type: 'supreturn', id: r.id }, 1));
  });

  (global.REGIONS || []).forEach(function (r) {
    var n = (global.CUSTOMERS || []).filter(function (c) { return c.region === r.id; }).length;
    out.push(entry('places', r.id, (r.ur || '') + '  ' + (r.en || ''), n + ' shops',
      [r.en, r.ur, r.id, 'region area'], { type: 'region', id: r.id }));
  });
  (global.WAREHOUSES || []).forEach(function (w) {
    out.push(entry('places', w.id, w.name,
      Number(ERP.Inventory.totalFor ? 0 : 0).toString() ? 'Warehouse' : 'Warehouse',
      [w.name, w.id, 'warehouse godown store'], { type: 'warehouse', id: w.id }));
  });

  return out;
}

function ensureIndex(force) {
  var s = currentStamp();
  if (!force && index && s === stamp) return index;
  index = build(); stamp = s;
  return index;
}
/* records change through one place, so that is where the index is dropped */
if (ERP.Mirror) {
  var origRefresh = ERP.Mirror.refresh;
  ERP.Mirror.refresh = function () { origRefresh.apply(ERP.Mirror, arguments); index = null; };
}

function query(q, limit) {
  var qWords = words(q);
  if (!qWords.length) return [];
  var recs = ensureIndex(), hits = [];
  for (var i = 0; i < recs.length; i++) {
    var sc = scoreRecord(recs[i], qWords);
    if (sc > 0) hits.push({ rec: recs[i], score: sc });
  }
  hits.sort(function (a, b) { return b.score - a.score; });
  /* keep every group represented rather than letting one flood the list */
  var perGroup = {}, picked = [], max = limit || 24;
  hits.forEach(function (h) {
    var g = h.rec.group;
    perGroup[g] = (perGroup[g] || 0) + 1;
    if (perGroup[g] <= 5 && picked.length < max) picked.push(h);
  });
  return picked;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE PALETTE
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
#fcSearch{position:fixed;inset:0;z-index:130;display:none;background:rgba(14,12,22,.45);
  backdrop-filter:blur(2px);padding:8vh 16px 16px;overflow:hidden}
#fcSearch.on{display:block}
.fcs-box{max-width:660px;margin:0 auto;background:var(--surface);border:1px solid var(--line);
  border-radius:16px;box-shadow:0 24px 70px rgba(12,10,20,.35);overflow:hidden;
  animation:fcsIn .14s cubic-bezier(.32,.72,0,1)}
@keyframes fcsIn{from{opacity:0;transform:translateY(-8px) scale(.985)}to{opacity:1;transform:none}}
.fcs-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}
.fcs-head svg{color:var(--muted);flex:none}
.fcs-head input{flex:1;border:none;outline:none;background:none;font-size:17px;padding:6px 0;color:var(--ink)}
.fcs-kbd{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;
  padding:2px 6px;font-family:var(--mono)}
.fcs-list{max-height:62vh;overflow:auto;padding:6px;overscroll-behavior:contain}
.fcs-g{font-size:10.5px;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);
  padding:10px 10px 5px;font-weight:700}
.fcs-i{display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:9px 10px;
  border:none;background:none;border-radius:10px;cursor:pointer}
.fcs-i:hover,.fcs-i.on{background:var(--violet-50)}
.fcs-i .fico{width:32px;height:32px;border-radius:9px;background:var(--surface-2);display:grid;
  place-items:center;color:var(--violet);flex:none}
.fcs-i.on .fico{background:var(--violet);color:#fff}
.fcs-t{flex:1;min-width:0}
.fcs-t b{display:block;font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fcs-t span{display:block;font-size:12.5px;color:var(--muted);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.fcs-t mark{background:var(--violet-100);color:inherit;border-radius:3px;padding:0 1px}
.fcs-go{font-size:11px;color:var(--muted);flex:none}
.fcs-none{padding:28px 18px;text-align:center;color:var(--muted)}
.fcs-foot{display:flex;gap:14px;align-items:center;padding:9px 14px;border-top:1px solid var(--line);
  font-size:11.5px;color:var(--muted);flex-wrap:wrap}
#fcSearchBtn{display:none}
@media (max-width:760px){
  #fcSearch{padding:0}
  .fcs-box{max-width:none;height:100%;border-radius:0;border:none;display:flex;flex-direction:column}
  .fcs-list{max-height:none;flex:1}
  .fcs-head input{font-size:16px}
  .fcs-foot{display:none}
  body.fc-mobile #fcSearchBtn{display:grid}
}`;
(function () {
  var st = D.createElement('style'); st.id = 'fc-search-css'; st.textContent = CSS; D.head.appendChild(st);
})();

var Palette = {
  open: false, results: [], cursor: 0, q: '',

  host: function () {
    var h = D.getElementById('fcSearch');
    if (!h) {
      h = D.createElement('div');
      h.id = 'fcSearch';
      h.innerHTML =
        '<div class="fcs-box" role="dialog" aria-label="Search">' +
          '<div class="fcs-head">' + I('search') +
            '<input id="fcsInput" placeholder="Search shops, products, mills, invoices…" ' +
              'autocomplete="off" spellcheck="false" aria-label="Search everything">' +
            '<span class="fcs-kbd">Esc</span>' +
          '</div>' +
          '<div class="fcs-list" id="fcsList"></div>' +
          '<div class="fcs-foot"><span><b>↑ ↓</b> move</span><span><b>Enter</b> open</span>' +
            '<span><b>Esc</b> close</span><span>Urdu and English · spelling forgiven</span></div>' +
        '</div>';
      D.body.appendChild(h);
    }
    return h;
  },

  show: function (initial) {
    var h = Palette.host();
    h.classList.add('on');
    Palette.open = true;
    var input = D.getElementById('fcsInput');
    input.value = initial || '';
    Palette.run(input.value);
    setTimeout(function () { input.focus(); input.select(); }, 20);
  },
  hide: function () {
    var h = D.getElementById('fcSearch');
    if (h) h.classList.remove('on');
    Palette.open = false;
    var gq = D.getElementById('gq');
    if (gq) gq.value = '';
  },

  run: function (q) {
    Palette.q = q;
    Palette.results = q.trim() ? query(q) : [];
    Palette.cursor = 0;
    Palette.render();
  },

  render: function () {
    var list = D.getElementById('fcsList');
    if (!list) return;
    if (!Palette.q.trim()) {
      list.innerHTML = '<div class="fcs-none">' + I('search') +
        '<p style="margin-top:8px">Start typing — one letter is enough.<br>' +
        'Shops, products, mills, invoices, receipts and stock documents are all searched at once.</p></div>';
      return;
    }
    if (!Palette.results.length) {
      list.innerHTML = '<div class="fcs-none"><b>Nothing matches “' + esc(Palette.q) + '”</b>' +
        '<p style="margin-top:6px">Try fewer letters, the Urdu spelling, or a shop code.</p></div>';
      return;
    }
    var byGroup = {};
    Palette.results.forEach(function (h) { (byGroup[h.rec.group] = byGroup[h.rec.group] || []).push(h); });
    var flat = 0, html = '';
    GROUPS.forEach(function (g) {
      var rows = byGroup[g.key];
      if (!rows || !rows.length) return;
      html += '<div class="fcs-g">' + esc(g.label) + '</div>';
      rows.forEach(function (h) {
        var on = flat === Palette.cursor;
        html += '<button class="fcs-i' + (on ? ' on' : '') + '" data-fcs="' + flat + '" role="option">' +
          '<span class="fico">' + I(g.icon) + '</span>' +
          '<span class="fcs-t"><b>' + highlight(h.rec.title, Palette.q) + '</b>' +
          '<span>' + esc(h.rec.subtitle || '') + '</span></span>' +
          '<span class="fcs-go">' + (on ? 'Enter ↵' : '') + '</span></button>';
        h.flat = flat; flat++;
      });
    });
    list.innerHTML = html;
    Palette.flat = [];
    GROUPS.forEach(function (g) {
      (byGroup[g.key] || []).forEach(function (h) { Palette.flat.push(h); });
    });
  },

  move: function (dir) {
    if (!Palette.results.length) return;
    Palette.cursor = (Palette.cursor + dir + Palette.results.length) % Palette.results.length;
    Palette.render();
    var el = D.querySelector('.fcs-i.on');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  },
  activate: function (ix) {
    var hit = (Palette.flat || [])[ix === undefined ? Palette.cursor : ix];
    if (!hit) return;
    Palette.hide();
    Palette.go(hit.rec.action);
  },

  go: function (a) {
    if (!a) return;
    switch (a.type) {
      case 'customer':  global.go('customerProfile', a.id); break;
      case 'supplier':  global.go('supplierProfile', a.id); break;
      case 'product':
        global.go('inventory');
        setTimeout(function () {
          var p = global.prodOf(a.id);
          var box = D.querySelector('[data-filter=tbl]');
          if (p && box) { box.value = p.en || p.ur; global.FIL.q = box.value; global.applyFilters(); }
        }, 60);
        break;
      case 'invoice':   ERP.Viewer.open(ERP.DocModel.invoice(a.id)); break;
      case 'order':     ERP.Viewer.open(ERP.DocModel.order(a.id)); break;
      case 'purchase':  ERP.Viewer.open(ERP.DocModel.purchase(a.id)); break;
      case 'payment':   ERP.Viewer.open(ERP.DocModel.receipt(a.id)); break;
      case 'stockdoc':  ERP.Viewer.open(ERP.DocModel.stockDoc(a.id)); break;
      case 'custreturn': ERP.Viewer.open(ERP.DocModel.customerReturn(a.id)); break;
      case 'supreturn': ERP.Viewer.open(ERP.DocModel.supplierReturn(a.id)); break;
      case 'region':
        global.go('customers');
        setTimeout(function () { global.FIL.region = a.id; global.applyFilters(); }, 60);
        break;
      case 'warehouse': global.go('inventory'); break;
    }
  }
};

function highlight(text, q) {
  var raw = String(text || '');
  var qs = words(q);
  if (!qs.length) return esc(raw);
  var norm = normalize(raw);
  /* mark the first place each word lands, mapped back to the original text */
  var marks = [];
  qs.forEach(function (w) {
    var at = norm.indexOf(w);
    if (at > -1) marks.push([at, at + w.length]);
  });
  if (!marks.length) return esc(raw);
  marks.sort(function (a, b) { return a[0] - b[0]; });
  var outStr = '', ni = 0, ri = 0, mi = 0, open = false;
  while (ri < raw.length) {
    var ch = raw[ri];
    var isSep = normalize(ch) === '';
    if (!open && mi < marks.length && ni === marks[mi][0]) { outStr += '<mark>'; open = true; }
    outStr += esc(ch);
    if (!isSep) ni += normalize(ch).length || 1;
    ri++;
    if (open && mi < marks.length && ni >= marks[mi][1]) { outStr += '</mark>'; open = false; mi++; }
  }
  if (open) outStr += '</mark>';
  return outStr;
}

/* ══ wiring ══ */
D.addEventListener('focusin', function (e) {
  if (e.target && e.target.id === 'gq' && !Palette.open) Palette.show(e.target.value || '');
});
D.addEventListener('input', function (e) {
  if (e.target && e.target.id === 'fcsInput') Palette.run(e.target.value);
});
D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var item = e.target.closest('[data-fcs]');
  if (item) { e.preventDefault(); Palette.activate(+item.dataset.fcs); return; }
  if (e.target.id === 'fcSearch') { Palette.hide(); return; }
  var btn = e.target.closest('#fcSearchBtn');
  if (btn) { e.preventDefault(); Palette.show(''); }
}, true);
D.addEventListener('keydown', function (e) {
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault(); Palette.show(''); return;
  }
  if (!Palette.open) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); Palette.move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); Palette.move(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); Palette.activate(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Palette.hide(); }
}, true);

/* a search button for the phone, where the header box is hidden */
function ensureButton() {
  if (D.getElementById('fcSearchBtn')) return;
  var anchor = D.getElementById('bellBtn');
  if (!anchor || !anchor.parentNode) return;
  var b = D.createElement('button');
  b.id = 'fcSearchBtn';
  b.className = anchor.className;
  b.setAttribute('aria-label', 'Search');
  b.innerHTML = I('search');
  anchor.parentNode.insertBefore(b, anchor);
}
var origPaint = global.paint;
global.paint = function () { origPaint.apply(global, arguments); try { ensureButton(); } catch (e) {} };
ensureButton();

/* the old inline search is replaced by the palette */
global.globalSearch = function (q) { if (q && !Palette.open) Palette.show(q); else if (Palette.open) Palette.run(q); };

ERP.Search = {
  normalize: normalize, words: words, query: query, score: tokenScore,
  reindex: function () { return ensureIndex(true); }, index: function () { return ensureIndex(); },
  palette: Palette, groups: GROUPS
};
})(typeof window !== 'undefined' ? window : globalThis);
