/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 14
   THE REPORTS ROOM
   A date bar, summary cards, charts and the detail behind them, for sales,
   purchases, stock, shops, mills, returns and money — with the period in
   plain words at the top and Print, PDF, Word and Excel at the bottom.
   (§1 §2 §12)
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, D = global.document, FDB = global.FDB, S = global.ERP.S;
var A = ERP.Analytics, Period = ERP.Period;
var I = function (n) { return global.I ? global.I(n) : ''; };
var u = function (t) { return global.u ? global.u(t) : t; };
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(x) { return global.fmtDate ? global.fmtDate(x) : x; }
function qty(n) { return Number(n || 0).toLocaleString('en-US'); }
function today() { return global.FC_TODAY ? global.FC_TODAY() : new Date().toISOString().slice(0, 10); }
function say(m) { return global.say ? global.say(m) : null; }

var R = ERP.ReportState = {
  tab: 'overview', kind: 'month', from: null, to: null, label: '',
  filters: { customerId: '', supplierId: '', productId: '', warehouseId: '', regionId: '',
             brand: '', method: '', category: '' }
};
function resolve() {
  var r = Period.resolve(R.kind, R.from, R.to);
  return { from: r[0], to: r[1], label: r[2] };
}

/* ══════════════════════════════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
.rp-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--surface);
  border:1px solid var(--line);border-radius:var(--r-lg);padding:11px 13px;margin-bottom:14px}
.rp-chip{border:1px solid var(--line);background:var(--surface);border-radius:99px;padding:7px 13px;
  font-size:13px;font-weight:600;min-height:38px;cursor:pointer;transition:.14s var(--ease)}
.rp-chip:hover{border-color:#C9BCEB;background:var(--violet-50)}
.rp-chip.on{background:var(--violet);border-color:var(--violet);color:#fff}
.rp-dates{display:flex;gap:6px;align-items:center;margin-left:auto;flex-wrap:wrap}
.rp-dates input,.rp-dates select{padding:8px 10px;border:1.5px solid var(--line);border-radius:var(--r-sm);
  background:var(--surface);font-size:14px;min-height:38px}
.rp-period{font-size:12.5px;color:var(--muted);width:100%}
.rp-period b{color:var(--ink)}
.rp-tabs{display:flex;gap:6px;overflow-x:auto;margin-bottom:14px;padding-bottom:2px;
  scrollbar-width:none}
.rp-tabs::-webkit-scrollbar{display:none}
.rp-tabs button{flex:0 0 auto;border:1px solid var(--line);background:var(--surface);border-radius:10px;
  padding:9px 15px;font-size:13.5px;font-weight:600;min-height:42px;white-space:nowrap}
.rp-tabs button.on{background:var(--violet);border-color:var(--violet);color:#fff;box-shadow:var(--sh-accent)}
.rp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:11px;margin-bottom:14px}
.rp-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px 15px}
.rp-card i{font-style:normal;display:block;font-size:11px;letter-spacing:.6px;text-transform:uppercase;
  color:var(--muted);margin-bottom:5px}
.rp-card b{display:block;font-size:22px;font-weight:800;letter-spacing:-.4px;font-variant-numeric:tabular-nums}
.rp-card span{display:block;font-size:12px;color:var(--muted);margin-top:3px}
.rp-card.good b{color:var(--green)} .rp-card.bad b{color:var(--clay)}
.rp-sum{background:linear-gradient(150deg,var(--violet-50),var(--surface));border:1px solid var(--line);
  border-left:3px solid var(--violet);border-radius:var(--r-lg);padding:14px 16px;margin-bottom:14px;
  font-size:14px;line-height:1.65}
.rp-sum h4{margin:0 0 5px;font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--violet)}
.rp-charts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
@media (max-width:900px){.rp-charts{grid-template-columns:1fr}}
.rp-chart{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px}
.rp-chart h4{margin:0 0 10px;font-size:13px}
.rp-chart svg{width:100%;height:auto;display:block}
.rp-chart .empty-note{color:var(--muted);font-size:13px;padding:18px 0;text-align:center}
.rp-exports{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
.rp-exports .btn{min-height:42px}
.rp-none{background:var(--surface);border:1px dashed var(--line);border-radius:var(--r-lg);
  padding:34px 18px;text-align:center;color:var(--muted)}
.rp-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:8px}
.rp-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:5px}
@media (max-width:760px){
  body.fc-mobile .rp-dates{margin-left:0;width:100%}
  body.fc-mobile .rp-dates input,body.fc-mobile .rp-dates select{flex:1;min-width:0;font-size:16px}
  body.fc-mobile .rp-cards{grid-template-columns:1fr 1fr}
  body.fc-mobile .rp-card b{font-size:18px}
  body.fc-mobile .rp-exports .btn{flex:1 1 46%;justify-content:center}
}
@media print{.rp-bar,.rp-tabs,.rp-exports{display:none !important}}
`;
(function () { var s = D.createElement('style'); s.id = 'fc-reports-css'; s.textContent = CSS; D.head.appendChild(s); })();

/* ══════════════════════════════════════════════════════════════════════════
   CHARTS — drawn by hand, no libraries, scale to the screen
   ══════════════════════════════════════════════════════════════════════════ */
