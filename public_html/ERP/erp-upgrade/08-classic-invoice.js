/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 8
   THE CLASSIC INVOICE  ·  laid out from SInvoice.pdf
   The shop's existing invoice: Urdu trade header, Bill to Party block,
   Invoice # / InvNo / Date / ID #, the account ledger on the left, the
   product lines on the right, and the Gross / Opening / Total / Cash /
   Balance box. Every line of the invoice appears — one parent, many items.
   Rendered from the same document model as everything else, so the screen,
   the print, the PDF and the Word file cannot disagree. (§35 §36)
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, DOCX = global.DOCX;
var Paper = ERP.Paper, DocModel = ERP.DocModel;

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ur(s) { return s ? '<span lang="ur" dir="rtl" class="fc-ur">' + esc(s) + '</span>' : ''; }
function isUrdu(s) { return /[\u0600-\u06FF]/.test(String(s || '')); }
function dmy(iso) {
  if (!iso) return '';
  var p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

/* ── the extra figures the classic layout needs, derived from the record ── */
DocModel.classicBlock = function (inv) {
  var cfg = ERP.Settings.get();
  var serial = 0;
  var mNum = /(\d+)$/.exec(inv.invoiceNumber || '');
  if (mNum) serial = parseInt(mNum[1], 10);
  var c = global.custBy ? (global.custBy(inv.customerId) || {}) : {};

  /* the account as it stood around this invoice */
  var L = ERP.Ledger.customer(inv.customerId);
  var upto = [], hit = false;
  L.rows.forEach(function (r) {
    if (hit) return;
    upto.push(r);
    if (r.kind === 'INVOICE' && r.ref === inv.invoiceNumber) hit = true;
  });
  var shown = upto.slice(-6);
  var paid = ERP.Invoices.paidFor(inv.id);
  var opening = inv.previousBalance || 0;

  return {
    serial: serial,
    invNo: (cfg.salesDocPrefix || 'SLV') + '-' + String(serial).padStart(6, '0'),
    idNo: c.legacyCode || inv.customerCodeSnapshot || '',
    contact: inv.mobileSnapshot || 'Nil',
    regionUr: (c.region && global.regionOf && global.regionOf(c.region) ? global.regionOf(c.region).ur : '') ||
              (inv.regionSnapshot || '').split(' — ')[0],
    remarks: inv.notes || '',
    ledgerRows: shown.map(function (r) {
      return { date: dmy(r.iso), dr: r.dr ? M.fmtPlain(r.dr) : '0', cr: r.cr ? M.fmtPlain(r.cr) : '0' };
    }),
    ledgerTotals: {
      dr: M.fmtPlain(shown.reduce(function (a, r) { return a + r.dr; }, 0)),
      cr: M.fmtPlain(shown.reduce(function (a, r) { return a + r.cr; }, 0))
    },
    box: [
      ['Gross Amounts:', 'سب ٹوٹل', M.fmtPlain(inv.grandTotal), false],
      ['Opening', 'سابقہ بقایا رقم', M.fmtPlain(opening), false],
      ['Total :', 'ٹوٹل بل رقم', M.fmtPlain(opening + inv.grandTotal), true],
      ['Cash Amt:', 'نقد وصول', M.fmtPlain(paid), false],
      ['', '', M.fmtPlain(0), false],
      ['Balance', 'بقایا رقم', M.fmtPlain(opening + inv.grandTotal - paid), true]
    ],
    qtyTotal: inv.totalQty,
    lineTotal: M.fmtPlain(inv.grandTotal)
  };
};

/* attach it to every invoice model */
var origInvoiceModel = DocModel.invoice;
DocModel.invoice = function (id) {
  var m = origInvoiceModel.call(DocModel, id);
  if (!m) return m;
  var inv = ERP.Invoices.byId(id);
  m.classic = DocModel.classicBlock(inv);
  m.template = ERP.Settings.get().invoiceTemplate || 'classic';
  return m;
};

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN + PRINT
   ══════════════════════════════════════════════════════════════════════════ */
var CLASSIC_CSS = `
.fcdoc.classic{font-size:11px}
.fcdoc.classic .cl-title{text-align:center;font-size:23px;font-weight:800;letter-spacing:5px;margin:0 0 4px}
.fcdoc.classic .cl-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;
  border-bottom:1px dotted #9a9aa6;padding-bottom:7px;margin-bottom:8px}
.fcdoc.classic .cl-head .l{text-align:left}
.fcdoc.classic .cl-head .r{text-align:right}
.fcdoc.classic .cl-en{font-weight:800;font-size:14px;letter-spacing:.4px}
.fcdoc.classic .cl-mark{font-size:10px;color:var(--doc-mute)}
.fcdoc.classic .cl-phones{text-align:center;font-size:10px;margin:5px 0 9px;color:var(--doc-ink)}
.fcdoc.classic .cl-parties{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-bottom:10px}
.fcdoc.classic .cl-bill{border:1px solid var(--doc-line);border-radius:3px;padding:7px 9px;position:relative}
.fcdoc.classic .cl-bill .tag{position:absolute;top:-8px;left:9px;background:#fff;padding:0 5px;
  font-size:9px;font-weight:700;color:var(--doc-mute)}
.fcdoc.classic .cl-bill b{font-size:14px;display:block;margin-bottom:1px}
.fcdoc.classic table.cl-meta{width:100%;border:1px solid var(--doc-line);border-radius:3px;border-collapse:collapse}
.fcdoc.classic table.cl-meta td{padding:3px 8px;font-size:11px}
.fcdoc.classic table.cl-meta td:first-child{color:var(--doc-mute)}
.fcdoc.classic table.cl-meta td:last-child{text-align:right;font-weight:700;border-left:1px solid var(--doc-line);
  background:#FAFAFC;width:46%}
.fcdoc.classic .cl-body{display:grid;grid-template-columns:1fr 1.35fr;gap:14px;align-items:start}
.fcdoc.classic table.cl-t{width:100%;border-collapse:collapse}
.fcdoc.classic table.cl-t th{font-size:10px;font-weight:700;text-align:left;padding:4px 6px;
  border-bottom:1.5px solid #7a7a88}
.fcdoc.classic table.cl-t td{padding:3.5px 6px;border-bottom:1px solid #ECECF1;font-size:11px}
.fcdoc.classic table.cl-t tfoot td{border-top:1.5px solid #7a7a88;border-bottom:none;font-weight:700;background:#FAFAFC}
.fcdoc.classic .r{text-align:right}.fcdoc.classic .c{text-align:center}
.fcdoc.classic .cl-prod{line-height:1.5}
.fcdoc.classic .cl-prod .en{display:block;font-size:9px;color:var(--doc-mute)}
.fcdoc.classic .cl-box{margin-top:12px;margin-left:auto;width:63%;border:1px solid var(--doc-line);border-radius:3px}
.fcdoc.classic .cl-box div{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:baseline;
  padding:4px 10px;border-bottom:1px solid #EDEDF2}
.fcdoc.classic .cl-box div:last-child{border-bottom:none}
.fcdoc.classic .cl-box div.big{border-top:1.5px solid #7a7a88;font-weight:800;font-size:13.5px;background:#FAFAFC}
.fcdoc.classic .cl-box i{font-style:normal;color:var(--doc-mute);text-align:right}
.fcdoc.classic .cl-box b{font-variant-numeric:tabular-nums}
.fcdoc.classic .cl-remarks{margin-top:14px;font-size:10.5px;border-top:1px dotted #9a9aa6;padding-top:6px}
.fcdoc.classic .cl-sigs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:20px;margin-top:22px}
.fcdoc.classic .cl-sigs div{border-top:1px solid #8C8C99;padding-top:4px;font-size:9px;color:var(--doc-mute)}
@media print{
  .fcdoc.classic table.cl-t thead{display:table-header-group}
  .fcdoc.classic table.cl-t tfoot{display:table-row-group}
  .fcdoc.classic table.cl-t tr{break-inside:avoid}
  .fcdoc.classic .cl-box,.fcdoc.classic .cl-sigs{break-inside:avoid}
}
.cl-foot{margin-top:8px;padding-top:6px;border-top:1px solid #000;font-size:9px;line-height:1.5;text-align:center}
.cl-foot b{display:block;margin-bottom:2px}
`;

Paper.classicHtml = function (m) {
  var b = m.business, cl = m.classic;
  var phones = [b.phone && 'موبائیل نمبر: ' + b.phone, b.shopPhone && 'فون دکان: ' + b.shopPhone,
                b.proprietor && b.proprietor].filter(Boolean);

  var rows = m.rows.map(function (r) {
    return '<tr><td class="cl-prod">' + (r.descriptionUr ? ur(r.descriptionUr) : esc(r.description)) +
        (r.descriptionUr && r.description ? '<span class="en">' + esc(r.description) + '</span>' : '') +
        '</td>' +
      '<td class="r">' + esc(r.rate) + '</td>' +
      '<td class="r">' + esc(String(r.qty).replace(/ Bags?$/, '')) + '</td>' +
      '<td class="r">' + esc(r.amount) + '</td></tr>';
  }).join('');

  var led = cl.ledgerRows.map(function (r) {
    return '<tr><td>' + esc(r.date) + '</td><td class="r">' + esc(r.dr) + '</td>' +
           '<td class="r">' + esc(r.cr) + '</td></tr>';
  }).join('') || '<tr><td colspan="3" class="c" style="color:#9a9aa6">No earlier entries</td></tr>';

  var box = cl.box.map(function (t) {
    return '<div' + (t[3] ? ' class="big"' : '') + '><span>' + esc(t[0]) + '</span><i>' + ur(t[1]) +
           '</i><b>' + esc(t[2]) + '</b></div>';
  }).join('');

  return '<div class="fcdoc classic">' +
    (m.cancelled ? '<div class="fc-ribbon">CANCELLED</div>' : m.isDraft ? '<div class="fc-ribbon">DRAFT</div>' : '') +
    '<div class="cl-title">' + esc(m.title || 'INVOICE') + '</div>' +
    '<div class="cl-head"><div class="l">' +
        '<div class="cl-en">' + esc(b.name) + '</div>' +
        '<div class="cl-mark">' + esc(b.tagline) + '</div>' +
        '<div class="cl-mark">' + esc(b.logoText || 'FC') + ' · ' + ur('ٹریڈمارک') + '</div>' +
      '</div><div class="r">' +
        (b.taglineUr ? '<div>' + ur(b.taglineUr) + '</div>' : '') +
        (b.address ? '<div>' + (isUrdu(b.address) ? ur(b.address) : esc(b.address)) + '</div>' : '') +
        (b.slogan ? '<div>' + ur(b.slogan) + '</div>' : '') +
      '</div></div>' +
    '<div class="cl-phones">' + phones.map(function (p) {
        return isUrdu(p) ? ur(p) : esc(p); }).join(' &nbsp;·&nbsp; ') + '</div>' +
    '<div class="cl-parties">' +
      '<div class="cl-bill"><span class="tag">Bill to Party</span>' +
        '<b>' + (isUrdu(m.party.shop) ? ur(m.party.shop) : esc(m.party.shop || '—')) + '</b>' +
        '<div>' + esc(cl.contact) + '</div>' +
        '<div>' + ur(cl.regionUr) + '</div>' +
      '</div>' +
      '<table class="cl-meta">' +
        '<tr><td>Invoice #:</td><td>' + esc(cl.serial || '—') + '</td></tr>' +
        '<tr><td>InvNo</td><td>' + esc(cl.invNo) + '</td></tr>' +
        '<tr><td>Invoice Date</td><td>' + esc(dmy(m.rawDate)) + '</td></tr>' +
        '<tr><td>ID #</td><td>' + esc(cl.idNo || '—') + '</td></tr>' +
      '</table>' +
    '</div>' +
    '<div class="cl-body">' +
      '<table class="cl-t"><thead><tr><th>Date ' + ur('تاریخ') + '</th>' +
        '<th class="r">Dr ' + ur('بنام رقم') + '</th><th class="r">Cr ' + ur('وصولی') + '</th></tr></thead>' +
        '<tbody>' + led + '</tbody>' +
        '<tfoot><tr><td>Subtotal:</td><td class="r">' + esc(cl.ledgerTotals.dr) + '</td>' +
        '<td class="r">' + esc(cl.ledgerTotals.cr) + '</td></tr></tfoot></table>' +
      '<table class="cl-t"><thead><tr><th>Product</th><th class="r">Price</th>' +
        '<th class="r">Quantity</th><th class="r">Amounts</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td>Subtotal:</td><td></td><td class="r">' +
          Number(cl.qtyTotal).toLocaleString('en-US') + '.00</td>' +
          '<td class="r">' + esc(cl.lineTotal) + '</td></tr></tfoot></table>' +
    '</div>' +
    '<div class="cl-box">' + box + '</div>' +
    (cl.remarks ? '<div class="cl-remarks">Remarks: ' +
      (isUrdu(cl.remarks) ? ur(cl.remarks) : esc(cl.remarks)) + '</div>' : '') +
    '<div class="cl-sigs">' + (m.signatures || []).map(function (s) {
      return '<div>' + esc(s) + '</div>'; }).join('') + '</div>' +
    /* The business's own footer and terms belong on the printed invoice.
       Without this the Settings field saved but the classic template — the
       default — never showed it, so editing it appeared to do nothing. */
    ((m.footer && (m.footer.thanks || m.footer.terms || m.footer.bank))
      ? '<div class="cl-foot">' +
          (m.footer.thanks ? '<b>' + esc(m.footer.thanks) + '</b>' : '') +
          (m.footer.terms ? '<div>' + esc(m.footer.terms) + '</div>' : '') +
          (m.footer.bank ? '<div>' + esc(m.footer.bank) + '</div>' : '') +
        '</div>' : '') +
    '<div class="fc-pagefoot">' + esc(b.name) + ' · ' + esc(m.number || '') + '</div>' +
  '</div>';
};

/* the preview picks the template the business has chosen */
var origHtml = Paper.html;
Paper.html = function (m) {
  if (m && m.kind === 'INVOICE' && (m.template || 'classic') === 'classic' && m.classic) {
    return Paper.classicHtml(m);
  }
  return origHtml.call(Paper, m);
};
Paper.css = (Paper.css || '') + CLASSIC_CSS;

/* ══════════════════════════════════════════════════════════════════════════
   WORD — the same layout as real, editable content (§35)
   ══════════════════════════════════════════════════════════════════════════ */
var W = DOCX.W, U = DOCX.USABLE;
var INK = '1A1A24', MUTED = '63636F', LINE = 'B9B9C4';

function cell(content, o) { return W.cell(content, o); }

DOCX.classicBody = function (m) {
  var b = m.business, cl = m.classic, out = [];

  out.push(W.para(W.run(m.title || 'INVOICE', { size: 20, bold: true, spacing: 100 }),
    { align: 'center', after: 40 }));

  /* trade header */
  out.push(W.table([Math.round(U * 0.5), Math.round(U * 0.5)], [
    W.row([
      cell(W.para(W.run(b.name, { size: 12, bold: true }), { after: 10 }) +
           W.para(W.run(b.tagline, { size: 8, color: MUTED }), { after: 10 }) +
           W.para(W.run((b.logoText || 'FC') + ' · ٹریڈمارک', { size: 8, color: MUTED }), { after: 0 }),
        { width: Math.round(U * 0.5), noBorder: true, vAlign: 'top', padH: 0 }),
      cell((b.taglineUr ? W.para(W.run(b.taglineUr, { size: 9.5, rtl: true }), { align: 'right', after: 8 }) : '') +
           W.para(W.run(b.address, { size: 9, rtl: true }), { align: 'right', after: 8 }) +
           (b.slogan ? W.para(W.run(b.slogan, { size: 9.5, rtl: true }), { align: 'right', after: 0 }) : ''),
        { width: Math.round(U * 0.5), noBorder: true, vAlign: 'top', padH: 0 })
    ])
  ], { noBorder: true }));
  out.push(W.para(W.run([b.phone && 'موبائیل نمبر: ' + b.phone, b.shopPhone && 'فون دکان: ' + b.shopPhone,
      b.proprietor].filter(Boolean).join('   ·   '), { size: 8.5 }),
    { align: 'center', after: 90, border: true, borderColor: '9A9AA6' }));

  /* Bill to Party + invoice meta */
  var lw = Math.round(U * 0.54), rw = U - lw;
  var metaW = [Math.round(rw * 0.5), rw - Math.round(rw * 0.5)];
  var metaRows = [['Invoice #:', String(cl.serial || '—')], ['InvNo', cl.invNo],
                  ['Invoice Date', (function (d) { return d; })(m.classicDate || cl.dateDmy || m.date)],
                  ['ID #', cl.idNo || '—']].map(function (r) {
    return W.row([
      cell(W.para(W.run(r[0], { size: 9, color: MUTED }), { after: 0 }), { width: metaW[0], padV: 26 }),
      cell(W.para(W.run(r[1], { size: 9.5, bold: true }), { align: 'right', after: 0 }),
        { width: metaW[1], padV: 26, fill: 'FAFAFC' })
    ]);
  });
  out.push(W.table([lw, rw], [
    W.row([
      cell(W.para(W.run('Bill to Party', { size: 8, bold: true, color: MUTED }), { after: 20 }) +
           W.para(W.run(m.party.shop || '—', { size: 12, bold: true }), { after: 12 }) +
           W.para(W.run(cl.contact, { size: 9 }), { after: 8 }) +
           W.para(W.run(cl.regionUr || '', { size: 9.5, rtl: true }), { after: 0 }),
        { width: lw, vAlign: 'top', padV: 60 }),
      cell(W.table(metaW, metaRows), { width: rw, noBorder: true, vAlign: 'top', padH: 40 })
    ])
  ], { noBorder: true }));
  out.push(W.empty(100));

  /* ledger (left) and products (right), side by side */
  var colL = Math.round(U * 0.40), colR = U - colL - 160;
  var lWidths = [Math.round(colL * 0.36), Math.round(colL * 0.32), colL - Math.round(colL * 0.36) - Math.round(colL * 0.32)];
  var ledRows = [W.row([
    cell(W.para(W.run('Date تاریخ', { size: 8, bold: true }), { after: 0 }), { width: lWidths[0], sides: 'b', padV: 30 }),
    cell(W.para(W.run('Dr بنام رقم', { size: 8, bold: true }), { align: 'right', after: 0 }), { width: lWidths[1], sides: 'b', padV: 30 }),
    cell(W.para(W.run('Cr وصولی', { size: 8, bold: true }), { align: 'right', after: 0 }), { width: lWidths[2], sides: 'b', padV: 30 })
  ], { header: true })];
  (cl.ledgerRows.length ? cl.ledgerRows : [{ date: '—', dr: '0', cr: '0' }]).forEach(function (r) {
    ledRows.push(W.row([
      cell(W.para(W.run(r.date, { size: 8.5 }), { after: 0 }), { width: lWidths[0], sides: 'b', borderColor: 'ECECF1', padV: 24 }),
      cell(W.para(W.run(r.dr, { size: 8.5 }), { align: 'right', after: 0 }), { width: lWidths[1], sides: 'b', borderColor: 'ECECF1', padV: 24 }),
      cell(W.para(W.run(r.cr, { size: 8.5 }), { align: 'right', after: 0 }), { width: lWidths[2], sides: 'b', borderColor: 'ECECF1', padV: 24 })
    ]));
  });
  ledRows.push(W.row([
    cell(W.para(W.run('Subtotal:', { size: 8.5, bold: true }), { after: 0 }), { width: lWidths[0], sides: 't', padV: 26, fill: 'FAFAFC' }),
    cell(W.para(W.run(cl.ledgerTotals.dr, { size: 8.5, bold: true }), { align: 'right', after: 0 }), { width: lWidths[1], sides: 't', padV: 26, fill: 'FAFAFC' }),
    cell(W.para(W.run(cl.ledgerTotals.cr, { size: 8.5, bold: true }), { align: 'right', after: 0 }), { width: lWidths[2], sides: 't', padV: 26, fill: 'FAFAFC' })
  ]));

  var pWidths = [Math.round(colR * 0.44), Math.round(colR * 0.17), Math.round(colR * 0.17)];
  pWidths.push(colR - pWidths[0] - pWidths[1] - pWidths[2]);
  var prodRows = [W.row([
    cell(W.para(W.run('Product', { size: 8, bold: true }), { after: 0 }), { width: pWidths[0], sides: 'b', padV: 30 }),
    cell(W.para(W.run('Price', { size: 8, bold: true }), { align: 'right', after: 0 }), { width: pWidths[1], sides: 'b', padV: 30 }),
    cell(W.para(W.run('Quantity', { size: 8, bold: true }), { align: 'right', after: 0 }), { width: pWidths[2], sides: 'b', padV: 30 }),
    cell(W.para(W.run('Amounts', { size: 8, bold: true }), { align: 'right', after: 0 }), { width: pWidths[3], sides: 'b', padV: 30 })
  ], { header: true })];
  m.rows.forEach(function (r) {
    prodRows.push(W.row([
      cell(W.para(W.run(r.descriptionUr || r.description || '', { size: 9.5 }), { after: 0 }) +
           (r.descriptionUr && r.description
             ? W.para(W.run(r.description, { size: 7.5, color: MUTED, rtl: false }), { after: 0 }) : ''),
        { width: pWidths[0], sides: 'b', borderColor: 'ECECF1', padV: 24 }),
      cell(W.para(W.run(r.rate, { size: 9 }), { align: 'right', after: 0 }), { width: pWidths[1], sides: 'b', borderColor: 'ECECF1', padV: 24 }),
      cell(W.para(W.run(String(r.qty).replace(/ Bags?$/, ''), { size: 9 }), { align: 'right', after: 0 }), { width: pWidths[2], sides: 'b', borderColor: 'ECECF1', padV: 24 }),
      cell(W.para(W.run(r.amount, { size: 9 }), { align: 'right', after: 0 }), { width: pWidths[3], sides: 'b', borderColor: 'ECECF1', padV: 24 })
    ], { cantSplit: true }));
  });
  prodRows.push(W.row([
    cell(W.para(W.run('Subtotal:', { size: 9, bold: true }), { after: 0 }), { width: pWidths[0], sides: 't', padV: 26, fill: 'FAFAFC' }),
    cell(W.para('', { after: 0 }), { width: pWidths[1], sides: 't', padV: 26, fill: 'FAFAFC' }),
    cell(W.para(W.run(Number(cl.qtyTotal).toLocaleString('en-US') + '.00', { size: 9, bold: true }), { align: 'right', after: 0 }), { width: pWidths[2], sides: 't', padV: 26, fill: 'FAFAFC' }),
    cell(W.para(W.run(cl.lineTotal, { size: 9, bold: true }), { align: 'right', after: 0 }), { width: pWidths[3], sides: 't', padV: 26, fill: 'FAFAFC' })
  ]));

  out.push(W.table([colL, 160, colR], [
    W.row([
      cell(W.table(lWidths, ledRows, { noBorder: true }), { width: colL, noBorder: true, vAlign: 'top', padH: 0 }),
      cell(W.empty(0), { width: 160, noBorder: true }),
      cell(W.table(pWidths, prodRows, { noBorder: true }), { width: colR, noBorder: true, vAlign: 'top', padH: 0 })
    ])
  ], { noBorder: true }));
  out.push(W.empty(120));

  /* the totals box */
  var boxW = Math.round(U * 0.52);
  var bw = [Math.round(boxW * 0.34), Math.round(boxW * 0.32), boxW - Math.round(boxW * 0.34) - Math.round(boxW * 0.32)];
  var boxRows = cl.box.map(function (t) {
    return W.row([
      cell(W.para(W.run(t[0], { size: t[3] ? 10 : 9, bold: !!t[3] }), { after: 0 }),
        { width: bw[0], sides: t[3] ? 't' : '', padV: t[3] ? 40 : 26, fill: t[3] ? 'FAFAFC' : '' }),
      cell(W.para(W.run(t[1], { size: t[3] ? 10 : 9, color: MUTED, rtl: true }), { align: 'right', after: 0 }),
        { width: bw[1], sides: t[3] ? 't' : '', padV: t[3] ? 40 : 26, fill: t[3] ? 'FAFAFC' : '' }),
      cell(W.para(W.run(t[2], { size: t[3] ? 12 : 9.5, bold: !!t[3] }), { align: 'right', after: 0 }),
        { width: bw[2], sides: t[3] ? 't' : '', padV: t[3] ? 40 : 26, fill: t[3] ? 'FAFAFC' : '' })
    ], { cantSplit: true });
  });
  out.push(W.table([U - boxW, boxW], [
    W.row([
      cell(W.empty(0), { width: U - boxW, noBorder: true }),
      cell(W.table(bw, boxRows), { width: boxW, noBorder: true, padH: 0, vAlign: 'top' })
    ], { cantSplit: true })
  ], { noBorder: true }));

  if (cl.remarks) {
    out.push(W.para(W.run('Remarks: ', { size: 8.5, color: MUTED }) + W.run(cl.remarks, { size: 8.5 }),
      { before: 160, after: 0, border: true, borderColor: '9A9AA6' }));
  }
  if ((m.signatures || []).length) {
    var sw = Math.round(U / m.signatures.length);
    out.push(W.para('', { before: 300, after: 0 }));
    out.push(W.table(m.signatures.map(function () { return sw; }), [
      W.row(m.signatures.map(function (s) {
        return cell(W.para(W.run(' ', { size: 9 }), { after: 26, border: true, borderColor: '8C8C99' }) +
                    W.para(W.run(s, { size: 8, color: MUTED }), { after: 0 }),
          { width: sw, noBorder: true, padH: 50, vAlign: 'bottom' });
      }))
    ], { noBorder: true }));
  }
  return out.join('');
};

var origFromModel = DOCX.fromModel;
DOCX.fromModel = function (m) {
  if (m && m.kind === 'INVOICE' && (m.template || 'classic') === 'classic' && m.classic) {
    /* the classic sheet needs its dates in the shop's dd/mm/yyyy form */
    m.classic.dateDmy = dmy(m.rawDate);
    return DOCX.classicBody(m);
  }
  return origFromModel.call(DOCX, m);
};

/* the template is a business setting, not a code change (§33 of the first brief) */
var origDefaults = ERP.Settings.defaults;
ERP.Settings.defaults = function () {
  return Object.assign(origDefaults.call(ERP.Settings), {
    invoiceTemplate: 'classic',
    salesDocPrefix: 'SLV'
  });
};
if (ERP.S.business) {
  if (!ERP.S.business.invoiceTemplate) ERP.S.business.invoiceTemplate = 'classic';
  if (!ERP.S.business.salesDocPrefix) ERP.S.business.salesDocPrefix = 'SLV';
}
})(typeof window !== 'undefined' ? window : globalThis);