function barChart(rows, opts) {
  opts = opts || {};
  if (!rows || !rows.length) return '<div class="empty-note">Nothing in this period.</div>';
  rows = rows.slice(0, opts.max || 8);
  var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value); })) || 1;
  var w = 640, rowH = 30, h = rows.length * rowH + 8;
  var labelW = 190, barW = w - labelW - 96;
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" preserveAspectRatio="xMinYMin meet">' +
    rows.map(function (r, i) {
      var y = i * rowH + 4, len = Math.max(2, Math.abs(r.value) / max * barW);
      return '<text x="0" y="' + (y + 15) + '" font-size="12.5" fill="currentColor" ' +
          'opacity=".75">' + esc(String(r.label).slice(0, 30)) + '</text>' +
        '<rect x="' + labelW + '" y="' + (y + 4) + '" width="' + len + '" height="15" rx="4" ' +
          'fill="' + (r.value < 0 ? 'var(--clay)' : 'var(--violet)') + '" opacity="' +
          (0.95 - i * 0.07) + '"></rect>' +
        '<text x="' + w + '" y="' + (y + 16) + '" font-size="12" text-anchor="end" ' +
          'fill="currentColor" font-weight="600">' + esc(r.text || M.fmt(r.value)) + '</text>';
    }).join('') + '</svg>';
}
function lineChart(points, opts) {
  opts = opts || {};
  if (!points || points.length < 2) {
    return points && points.length === 1
      ? '<div class="empty-note">Only one day in this period — ' + esc(M.fmt(points[0].value)) + '.</div>'
      : '<div class="empty-note">Not enough days to draw a trend.</div>';
  }
  var w = 640, h = 190, pad = 26;
  var max = Math.max.apply(null, points.map(function (p) { return p.value; })) || 1;
  var stepX = (w - pad * 2) / (points.length - 1);
  var xy = points.map(function (p, i) {
    return [pad + i * stepX, h - pad - (p.value / max) * (h - pad * 2)];
  });
  var path = xy.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  var area = path + ' L' + xy[xy.length - 1][0].toFixed(1) + ' ' + (h - pad) + ' L' + pad + ' ' + (h - pad) + ' Z';
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" preserveAspectRatio="none">' +
    '<line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) +
      '" stroke="currentColor" opacity=".18"></line>' +
    '<path d="' + area + '" fill="var(--violet)" opacity=".10"></path>' +
    '<path d="' + path + '" fill="none" stroke="var(--violet)" stroke-width="2.4" ' +
      'stroke-linejoin="round" stroke-linecap="round"></path>' +
    xy.map(function (p, i) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.8" fill="var(--violet)">' +
        '<title>' + esc(fmtDate(points[i].date) + ' — ' + M.fmt(points[i].value)) + '</title></circle>';
    }).join('') +
    '<text x="' + pad + '" y="' + (h - 6) + '" font-size="11" fill="currentColor" opacity=".6">' +
      esc(fmtDate(points[0].date)) + '</text>' +
    '<text x="' + (w - pad) + '" y="' + (h - 6) + '" font-size="11" text-anchor="end" ' +
      'fill="currentColor" opacity=".6">' + esc(fmtDate(points[points.length - 1].date)) + '</text>' +
    '<text x="' + pad + '" y="14" font-size="11" fill="currentColor" opacity=".6">peak ' +
      esc(M.fmt(max)) + '</text></svg>';
}

/* ══════════════════════════════════════════════════════════════════════════
   REPORT BUILDERS — one shape used by the screen and by every export
   ══════════════════════════════════════════════════════════════════════════ */
function money(p) { return M.toR(p); }
function card(label, value, note, cls) { return { label: label, value: value, note: note || '', cls: cls || '' }; }

var TABS = [
  ['overview',  'Overview'], ['sales', 'Sales'], ['purchases', 'Purchases'],
  ['inventory', 'Stock movement'], ['customer', 'Shop record'], ['supplier', 'Supplier record'],
  ['returns',   'Returns'], ['money', 'Payments & expenses']
];

function build(tab, from, to, label) {
  var f = R.filters;
  switch (tab) {
    case 'overview': {
      var s = A.sales(from, to, f), p = A.purchases(from, to, f), pay = A.payments(from, to, f);
      return {
        id: 'overview', title: 'Business overview', from: from, to: to, periodLabel: label,
        cards: [
          card('Revenue', M.fmt(s.revenue), s.count + ' invoices'),
          card('Gross profit', M.fmt(s.grossProfit), s.margin + '% margin', 'good'),
          card('Bags sold', qty(s.bags), s.lines + ' lines'),
          card('Collected', M.fmt(s.collected), 'From shops'),
          card('Purchases', M.fmt(p.total), p.count + ' from mills'),
          card('Expenses', M.fmt(pay.expenseTotal), pay.expenses.length + ' entries'),
          card('Owed by shops', M.fmt(pay.receivable), 'All time', pay.receivable ? 'bad' : ''),
          card('Owed to mills', M.fmt(pay.payable), 'All time', pay.payable ? 'bad' : '')
        ],
        charts: [
          { title: 'Revenue by day', svg: lineChart(s.trend) },
          { title: 'Sales by region', svg: barChart(s.byRegion.map(function (r) {
              return { label: r.label, value: r.revenue }; })) },
          { title: 'Best selling products', svg: barChart(s.byProduct.map(function (r) {
              return { label: r.nameEn || r.name, value: r.revenue }; })) },
          { title: 'Top shops', svg: barChart(s.byCustomer.map(function (r) {
              return { label: r.label, value: r.revenue }; })) }
        ],
        columns: [['Date', 'l'], ['Invoice', 'l'], ['Shop', 'l'], ['Region', 'l'],
                  ['Bags', 'r'], ['Total', 'r'], ['Paid', 'r'], ['Balance', 'r'], ['Status', 'l']],
        rows: s.invoices.map(function (i) {
          return [fmtDate(i.invoiceDate), i.invoiceNumber, i.shopNameSnapshot, i.regionSnapshot,
                  qty(i.totalQty), money(i.grandTotal), money(ERP.Invoices.paidFor(i.id)),
                  money(ERP.Invoices.outstanding(i)), ERP.STATUS_LABEL[i.status]];
        }),
        footer: ['Total', '', '', '', qty(s.bags), money(s.revenue), money(s.collected),
                 money(s.outstanding), ''],
        summary: A.summary(from, to, f),
        sheets: [
          { name: 'Invoices', widths: [13, 18, 28, 20, 10, 14, 14, 14, 14] },
          { name: 'By product', widths: [30, 12, 12, 16, 16, 16],
            head: ['Product', 'Bags', 'Lines', 'Revenue', 'Cost', 'Gross profit'],
            rows: s.byProduct.map(function (r) {
              return [r.nameEn || r.name, r.bags, r.count, money(r.revenue), money(r.cost),
                      money(r.revenue - r.cost)]; }) },
          { name: 'By region', widths: [26, 12, 12, 18],
            head: ['Region', 'Invoices', 'Bags', 'Revenue'],
            rows: s.byRegion.map(function (r) { return [r.label, r.count, r.bags, money(r.revenue)]; }) },
          { name: 'By shop', widths: [30, 20, 12, 16, 16, 16],
            head: ['Shop', 'Region', 'Invoices', 'Revenue', 'Paid', 'Balance'],
            rows: s.byCustomer.map(function (r) {
              return [r.label, r.region, r.count, money(r.revenue), money(r.paid),
                      money(ERP.Ledger.customerBalance(r.id))]; }) }
        ]
      };
    }
    case 'sales': {
      var sa = A.sales(from, to, f);
      var rows = [];
      sa.invoices.forEach(function (i) {
        ERP.Invoices.items(i.id).forEach(function (it) {
          if (f.productId && it.productId !== f.productId) return;
          rows.push([fmtDate(i.invoiceDate), i.invoiceNumber, i.shopNameSnapshot,
                     it.descriptionEnSnapshot || it.descriptionSnapshot, it.packageSnapshot,
                     qty(it.quantity), money(it.unitPrice), money(it.lineTotal),
                     ERP.STATUS_LABEL[i.paymentStatus]]);
        });
      });
      return {
        id: 'sales', title: 'Sales report', from: from, to: to, periodLabel: label,
        cards: [
          card('Total sales', M.fmt(sa.revenue), sa.count + ' invoices'),
          card('Bags sold', qty(sa.bags), sa.lines + ' lines'),
          card('Gross profit', M.fmt(sa.grossProfit), sa.margin + '% margin', 'good'),
          card('Returns', M.fmt(sa.returned), sa.returnCount + ' returns'),
          card('Collected', M.fmt(sa.collected), 'In this period'),
          card('Still to collect', M.fmt(sa.outstanding), 'On these invoices', sa.outstanding ? 'bad' : '')
        ],
        charts: [
          { title: 'Revenue by day', svg: lineChart(sa.trend) },
          { title: 'Best selling products', svg: barChart(sa.byProduct.map(function (r) {
              return { label: r.nameEn || r.name, value: r.revenue }; })) },
          { title: 'Sales by region', svg: barChart(sa.byRegion.map(function (r) {
              return { label: r.label, value: r.revenue }; })) },
          { title: 'Top customers', svg: barChart(sa.byCustomer.map(function (r) {
              return { label: r.label, value: r.revenue }; })) }
        ],
        columns: [['Date', 'l'], ['Invoice', 'l'], ['Shop', 'l'], ['Product', 'l'], ['Pack', 'l'],
                  ['Qty', 'r'], ['Rate', 'r'], ['Amount', 'r'], ['Payment', 'l']],
        rows: rows,
        footer: ['Total', '', '', '', '', qty(sa.bags), '', money(sa.revenue), ''],
        summary: A.summary(from, to, f),
        sheets: [
          { name: 'Sales lines', widths: [13, 18, 26, 28, 10, 10, 13, 15, 14] },
          { name: 'Product-wise', widths: [30, 12, 16, 16, 16],
            head: ['Product', 'Bags sold', 'Revenue', 'Cost', 'Gross profit'],
            rows: sa.byProduct.map(function (r) {
              return [r.nameEn || r.name, r.bags, money(r.revenue), money(r.cost), money(r.revenue - r.cost)]; }) },
          { name: 'Region-wise', widths: [26, 12, 12, 18], head: ['Region', 'Invoices', 'Bags', 'Revenue'],
            rows: sa.byRegion.map(function (r) { return [r.label, r.count, r.bags, money(r.revenue)]; }) }
        ]
      };
    }
    case 'purchases': {
      var pu = A.purchases(from, to, f);
      var prows = [];
      pu.purchases.forEach(function (p) {
        ERP.Purchases.items(p.id).forEach(function (it) {
          if (f.productId && it.productId !== f.productId) return;
          prows.push([fmtDate(p.purchaseDate), p.purchaseNumber, p.supplierNameSnapshot,
                      it.descriptionEnSnapshot || it.descriptionSnapshot, p.warehouseSnapshot,
                      qty(it.orderedQty === undefined ? it.quantity : it.orderedQty),
                      qty(it.receivedQty === undefined ? it.quantity : it.receivedQty),
                      money(it.unitPrice), money(it.lineTotal)]);
        });
      });
      return {
        id: 'purchases', title: 'Purchase report', from: from, to: to, periodLabel: label,
        partyLabel: f.supplierId ? 'SUPPLIER' : '',
        partyName: f.supplierId && global.supOf(f.supplierId) ? global.supOf(f.supplierId).co : '',
        cards: [
          card('Total purchases', M.fmt(pu.total), pu.count + ' purchases'),
          card('Bags received', qty(pu.bags), ''),
          card('Paid to mills', M.fmt(pu.paid), 'In this period'),
          card('Still payable', M.fmt(pu.payable), f.supplierId ? 'This supplier' : 'All suppliers',
               pu.payable ? 'bad' : ''),
          card('Returned to mills', M.fmt(pu.returned), '')
        ],
        charts: [
          { title: 'Purchases by day', svg: lineChart(pu.trend) },
          { title: 'By supplier', svg: barChart(pu.bySupplier.map(function (r) {
              return { label: r.label, value: r.total }; })) },
          { title: 'By product', svg: barChart(pu.byProduct.map(function (r) {
              return { label: r.nameEn || r.name, value: r.total }; })) }
        ],
        columns: [['Date', 'l'], ['Purchase', 'l'], ['Supplier', 'l'], ['Product', 'l'],
                  ['Warehouse', 'l'], ['Ordered', 'r'], ['Received', 'r'], ['Rate', 'r'], ['Amount', 'r']],
        rows: prows,
        footer: ['Total', '', '', '', '', '', qty(pu.bags), '', money(pu.total)],
        summary: 'From ' + Period.label(from, to) + ': ' + pu.count + ' purchases worth ' +
          M.fmt(pu.total) + ' were received' +
          (pu.bySupplier.length ? ', the largest from ' + pu.bySupplier[0].label + ' at ' +
            M.fmt(pu.bySupplier[0].total) : '') + '. ' + M.fmt(pu.paid) +
          ' was paid to mills in the period and ' + M.fmt(pu.payable) + ' remains payable.',
        sheets: [
          { name: 'Purchase lines', widths: [13, 18, 26, 28, 16, 11, 11, 13, 15] },
          { name: 'By supplier', widths: [30, 12, 12, 16, 16, 16],
            head: ['Supplier', 'Purchases', 'Bags', 'Total', 'Paid in period', 'Payable now'],
            rows: pu.bySupplier.map(function (r) {
              return [r.label, r.count, r.bags, money(r.total), money(r.paid),
                      money(ERP.Ledger.supplierBalance(r.id))]; }) }
        ]
      };
    }
    case 'inventory': {
      var inv = A.inventory(from, to, f);
      return {
        id: 'inventory', title: 'Stock movement report', from: from, to: to, periodLabel: label,
        cards: [
          card('Opening stock', qty(inv.opening), 'bags at the start'),
          card('Received', qty(inv.received), 'from mills'),
          card('Sold', qty(inv.sold), 'to shops'),
          card('Returned in', qty(inv.returnedIn), 'back to sellable'),
          card('Closing stock', qty(inv.closing), 'bags at the end'),
          card('Damaged held', qty(inv.damaged), 'not sellable', inv.damaged ? 'bad' : '')
        ],
        charts: [
          { title: 'Most sold', svg: barChart(inv.rows.map(function (r) {
              return { label: r.nameEn, value: r.sold, text: qty(r.sold) + ' bags' }; })) },
          { title: 'Largest closing stock', svg: barChart(inv.rows.slice().sort(function (a, b) {
              return b.closing - a.closing; }).map(function (r) {
              return { label: r.nameEn + ' · ' + r.warehouse, value: r.closing,
                       text: qty(r.closing) + ' bags' }; })) }
        ],
        columns: [['Product', 'l'], ['Warehouse', 'l'], ['Opening', 'r'], ['Received', 'r'],
                  ['Sold', 'r'], ['Returned', 'r'], ['Transfers', 'r'], ['Adjusted', 'r'], ['Closing', 'r']],
        rows: inv.rows.map(function (r) {
          return [r.nameEn || r.name, r.warehouse, qty(r.opening), qty(r.received), qty(r.sold),
                  qty(r.returnedIn), qty(r.transferIn - r.transferOut), qty(r.adjusted), qty(r.closing)];
        }),
        footer: ['Total', '', qty(inv.opening), qty(inv.received), qty(inv.sold),
                 qty(inv.returnedIn), '', '', qty(inv.closing)],
        summary: 'From ' + Period.label(from, to) + ': ' + qty(inv.received) +
          ' bags came in and ' + qty(inv.sold) + ' went out, leaving ' + qty(inv.closing) +
          ' bags on hand' + (inv.damaged ? ' plus ' + qty(inv.damaged) + ' bags held as damaged' : '') + '.',
        sheets: [{ name: 'Stock movement',
          widths: [30, 16, 11, 11, 11, 11, 11, 11, 11] }]
      };
    }
    case 'customer': {
      var id = f.customerId || ((global.CUSTOMERS || [])[0] || {}).id;
      var rep = id ? A.customer(id, from, to) : null;
      if (!rep) return { id: 'customer', title: 'Shop record', from: from, to: to, empty: 'Choose a shop.' };
      var sm = rep.summary;
      return {
        id: 'customer', title: 'Shop record — ' + rep.profile.shop, from: from, to: to, periodLabel: label,
        partyLabel: 'SHOP', partyName: rep.profile.shop, partyOwner: rep.profile.owner,
        partyCode: rep.profile.code, partyContact: rep.profile.phone, partyRegion: rep.profile.region,
        partyId: id,
        meta: [['Address', rep.profile.address], ['Route / market', rep.profile.route],
               ['Customer type', rep.profile.type]],
        cards: [
          card('Orders', String(sm.orders), 'in this period'),
          card('Total sales', M.fmt(sm.sales), qty(sm.bags) + ' bags'),
          card('Paid', M.fmt(sm.paid), 'received in period'),
          card('Returns', M.fmt(sm.returns), ''),
          card('Opening balance', M.fmt(sm.opening), 'at the start'),
          card('Closing balance', M.fmt(sm.closing), 'owed now', sm.closing > 0 ? 'bad' : 'good')
        ],
        charts: [
          { title: 'Buying by day', svg: lineChart(rep.byDate.map(function (d) {
              return { date: d.date, value: d.amount }; })) },
          { title: 'What this shop buys', svg: barChart(rep.byProduct.map(function (r) {
              return { label: r.nameEn || r.name, value: r.revenue }; })) }
        ],
        columns: [['Date', 'l'], ['Invoice', 'l'], ['Product', 'l'], ['Pack', 'l'],
                  ['Qty', 'r'], ['Rate', 'r'], ['Amount', 'r'], ['Payment', 'l']],
        rows: rep.rows.map(function (r) {
          return [fmtDate(r.date), r.invoice, r.product, r.pack, qty(r.qty),
                  money(r.rate), money(r.amount), r.status];
        }),
        footer: ['Total', '', '', '', qty(sm.bags), '', money(sm.sales), ''],
        ledger: [
          ['Opening balance', M.fmt(sm.opening), 'سابقہ بقایا رقم'],
          ['Sales in this period', '+ ' + M.fmt(sm.sales), ''],
          ['Payments received', '− ' + M.fmt(sm.paid), ''],
          ['Returns and credits', '− ' + M.fmt(sm.returns), ''],
          ['Closing balance', M.fmt(sm.closing), 'بقایا رقم']
        ],
        summary: rep.profile.shop + ' (' + rep.profile.owner + ') placed ' + sm.orders +
          (sm.orders === 1 ? ' order' : ' orders') + ' for ' + qty(sm.bags) + ' bags worth ' +
          M.fmt(sm.sales) + ' between ' + Period.label(from, to) + '. ' + M.fmt(sm.paid) +
          ' was received' + (sm.returns ? ' and ' + M.fmt(sm.returns) + ' came back as returns' : '') +
          ', leaving a balance of ' + M.fmt(sm.closing) + '.',
        sheets: [
          { name: 'Sales detail', widths: [13, 18, 30, 10, 10, 14, 16, 14] },
          { name: 'Account statement', widths: [13, 18, 30, 14, 14, 16],
            head: ['Date', 'Reference', 'Particulars', 'Debit', 'Credit', 'Balance'],
            rows: rep.ledger.rows.map(function (r) {
              return [fmtDate(r.iso), r.ref, r.what, money(r.dr), money(r.cr), money(r.balance)]; }) },
          { name: 'Product-wise', widths: [30, 12, 16],
            head: ['Product', 'Bags', 'Amount'],
            rows: rep.byProduct.map(function (r) { return [r.nameEn || r.name, r.bags, money(r.revenue)]; }) }
        ]
      };
    }
    case 'supplier': {
      var sid = f.supplierId || ((global.SUPPLIERS || [])[0] || {}).id;
      var srep = sid ? A.supplier(sid, from, to) : null;
      if (!srep) return { id: 'supplier', title: 'Supplier record', from: from, to: to, empty: 'Choose a supplier.' };
      var ss = srep.summary;
      return {
        id: 'supplier', title: 'Supplier record — ' + srep.profile.name, from: from, to: to, periodLabel: label,
        partyLabel: 'SUPPLIER', partyName: srep.profile.name, partyContact: srep.profile.phone,
        partyCode: srep.profile.code, partyId: sid,
        cards: [
          card('Purchases', M.fmt(ss.purchases), ss.count + ' in period'),
          card('Bags received', qty(ss.bags), ''),
          card('Paid', M.fmt(ss.paid), 'in this period'),
          card('Returned', M.fmt(ss.returns), ''),
          card('Opening payable', M.fmt(ss.opening), ''),
          card('Closing payable', M.fmt(ss.closing), 'owed now', ss.closing > 0 ? 'bad' : 'good')
        ],
        charts: [{ title: 'What was bought', svg: barChart(srep.byProduct.map(function (r) {
          return { label: r.nameEn || r.name, value: r.total }; })) }],
        columns: [['Date', 'l'], ['Purchase', 'l'], ['Product', 'l'], ['Pack', 'l'],
                  ['Ordered', 'r'], ['Received', 'r'], ['Rate', 'r'], ['Amount', 'r']],
        rows: srep.rows.map(function (r) {
          return [fmtDate(r.date), r.purchase, r.product, r.pack, qty(r.ordered), qty(r.received),
                  money(r.rate), money(r.amount)];
        }),
        footer: ['Total', '', '', '', '', qty(ss.bags), '', money(ss.purchases)],
        ledger: [
          ['Opening payable', M.fmt(ss.opening), ''],
          ['Purchases', '+ ' + M.fmt(ss.purchases), ''],
          ['Paid', '− ' + M.fmt(ss.paid), ''],
          ['Returns', '− ' + M.fmt(ss.returns), ''],
          ['Closing payable', M.fmt(ss.closing), '']
        ],
        summary: srep.profile.name + ' supplied ' + qty(ss.bags) + ' bags worth ' + M.fmt(ss.purchases) +
          ' between ' + Period.label(from, to) + '. ' + M.fmt(ss.paid) + ' was paid, leaving ' +
          M.fmt(ss.closing) + ' payable.',
        sheets: [
          { name: 'Purchase detail', widths: [13, 18, 30, 10, 11, 11, 14, 16] },
          { name: 'Supplier statement', widths: [12, 15, 32, 9, 12, 12, 14],
            head: ['Date', 'Folio / Reference #', 'Description / تفصیل', 'Qty',
                   'Debit / بنام', 'Credit / جمع', 'Balance / بقایا'],
            rows: srep.ledger.rows.map(function (r) {
              var ql = (ERP.Desc && ERP.Desc.qtyLabel) ? ERP.Desc.qtyLabel(r) : '—';
              return [fmtDate(r.iso), r.ref, r.description || r.what, ql,
                      money(r.dr), money(r.cr), money(r.balance)]; }) }
        ]
      };
    }
    case 'returns': {
      var rt = A.returns(from, to, f);
      return {
        id: 'returns', title: 'Returns report', from: from, to: to, periodLabel: label,
        cards: [
          card('Customer returns', M.fmt(rt.customerValue), qty(rt.customerQty) + ' bags'),
          card('Supplier returns', M.fmt(rt.supplierValue), qty(rt.supplierQty) + ' bags'),
          card('Return lines', String(rt.customer.length + rt.supplier.length), '')
        ],
        charts: [{ title: 'Returns by product', svg: barChart((function () {
          var map = {};
          rt.customer.forEach(function (r) {
            map[r.product] = map[r.product] || { label: r.product, value: 0 };
            map[r.product].value += r.value;
          });
          return Object.keys(map).map(function (k) { return map[k]; })
            .sort(function (a, b) { return b.value - a.value; });
        })()) }],
        columns: [['Date', 'l'], ['Return', 'l'], ['Against', 'l'], ['Shop', 'l'], ['Product', 'l'],
                  ['Qty', 'r'], ['Condition', 'l'], ['Treatment', 'l'], ['Value', 'r']],
        rows: rt.customer.map(function (r) {
          return [fmtDate(r.date), r.number, r.invoice, r.shop, r.product, qty(r.qty),
                  r.condition, r.treatment, money(r.value)];
        }),
        footer: ['Total', '', '', '', '', qty(rt.customerQty), '', '', money(rt.customerValue)],
        summary: 'From ' + Period.label(from, to) + ': shops returned ' + qty(rt.customerQty) +
          ' bags worth ' + M.fmt(rt.customerValue) + ', and ' + qty(rt.supplierQty) +
          ' bags worth ' + M.fmt(rt.supplierValue) + ' went back to mills.',
        sheets: [
          { name: 'Customer returns', widths: [13, 16, 16, 26, 28, 10, 18, 20, 14] },
          { name: 'Supplier returns', widths: [13, 16, 16, 26, 28, 10, 20, 14],
            head: ['Date', 'Return', 'Against purchase', 'Supplier', 'Product', 'Qty', 'Reason', 'Value'],
            rows: rt.supplier.map(function (r) {
              return [fmtDate(r.date), r.number, r.purchase, r.supplier, r.product, r.qty,
                      r.reason, money(r.value)]; }) }
        ]
      };
    }
    default: {
      var pm = A.payments(from, to, f);
      var mrows = pm.received.map(function (p) {
        return [fmtDate(p.paymentDate), p.receiptNumber, 'Received from shop', p.partyNameSnapshot,
                p.method, p.reference || '', money(p.amount), ''];
      }).concat(pm.made.map(function (p) {
        return [fmtDate(p.paymentDate), p.receiptNumber, 'Paid to supplier', p.partyNameSnapshot,
                p.method, p.reference || '', '', money(p.amount)];
      })).concat(pm.refunds.map(function (p) {
        return [fmtDate(p.paymentDate), p.receiptNumber, 'Refund to shop', p.partyNameSnapshot,
                p.method, p.reference || '', '', money(p.amount)];
      })).concat(pm.expenses.map(function (e) {
        return [fmtDate(e.expenseDate), e.expenseNumber, 'Expense — ' + e.category,
                e.paidTo || e.description, e.method, e.reference || '', '', money(e.amount)];
      })).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
      return {
        id: 'money', title: 'Payments & expenses', from: from, to: to, periodLabel: label,
        cards: [
          card('Received from shops', M.fmt(pm.receivedTotal), pm.received.length + ' receipts', 'good'),
          card('Paid to mills', M.fmt(pm.madeTotal), pm.made.length + ' vouchers'),
          card('Expenses', M.fmt(pm.expenseTotal), pm.expenses.length + ' entries'),
          card('Refunds', M.fmt(pm.refundTotal), pm.refunds.length + ' refunds'),
          card('Owed by shops', M.fmt(pm.receivable), 'All time', pm.receivable ? 'bad' : ''),
          card('Owed to mills', M.fmt(pm.payable), 'All time', pm.payable ? 'bad' : '')
        ],
        charts: [
          { title: 'Expenses by category', svg: barChart(pm.byCategory.map(function (c) {
              return { label: c.category, value: c.amount }; })) },
          { title: 'Money in and out by method', svg: barChart(pm.byMethod.map(function (m2) {
              return { label: m2.method, value: m2.inAmt - m2.outAmt,
                       text: M.fmt(m2.inAmt) + ' in / ' + M.fmt(m2.outAmt) + ' out' }; })) }
        ],
        columns: [['Date', 'l'], ['Number', 'l'], ['Kind', 'l'], ['Party', 'l'], ['Method', 'l'],
                  ['Reference', 'l'], ['Money in', 'r'], ['Money out', 'r']],
        rows: mrows,
        footer: ['Total', '', '', '', '', '', money(pm.receivedTotal),
                 money(pm.madeTotal + pm.expenseTotal + pm.refundTotal)],
        summary: 'From ' + Period.label(from, to) + ': ' + M.fmt(pm.receivedTotal) +
          ' was collected from shops, ' + M.fmt(pm.madeTotal) + ' paid to mills and ' +
          M.fmt(pm.expenseTotal) + ' spent on expenses. Shops still owe ' + M.fmt(pm.receivable) +
          ' and ' + M.fmt(pm.payable) + ' is payable to mills.',
        sheets: [
          { name: 'Cash movements', widths: [13, 16, 22, 28, 14, 18, 15, 15] },
          { name: 'Expenses', widths: [13, 14, 20, 26, 14, 15],
            head: ['Date', 'Number', 'Category', 'Paid to / for', 'Method', 'Amount'],
            rows: pm.expenses.map(function (e) {
              return [fmtDate(e.expenseDate), e.expenseNumber, e.category,
                      e.paidTo || e.description, e.method, money(e.amount)]; }) }
        ]
      };
    }
  }
}
ERP.buildReport = build;

/* ══════════════════════════════════════════════════════════════════════════
   THE PAGE
   ══════════════════════════════════════════════════════════════════════════ */
function filterBar() {
  var f = R.filters;
  var sel = function (key, label, list, idKey, labelFn) {
    return '<label class="fld">' + I('filter') + '<select data-rpfilter="' + key + '">' +
      '<option value="">' + label + '</option>' +
      list.map(function (x) {
        return '<option value="' + x[idKey] + '"' + (f[key] === x[idKey] ? ' selected' : '') + '>' +
          esc(labelFn(x)) + '</option>';
      }).join('') + '</select></label>';
  };
  var out = '';
  if (R.tab === 'customer') out += sel('customerId', 'Choose a shop', global.CUSTOMERS || [], 'id',
    function (c) { return c.sh + (c.legacyCode ? ' · ' + c.legacyCode : ''); });
  if (R.tab === 'supplier' || R.tab === 'purchases') out += sel('supplierId',
    R.tab === 'supplier' ? 'Choose a supplier' : 'All suppliers', global.SUPPLIERS || [], 'id',
    function (s) { return s.co; });
  if (R.tab === 'sales' || R.tab === 'purchases' || R.tab === 'inventory')
    out += sel('productId', 'All products',
      (global.PRODUCTS || []).filter(function (p) { return p.active !== false; }), 'id',
      function (p) { return p.en || p.ur; });
  if (R.tab === 'sales' || R.tab === 'purchases' || R.tab === 'inventory' || R.tab === 'overview')
    out += sel('warehouseId', 'All warehouses', global.WAREHOUSES || [], 'id', function (w) { return w.name; });
  if (R.tab === 'sales' || R.tab === 'overview')
    out += sel('regionId', 'All regions', global.REGIONS || [], 'id', function (r) { return r.en; });
  if (R.tab === 'money') {
    out += sel('category', 'All expense categories',
      ERP.Expenses.categories.map(function (c) { return { id: c }; }), 'id', function (c) { return c.id; });
    out += sel('method', 'All methods',
      ERP.ENUM.methods.map(function (c) { return { id: c }; }), 'id', function (c) { return c.id; });
  }
  return out;
}

global.PAGES.reports = function () {
  var r = resolve();
  var rep = build(R.tab, r.from, r.to, r.label);
  var chips = Period.presets.map(function (p) {
    return '<button class="rp-chip' + (R.kind === p[0] ? ' on' : '') + '" data-rpkind="' + p[0] + '">' +
      p[1] + '</button>';
  }).join('');
  var years = [];
  var yNow = new Date().getFullYear();
  for (var y = yNow; y >= yNow - 4; y--) years.push(y);

  var head = '<div class="rp-bar">' + chips +
      '<div class="rp-dates">' +
        '<input type="date" data-rpfrom value="' + esc(R.kind === 'custom' ? (R.from || '') : (r.from || '')) + '">' +
        '<span style="color:var(--muted)">→</span>' +
        '<input type="date" data-rpto value="' + esc(R.kind === 'custom' ? (R.to || '') : (r.to || '')) + '">' +
        '<input type="month" data-rpmonthfrom value="' + esc(R.kind === 'months' ? (R.from || '') : '') + '" title="Month from">' +
        '<input type="month" data-rpmonthto value="' + esc(R.kind === 'months' ? (R.to || '') : '') + '" title="Month to">' +
        '<select data-rpyear><option value="">Year…</option>' +
          years.map(function (yy) {
            return '<option value="' + yy + '"' + (R.kind === 'yearOf' && String(R.from) === String(yy) ? ' selected' : '') +
              '>' + yy + '</option>';
          }).join('') + '</select>' +
      '</div>' +
      '<div class="rp-period">Showing <b>' + esc(r.label) + '</b> · ' +
        esc(Period.label(r.from, r.to)) + ' · ' + (rep.rows ? rep.rows.length : 0) + ' records</div>' +
    '</div>' +
    '<div class="rp-tabs">' + TABS.map(function (t) {
      return '<button class="' + (R.tab === t[0] ? 'on' : '') + '" data-rptab="' + t[0] + '">' +
        esc(t[1]) + '</button>';
    }).join('') + '</div>';

  var filters = filterBar();
  if (filters) head += '<div class="bar" style="margin-bottom:14px">' + filters +
    '<div class="grow"></div>' +
    (R.tab === 'money' ? '<button class="btn pri" data-panel="expense">' + I('plus') + 'Record expense</button>' : '') +
    '</div>';

  if (rep.empty) return head + '<div class="rp-none">' + esc(rep.empty) + '</div>';

  var cards = '<div class="rp-cards">' + (rep.cards || []).map(function (c) {
    return '<div class="rp-card ' + (c.cls || '') + '"><i>' + esc(c.label) + '</i><b>' +
      esc(c.value) + '</b>' + (c.note ? '<span>' + esc(c.note) + '</span>' : '') + '</div>';
  }).join('') + '</div>';

  var summary = rep.summary ? '<div class="rp-sum"><h4>What this period says</h4>' +
    esc(rep.summary) + '</div>' : '';

  var charts = (rep.charts || []).length ? '<div class="rp-charts">' + rep.charts.map(function (c) {
    return '<div class="rp-chart"><h4>' + esc(c.title) + '</h4>' + c.svg + '</div>';
  }).join('') + '</div>' : '';

  var exports = '<div class="rp-exports">' +
    '<button class="btn" data-rpexport="print">' + I('print') + 'Print</button>' +
    '<button class="btn" data-rpexport="pdf">' + I('down') + 'PDF</button>' +
    '<button class="btn" data-rpexport="word">' + I('doc') + 'Word</button>' +
    '<button class="btn pri" data-rpexport="excel">' + I('sheet') + 'Excel</button>' +
    '</div>';

  var ledger = (rep.ledger || []).length ? '<div class="card" style="margin-bottom:14px">' +
    '<div class="card-h"><h3>Balance statement</h3></div><div class="card-b">' +
    rep.ledger.map(function (l, i) {
      return '<div style="display:flex;justify-content:space-between;padding:7px 0;' +
        (i === rep.ledger.length - 1 ? 'border-top:1.5px solid var(--violet);font-weight:800;font-size:16px' :
         'border-bottom:1px solid var(--line-2)') + '"><span>' + esc(l[0]) +
        (l[2] ? ' ' + u(l[2]) : '') + '</span><b>' + esc(l[1]) + '</b></div>';
    }).join('') + '</div></div>' : '';

  var table = (rep.rows || []).length
    ? '<div class="card"><div class="card-h"><h3>' + esc(rep.title) + '</h3>' +
      '<span class="pill neu">' + rep.rows.length + ' rows</span></div><div class="card-b">' +
      '<div class="tw"><table class="fcb-list"><thead><tr>' +
        rep.columns.map(function (c) {
          return '<th class="' + (c[1] === 'r' ? 'r' : '') + '">' + esc(c[0]) + '</th>';
        }).join('') + '</tr></thead><tbody>' +
        rep.rows.slice(0, 400).map(function (row) {
          return '<tr>' + row.map(function (cell, ci) {
            var col = rep.columns[ci] || [''];
            var val = typeof cell === 'number' ? M.fmt(M.toP(cell)) : cell;
            return '<td data-label="' + esc(col[0]) + '" class="' + (col[1] === 'r' ? 'r num' : '') + '">' +
              esc(val === '' || val === null || val === undefined ? '—' : val) + '</td>';
          }).join('') + '</tr>';
        }).join('') +
        '</tbody>' + (rep.footer ? '<tfoot><tr>' + rep.footer.map(function (cell, ci) {
          var col = rep.columns[ci] || [''];
          var val = typeof cell === 'number' ? M.fmt(M.toP(cell)) : cell;
          return '<td class="' + (col[1] === 'r' ? 'r num' : '') + '"><b>' + esc(val) + '</b></td>';
        }).join('') + '</tr></tfoot>' : '') + '</table></div>' +
      (rep.rows.length > 400 ? '<p class="hint">Showing the first 400 rows on screen — the export ' +
        'carries all ' + rep.rows.length + '.</p>' : '') +
      '</div></div>'
    : '<div class="rp-none">No records in this period.</div>';

  return head + cards + summary + charts + ledger + exports + table;
};

/* ══════════════════════════════════════════════════════════════════════════
   EXPORTS
   ══════════════════════════════════════════════════════════════════════════ */
function currentReport() {
  var r = resolve();
  return build(R.tab, r.from, r.to, r.label);
}
function reportModel(rep) {
  var m = A.docModel({
    id: rep.id, title: rep.title, from: rep.from, to: rep.to, number: '',
    partyLabel: rep.partyLabel, partyName: rep.partyName, partyOwner: rep.partyOwner,
    partyCode: rep.partyCode, partyContact: rep.partyContact, partyRegion: rep.partyRegion,
    partyId: rep.partyId, meta: rep.meta, cards: rep.cards, summary: rep.summary,
    ledger: rep.ledger,
    time: new Date().toTimeString().slice(0, 5),
    columns: rep.columns.map(function (c, i) {
      return { key: 'c' + i, label: c[0], align: c[1] === 'r' ? 'right' : 'left',
               width: 1 / rep.columns.length };
    }),
    rows: rep.rows.map(function (row) {
      var o = {};
      row.forEach(function (cell, i) {
        o['c' + i] = typeof cell === 'number' ? M.fmtPlain(M.toP(cell)) : cell;
      });
      o.description = o.c0; o.sr = ''; return o;
    })
  });
  if (rep.footer) {
    var fo = {};
    rep.footer.forEach(function (cell, i) {
      fo['c' + i] = typeof cell === 'number' ? M.fmtPlain(M.toP(cell)) : cell;
    });
    m.itemsFooter = fo;
  }
  m.totals = (rep.cards || []).slice(0, 6).map(function (c, i) {
    return { label: c.label, value: c.value, bold: i === 0 };
  });
  return m;
}
function excelName(rep) {
  return (ERP.Settings.get().businessName || 'Farooq-Co').replace(/[^\w]+/g, '-') + '-' +
    rep.title.replace(/[^\w]+/g, '-') + '-' + (rep.from || 'start') + '-to-' + (rep.to || today()) + '.xlsx';
}
function toSheets(rep) {
  var b = ERP.Settings.get();
  var header = [
    [{ v: b.businessName, style: 3 }],
    [b.tagline || ''],
    [rep.title],
    ['Period', Period.label(rep.from, rep.to)],
    ['Generated', fmtDate(today()) + ' ' + new Date().toTimeString().slice(0, 5)],
    ['Generated by', global.CURRENT_USER || 'Owner'],
    []
  ];
  var sheets = (rep.sheets || []).map(function (sh, ix) {
    var head = sh.head || rep.columns.map(function (c) { return c[0]; });
    var rows = sh.rows || rep.rows;
    var body = [header.length && ix === 0 ? null : null];
    var data = (ix === 0 ? header : [[rep.title + ' — ' + sh.name], ['Period', Period.label(rep.from, rep.to)], []])
      .concat([head.map(function (h) { return { v: h, style: 1 }; })])
      .concat(rows.map(function (row) {
        return row.map(function (cell) {
          return typeof cell === 'number' ? cell : cell;
        });
      }));
    if (ix === 0 && rep.footer) {
      data.push(rep.footer.map(function (c) { return { v: c, style: 4 }; }));
    }
    if (ix === 0 && rep.summary) { data.push([]); data.push(['Summary']); data.push([rep.summary]); }
    return { name: sh.name, widths: sh.widths, rows: data };
  });
  return sheets.length ? sheets : [{ name: 'Report', rows: header.concat([rep.columns.map(function (c) {
    return { v: c[0], style: 1 }; })], rep.rows) }];
}

ERP.Reporting = {
  state: R, build: build, current: currentReport, model: reportModel, sheets: toSheets,
  excel: function () {
    var rep = currentReport();
    var name = ERP.XLSX.download(toSheets(rep), excelName(rep),
      { title: rep.title, author: ERP.Settings.get().businessName });
    ERP.Audit.detached({ action: 'Report exported to Excel', entity: 'Report', entityId: rep.id,
      ref: Period.label(rep.from, rep.to) });
    say('Excel file downloaded — ' + name);
  },
  open: function (mode) {
    var rep = currentReport();
    var m = reportModel(rep);
    ERP.Viewer.open(m);
    if (mode === 'word') { ERP.Viewer.word(); return; }
    if (mode === 'print' || mode === 'pdf') {
      setTimeout(function () { ERP.Viewer.print(mode === 'pdf'); }, 150);
    }
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   EXPENSES PANEL
   ══════════════════════════════════════════════════════════════════════════ */
global.PANELS.expense = {
  t: 'Record an expense', s: 'Freight, labour, fuel, salaries — anything paid out',
  cta: 'Save expense',
  f: function () {
    return '<div class="f2">' +
        '<label class="f"><span>Date</span><input type="date" data-f="date" value="' + today() + '"></label>' +
        '<label class="f"><span>Category</span><select data-f="category">' +
          ERP.Expenses.categories.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') +
        '</select></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>Amount</span><input data-f="amount" inputmode="decimal" placeholder="0"></label>' +
        '<label class="f"><span>Method</span><select data-f="method">' +
          ERP.ENUM.methods.map(function (m2) { return '<option>' + esc(m2) + '</option>'; }).join('') +
        '</select></label></div>' +
      '<label class="f"><span>Paid to</span><input data-f="paidTo" placeholder="Driver, labour, landlord…"></label>' +
      '<label class="f"><span>What it was for</span><input data-f="description" placeholder="Optional"></label>' +
      '<label class="f"><span>Reference</span><input data-f="reference" class="mono" placeholder="Optional"></label>';
  },
  save: function (v) {
    var amount = String(v.amount || '').replace(/[^\d.]/g, '');
    if (!amount || Number(amount) <= 0) return 'Enter the amount paid.';
    ERP.Expenses.save({ date: v.date, category: v.category, amount: amount, method: v.method,
                        paidTo: v.paidTo, description: v.description, reference: v.reference })
      .then(function (e) { global.paint(); say('Expense ' + e.expenseNumber + ' recorded.'); })
      .catch(function (e) { say(e && e.validation ? e.validation[0] : 'The expense could not be saved.'); });
    return { msg: 'Saving expense…' };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   WIRING
   ══════════════════════════════════════════════════════════════════════════ */
D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var k = e.target.closest('[data-rpkind]');
  if (k) { e.preventDefault(); R.kind = k.dataset.rpkind; R.from = null; R.to = null; global.paint(); return; }
  var t = e.target.closest('[data-rptab]');
  if (t) { e.preventDefault(); R.tab = t.dataset.rptab; global.paint(); return; }
  var x = e.target.closest('[data-rpexport]');
  if (x) {
    e.preventDefault();
    var mode = x.dataset.rpexport;
    if (mode === 'excel') ERP.Reporting.excel(); else ERP.Reporting.open(mode);
    return;
  }
}, true);

D.addEventListener('change', function (e) {
  var el = e.target;
  if (!el.dataset) return;
  if (el.dataset.rpfrom !== undefined || el.dataset.rpto !== undefined) {
    var f = D.querySelector('[data-rpfrom]'), tt = D.querySelector('[data-rpto]');
    R.kind = 'custom'; R.from = f ? f.value : null; R.to = tt ? tt.value : null;
    global.paint(); return;
  }
  if (el.dataset.rpmonthfrom !== undefined || el.dataset.rpmonthto !== undefined) {
    var mf = D.querySelector('[data-rpmonthfrom]'), mt = D.querySelector('[data-rpmonthto]');
    if (mf && mf.value) {
      R.kind = 'months'; R.from = mf.value; R.to = (mt && mt.value) || mf.value;
      global.paint();
    }
    return;
  }
  if (el.dataset.rpyear !== undefined && el.value) {
    R.kind = 'yearOf'; R.from = el.value; R.to = null; global.paint(); return;
  }
  if (el.dataset.rpfilter !== undefined) {
    R.filters[el.dataset.rpfilter] = el.value; global.paint(); return;
  }
});

/* Expenses and manual document edits are read after the main boot, so the
   app announces a second, fuller ready state that anything depending on
   them can wait for. */
ERP.readyPromise = (ERP.bootPromise || Promise.resolve()).then(function () {
  return FDB.hydrate ? FDB.hydrate() : null;
}).then(function (data) {
  if (data) S.expenses = (data.expenses || []).sort(function (a, b) {
    return a.expenseDate < b.expenseDate ? 1 : -1;
  });
}).catch(function () {}).then(function () {
  ERP.fullyReady = true;
  return ERP;
});
ERP.whenReady = function () { return ERP.readyPromise || Promise.resolve(ERP); };
})(typeof window !== 'undefined' ? window : globalThis);
