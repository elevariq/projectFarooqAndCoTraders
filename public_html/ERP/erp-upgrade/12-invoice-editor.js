/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 12
   THE EDITABLE INVOICE
   Before anything is printed, saved as PDF or downloaded as Word, the
   invoice can be corrected by hand: wording, quantities, rates, discounts,
   extra charges, an added line, and a free-text note. Those edits are the
   document from then on — nothing regenerates over them. They save
   themselves as you type, survive the page closing, and keep a history you
   can step back through. (§2 §3)
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, FDB = global.FDB, D = global.document;
var I = function (n) { return global.I ? global.I(n) : ''; };
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nowISO() { return new Date().toISOString(); }
function say(m) { return global.say ? global.say(m) : null; }
function dmy(iso) {
  if (!iso) return '';
  var p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE EDIT RECORD
   ══════════════════════════════════════════════════════════════════════════ */
var edits = {};                       /* invoiceId → record, held in memory */
var Edits = ERP.Edits = {
  key: function (id) { return 'INVOICE:' + id; },
  get: function (invoiceId) { return edits[Edits.key(invoiceId)] || null; },
  has: function (invoiceId) {
    var e = Edits.get(invoiceId);
    return !!(e && (Object.keys(e.fields || {}).length || Object.keys(e.rows || {}).length ||
                    (e.extraRows || []).length || (e.charges || []).length ||
                    (e.removed || []).length || e.notes));
  },
  blank: function (invoiceId) {
    return {
      id: Edits.key(invoiceId), entity: 'INVOICE', entityId: invoiceId,
      fields: {}, rows: {}, removed: [], extraRows: [], charges: [], notes: '',
      createdAt: nowISO(), updatedAt: nowISO(), revisions: []
    };
  },
  ensure: function (invoiceId) {
    var k = Edits.key(invoiceId);
    if (!edits[k]) edits[k] = Edits.blank(invoiceId);
    return edits[k];
  },
  snapshot: function (rec) {
    return JSON.parse(JSON.stringify({
      fields: rec.fields, rows: rec.rows, removed: rec.removed,
      extraRows: rec.extraRows, charges: rec.charges, notes: rec.notes
    }));
  },
  /* keep the previous state before each save so it can be stepped back */
  /* A revision is the state as it stood *before* this save, so restoring one
     actually steps backwards rather than reapplying what is already there. */
  save: function (invoiceId, opts) {
    var rec = Edits.ensure(invoiceId);
    opts = opts || {};
    var current = Edits.snapshot(rec);
    if (opts.revision && rec.lastSaved &&
        JSON.stringify(rec.lastSaved) !== JSON.stringify(current)) {
      rec.revisions = rec.revisions || [];
      rec.revisions.unshift({ at: nowISO(), by: global.CURRENT_USER || 'Owner',
                              note: opts.note || 'Edited', state: rec.lastSaved });
      if (rec.revisions.length > 15) rec.revisions.length = 15;
    }
    rec.lastSaved = current;
    rec.updatedAt = nowISO();
    return FDB.tx(['documentEdits'], function (api) { api.put('documentEdits', rec); })
      .then(function () { return rec; });
  },
  clear: function (invoiceId) {
    var k = Edits.key(invoiceId);
    delete edits[k];
    return FDB.tx(['documentEdits'], function (api) { api.del('documentEdits', k); });
  },
  restore: function (invoiceId, ix) {
    var rec = Edits.get(invoiceId);
    if (!rec || !rec.revisions || !rec.revisions[ix]) return Promise.resolve(null);
    var state = rec.revisions[ix].state;
    rec.revisions.unshift({ at: nowISO(), by: global.CURRENT_USER || 'Owner',
                            note: 'Before restoring an earlier version', state: Edits.snapshot(rec) });
    Object.assign(rec, JSON.parse(JSON.stringify(state)));
    rec.lastSaved = Edits.snapshot(rec);
    return Edits.save(invoiceId).then(function () { return rec; });
  },
  loadAll: function () {
    return FDB.hydrate().then(function (data) {
      (data.documentEdits || []).forEach(function (r) { edits[r.id] = r; });
      return edits;
    }).catch(function () { return edits; });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   THE SHEET — the numbers behind the paper, with the edits folded in
   ══════════════════════════════════════════════════════════════════════════ */
function buildSheet(invoiceId) {
  var inv = ERP.Invoices.byId(invoiceId);
  if (!inv) return null;
  var e = Edits.get(invoiceId) || Edits.blank(invoiceId);
  var f = e.fields || {}, ro = e.rows || {}, removed = e.removed || [];
  var lines = ERP.Invoices.items(invoiceId)
    .filter(function (it) { return removed.indexOf(it.id) === -1; })
    .map(function (it) {
      var o = ro[it.id] || {};
      var qty = o.quantity !== undefined ? Number(o.quantity) || 0 : it.quantity;
      var rate = o.unitPrice !== undefined ? M.toP(o.unitPrice) : it.unitPrice;
      var disc = o.discount !== undefined ? M.toP(o.discount) : it.discount;
      var amt = o.lineTotal !== undefined ? M.toP(o.lineTotal) : Math.max(0, M.mul(rate, qty) - disc);
      return {
        key: it.id, kind: 'item',
        description: o.description !== undefined ? o.description : (it.descriptionEnSnapshot || ''),
        descriptionUr: o.descriptionUr !== undefined ? o.descriptionUr : (it.descriptionSnapshot || ''),
        brand: o.brand !== undefined ? o.brand : (it.brandSnapshot || ''),
        pack: o.pack !== undefined ? o.pack : (it.packageSnapshot || 'Bag'),
        unit: it.unit || 'Bag', qty: qty, rate: rate, disc: disc, amount: amt,
        edited: Object.keys(o).length > 0
      };
    });
  (e.extraRows || []).forEach(function (r) {
    var qty = Number(r.quantity) || 0, rate = M.toP(r.unitPrice), disc = M.toP(r.discount);
    lines.push({
      key: r.id, kind: 'extra', description: r.description || '', descriptionUr: r.descriptionUr || '',
      brand: r.brand || '', pack: r.pack || '', unit: 'Bag', qty: qty, rate: rate, disc: disc,
      amount: r.lineTotal !== undefined && r.lineTotal !== '' ? M.toP(r.lineTotal)
              : Math.max(0, M.mul(rate, qty) - disc),
      edited: true, added: true
    });
  });

  var subtotal = M.sum(lines.map(function (l) { return M.mul(l.rate, l.qty); }));
  var itemDisc = M.sum(lines.map(function (l) { return l.disc; }));
  var lineTotal = M.sum(lines.map(function (l) { return l.amount; }));
  var charges = (e.charges || []).map(function (c) {
    return { label: c.label || 'Charge', amount: M.toP(c.amount) };
  });
  var chargeTotal = M.sum(charges.map(function (c) { return c.amount; }));

  /* charges the invoice itself already carries stay unless they were edited */
  var base = [];
  if (inv.invoiceDiscount) base.push({ label: 'Invoice discount', amount: -inv.invoiceDiscount, fromInvoice: true });
  if (inv.taxAmount)      base.push({ label: 'Tax', amount: inv.taxAmount, fromInvoice: true });
  if (inv.freightAmount)  base.push({ label: 'Delivery / freight', amount: inv.freightAmount, fromInvoice: true });
  if (inv.loadingAmount)  base.push({ label: 'Loading / unloading', amount: inv.loadingAmount, fromInvoice: true });
  if (inv.otherCharges)   base.push({ label: 'Other charges', amount: inv.otherCharges, fromInvoice: true });
  var baseTotal = M.sum(base.map(function (c) { return c.amount; }));

  var grand = f.grandTotal !== undefined && f.grandTotal !== ''
    ? M.toP(f.grandTotal) : lineTotal + baseTotal + chargeTotal;
  var paid = f.paidAmount !== undefined && f.paidAmount !== ''
    ? M.toP(f.paidAmount) : ERP.Invoices.paidFor(invoiceId);
  var opening = f.previousBalance !== undefined && f.previousBalance !== ''
    ? M.toP(f.previousBalance) : (inv.previousBalance || 0);

  return {
    invoice: inv, edit: e, lines: lines, charges: base.concat(charges),
    extraCharges: charges,
    subtotal: subtotal, itemDiscounts: itemDisc, lineTotal: lineTotal,
    grand: grand, paid: paid, opening: opening,
    qtyTotal: lines.reduce(function (a, l) { return a + l.qty; }, 0),
    notes: e.notes !== undefined && e.notes !== '' ? e.notes : (inv.notes || ''),
    title: f.title || 'INVOICE',
    number: f.number !== undefined && f.number !== '' ? f.number : (inv.invoiceNumber || 'DRAFT'),
    date: f.invoiceDate || inv.invoiceDate,
    dueDate: f.dueDate !== undefined ? f.dueDate : (inv.dueDate || ''),
    orderNumber: f.orderNumber !== undefined ? f.orderNumber : (inv.orderNumber || ''),
    warehouse: f.warehouse !== undefined ? f.warehouse : (inv.warehouseSnapshot || ''),
    salesperson: f.salesperson !== undefined ? f.salesperson : (inv.salesperson || ''),
    shop: f.shop !== undefined ? f.shop : (inv.shopNameSnapshot || ''),
    owner: f.owner !== undefined ? f.owner : (inv.customerNameSnapshot || ''),
    code: f.code !== undefined ? f.code : (inv.customerCodeSnapshot || ''),
    contact: f.contact !== undefined ? f.contact : (inv.mobileSnapshot || ''),
    address: f.address !== undefined ? f.address : (inv.addressSnapshot || ''),
    region: f.region !== undefined ? f.region : (inv.regionSnapshot || ''),
    paymentStatus: f.paymentStatus !== undefined ? f.paymentStatus
      : (ERP.STATUS_LABEL[inv.paymentStatus] || inv.paymentStatus)
  };
}
ERP.buildSheet = buildSheet;

/* ── fold the sheet back into the document model ── */
function applyEdits(m, invoiceId) {
  var sheet = buildSheet(invoiceId);
  if (!sheet) return m;
  var e = sheet.edit;
  var touched = Edits.has(invoiceId);
  if (!touched) return m;

  m.edited = true;
  m.title = sheet.title;
  m.number = sheet.number;
  m.date = global.fmtDate ? global.fmtDate(sheet.date) : sheet.date;
  m.rawDate = sheet.date;
  m.party.shop = sheet.shop; m.party.owner = sheet.owner; m.party.code = sheet.code;
  m.party.contact = sheet.contact; m.party.address = sheet.address; m.party.region = sheet.region;
  m.notes = sheet.notes;

  m.meta = m.meta.map(function (row) {
    if (/Invoice No/i.test(row[0])) return [row[0], sheet.number, true];
    if (/Invoice date/i.test(row[0])) return [row[0], m.date];
    if (/Due date/i.test(row[0])) return [row[0], sheet.dueDate ? (global.fmtDate ? global.fmtDate(sheet.dueDate) : sheet.dueDate) : '—'];
    if (/Order No/i.test(row[0])) return [row[0], sheet.orderNumber || '—'];
    if (/Warehouse/i.test(row[0])) return [row[0], sheet.warehouse];
    if (/Payment status/i.test(row[0])) return [row[0], sheet.paymentStatus];
    if (/Salesperson/i.test(row[0])) return [row[0], sheet.salesperson];
    return row;
  });

  m.rows = sheet.lines.map(function (l, i) {
    return {
      sr: i + 1, description: l.description, descriptionUr: l.descriptionUr,
      brand: l.brand || '—', pack: l.pack || 'Bag',
      qty: Number(l.qty).toLocaleString('en-US') + ' ' + (l.unit || 'Bag') + (l.qty === 1 ? '' : 's'),
      rate: M.fmtPlain(l.rate), discount: l.disc ? M.fmtPlain(l.disc) : '—',
      amount: M.fmtPlain(l.amount)
    };
  });
  m.itemsFooter = {
    description: 'Total — ' + sheet.lines.length + (sheet.lines.length === 1 ? ' line' : ' lines'),
    qty: Number(sheet.qtyTotal).toLocaleString('en-US') + ' Bags',
    amount: M.fmtPlain(sheet.lineTotal)
  };

  var totals = [{ label: 'Subtotal', value: M.fmt(sheet.subtotal) }];
  if (sheet.itemDiscounts) totals.push({ label: 'Item discounts', value: '− ' + M.fmt(sheet.itemDiscounts) });
  sheet.charges.forEach(function (c) {
    totals.push({ label: c.label, value: (c.amount < 0 ? '− ' : '') + M.fmt(Math.abs(c.amount)) });
  });
  totals.push({ label: 'Grand total', labelUr: 'ٹوٹل بل رقم', value: M.fmt(sheet.grand), big: true, rule: true });
  totals.push({ label: 'Amount paid', labelUr: 'نقد وصول', value: M.fmt(sheet.paid) });
  totals.push({ label: 'Balance on this invoice', labelUr: 'بقایا رقم',
                value: M.fmt(sheet.grand - sheet.paid), bold: true });
  m.totals = totals;
  m.words = global.words ? global.words(Math.round(M.toR(sheet.grand))) : m.words;
  m.ledger = [
    ['Previous balance', M.fmt(sheet.opening), 'سابقہ بقایا رقم'],
    ['This invoice', '+ ' + M.fmt(sheet.grand), ''],
    ['Payment received', '− ' + M.fmt(sheet.paid), ''],
    ['Current outstanding balance', M.fmt(sheet.opening + sheet.grand - sheet.paid), 'بقایا رقم']
  ];

  if (m.classic) {
    m.classic.qtyTotal = sheet.qtyTotal;
    m.classic.lineTotal = M.fmtPlain(sheet.lineTotal);
    m.classic.remarks = sheet.notes;
    m.classic.contact = sheet.contact || 'Nil';
    m.classic.dateDmy = dmy(sheet.date);
    var chargeRows = (sheet.charges || []).filter(function (c) { return c.amount; })
      .map(function (c) { return [c.label + ':', '', M.fmtPlain(c.amount), false]; });
    m.classic.box = chargeRows.concat([
      ['Gross Amounts:', 'سب ٹوٹل', M.fmtPlain(sheet.grand), false],
      ['Opening', 'سابقہ بقایا رقم', M.fmtPlain(sheet.opening), false],
      ['Total :', 'ٹوٹل بل رقم', M.fmtPlain(sheet.opening + sheet.grand), true],
      ['Cash Amt:', 'نقد وصول', M.fmtPlain(sheet.paid), false],
      ['', '', M.fmtPlain(0), false],
      ['Balance', 'بقایا رقم', M.fmtPlain(sheet.opening + sheet.grand - sheet.paid), true]
    ]);
    if (sheet.number) m.classic.invNo = (ERP.Settings.get().salesDocPrefix || 'SLV') + '-' +
      String(/(\d+)$/.exec(sheet.number) ? /(\d+)$/.exec(sheet.number)[1] : '').padStart(6, '0');
  }
  return m;
}

var origInvoiceModel = ERP.DocModel.invoice;
ERP.DocModel.invoice = function (id) {
  var m = origInvoiceModel.call(ERP.DocModel, id);
  if (!m) return m;
  m.actions = Object.assign({}, m.actions, { edittext: true });
  return applyEdits(m, id);
};

/* ══════════════════════════════════════════════════════════════════════════
   THE EDITOR
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
#fceditor{position:fixed;inset:0;z-index:125;background:var(--canvas,#F6F5F9);display:none;
  flex-direction:column}
#fceditor.on{display:flex}
.fce-bar{display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--surface);
  border-bottom:1px solid var(--line);flex-wrap:wrap}
.fce-bar .grow{flex:1}
.fce-t b{font-size:15px}
.fce-t span{font-size:12.5px;color:var(--muted);margin-left:8px}
.fce-save{font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:5px}
.fce-save.on{color:var(--green)}
.fce-wrap{flex:1;display:grid;grid-template-columns:minmax(360px,460px) 1fr;overflow:hidden}
.fce-form{overflow:auto;padding:16px;border-right:1px solid var(--line);background:var(--surface)}
.fce-prev{overflow:auto;padding:18px;display:flex;justify-content:center;align-items:flex-start}
.fce-prev .fcdoc{box-shadow:0 10px 40px rgba(18,17,26,.16)}
.fce-sec{margin-bottom:18px}
.fce-sec>h4{font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:var(--violet);
  margin:0 0 8px;font-weight:700}
.fce-g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fce-f{display:block;margin-bottom:8px}
.fce-f span{display:block;font-size:11.5px;color:var(--muted);margin-bottom:3px}
.fce-f input,.fce-f textarea,.fce-f select{width:100%;padding:9px 10px;border:1.5px solid var(--line);
  border-radius:var(--r-sm);background:var(--surface);font-size:14.5px;font-family:inherit}
.fce-f input:focus,.fce-f textarea:focus{outline:none;border-color:var(--violet);
  box-shadow:0 0 0 3px var(--violet-50)}
.fce-line{border:1px solid var(--line);border-radius:var(--r);padding:10px;margin-bottom:9px;
  background:var(--surface-2);position:relative}
.fce-line.edited{border-color:var(--violet);background:var(--violet-50)}
.fce-line .rm{position:absolute;top:6px;right:6px;border:none;background:none;color:var(--muted);
  font-size:15px;line-height:1;padding:4px 7px;border-radius:6px;cursor:pointer}
.fce-line .rm:hover{background:var(--clay-50);color:var(--clay)}
.fce-line .amt{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;margin-top:4px}
.fce-g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}
.fce-charge{display:grid;grid-template-columns:1fr 130px 34px;gap:7px;align-items:center;margin-bottom:7px}
.fce-charge button{border:none;background:none;color:var(--muted);border-radius:6px;padding:6px}
.fce-charge button:hover{background:var(--clay-50);color:var(--clay)}
.fce-note-tools{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.fce-chip{border:1px solid var(--line);background:var(--surface);border-radius:99px;padding:5px 11px;
  font-size:12px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fce-chip:hover{border-color:var(--violet);background:var(--violet-50)}
.fce-revs{border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.fce-rev{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;
  border-bottom:1px solid var(--line-2);font-size:12.5px}
.fce-rev:last-child{border-bottom:none}
.fce-tabs{display:none;gap:6px;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--line)}
.fce-tabs button{flex:1;padding:9px;border:1px solid var(--line);background:var(--surface);
  border-radius:var(--r-sm);font-weight:600;font-size:13.5px}
.fce-tabs button.on{background:var(--violet);border-color:var(--violet);color:#fff}
@media (max-width:900px){
  .fce-wrap{grid-template-columns:1fr}
  .fce-tabs{display:flex}
  .fce-form{border-right:none;padding-bottom:90px}
  body.fce-preview .fce-form{display:none}
  body:not(.fce-preview) .fce-prev{display:none}
  .fce-bar{padding:8px 10px;gap:6px;overflow-x:auto;flex-wrap:nowrap}
  .fce-bar .btn,.fce-bar .fcv-btn{flex:0 0 auto;white-space:nowrap;min-height:40px}
  .fce-t span{display:none}
  .fce-g3{grid-template-columns:1fr 1fr}
}`;
(function () { var st = D.createElement('style'); st.id = 'fc-editor-css'; st.textContent = CSS; D.head.appendChild(st); })();

var Editor = ERP.Editor = {
  invoiceId: null, saveTimer: null, savedAt: null, dirty: false,

  open: function (invoiceId) {
    var inv = ERP.Invoices.byId(invoiceId);
    if (!inv) { say('That invoice could not be opened.'); return; }
    Editor.invoiceId = invoiceId;
    Edits.ensure(invoiceId);
    var host = D.getElementById('fceditor');
    if (!host) {
      host = D.createElement('div');
      host.id = 'fceditor';
      D.body.appendChild(host);
    }
    host.classList.add('on');
    D.body.classList.remove('fce-preview');
    Editor.render();
    ERP.Audit.detached({ action: 'Invoice opened for editing', entity: 'Invoice',
                         entityId: invoiceId, ref: inv.invoiceNumber });
  },
  close: function (skipConfirm) {
    if (Editor.dirty && !skipConfirm) Editor.flush();
    var host = D.getElementById('fceditor');
    if (host) { host.classList.remove('on'); host.innerHTML = ''; }
    D.body.classList.remove('fce-preview');
    Editor.invoiceId = null;
  },

  model: function () { return ERP.DocModel.invoice(Editor.invoiceId); },

  render: function () {
    var host = D.getElementById('fceditor');
    if (!host || !Editor.invoiceId) return;
    var sheet = buildSheet(Editor.invoiceId);
    var m = Editor.model();
    host.innerHTML =
      '<div class="fce-bar">' +
        '<div class="fce-t"><b>Edit before printing</b>' +
          '<span>' + esc(sheet.number) + ' · ' + esc(sheet.shop) + '</span></div>' +
        '<span class="fce-save' + (Editor.savedAt ? ' on' : '') + '" id="fceSaved">' +
          (Editor.savedAt ? I('check') + 'Saved' : 'Changes save themselves') + '</span>' +
        '<div class="grow"></div>' +
        '<button class="fcv-btn" data-fce="print">Print</button>' +
        '<button class="fcv-btn" data-fce="pdf">PDF</button>' +
        '<button class="fcv-btn pri" data-fce="word">Word</button>' +
        '<button class="fcv-btn" data-fce="wa">WhatsApp</button>' +
        '<button class="fcv-btn" data-fce="revert">Undo all edits</button>' +
        '<button class="fcv-btn" data-fce="close">' + I('x') + 'Close</button>' +
      '</div>' +
      '<div class="fce-tabs">' +
        '<button data-fcetab="form" class="' + (D.body.classList.contains('fce-preview') ? '' : 'on') + '">Edit</button>' +
        '<button data-fcetab="preview" class="' + (D.body.classList.contains('fce-preview') ? 'on' : '') + '">Preview</button>' +
      '</div>' +
      '<div class="fce-wrap">' +
        '<div class="fce-form">' + Editor.form(sheet) + '</div>' +
        '<div class="fce-prev" id="fcePrev">' + ERP.Paper.html(m) + '</div>' +
      '</div>';
  },

  /* only the paper is redrawn while typing, so the caret stays put */
  repaintPreview: function () {
    var prev = D.getElementById('fcePrev');
    if (prev) prev.innerHTML = ERP.Paper.html(Editor.model());
    var sheet = buildSheet(Editor.invoiceId);
    var amt = D.querySelectorAll('[data-fceamt]');
    Array.prototype.forEach.call(amt, function (el) {
      var line = sheet.lines.filter(function (l) { return l.key === el.dataset.fceamt; })[0];
      if (line) el.textContent = M.fmt(line.amount);
    });
  },

  form: function (sheet) {
    var cfg = ERP.Settings.get();
    var f = function (key, label, value, type) {
      return '<label class="fce-f"><span>' + label + '</span>' +
        '<input data-fcefield="' + key + '"' + (type ? ' type="' + type + '"' : '') +
        ' value="' + esc(value === null || value === undefined ? '' : value) + '"></label>';
    };
    var lines = sheet.lines.map(function (l) {
      return '<div class="fce-line' + (l.edited ? ' edited' : '') + '">' +
        '<button class="rm" data-fceremove="' + esc(l.key) + '" title="Remove this line">' + I('x') + '</button>' +
        '<label class="fce-f"><span>Description</span>' +
          '<input data-fcerow="' + esc(l.key) + '" data-f="description" value="' + esc(l.description) + '"></label>' +
        '<label class="fce-f"><span>Urdu name (printed)</span>' +
          '<input data-fcerow="' + esc(l.key) + '" data-f="descriptionUr" value="' + esc(l.descriptionUr) + '"></label>' +
        '<div class="fce-g3">' +
          '<label class="fce-f"><span>Qty</span><input inputmode="decimal" data-fcerow="' + esc(l.key) +
            '" data-f="quantity" value="' + esc(l.qty) + '"></label>' +
          '<label class="fce-f"><span>Rate</span><input inputmode="decimal" data-fcerow="' + esc(l.key) +
            '" data-f="unitPrice" value="' + esc(M.toR(l.rate)) + '"></label>' +
          '<label class="fce-f"><span>Discount</span><input inputmode="decimal" data-fcerow="' + esc(l.key) +
            '" data-f="discount" value="' + esc(l.disc ? M.toR(l.disc) : '') + '"></label>' +
        '</div>' +
        '<div class="amt" data-fceamt="' + esc(l.key) + '">' + M.fmt(l.amount) + '</div>' +
      '</div>';
    }).join('');

    var charges = (sheet.extraCharges || []).map(function (c, ix) {
      return '<div class="fce-charge">' +
        '<input data-fcecharge="' + ix + '" data-f="label" value="' + esc(c.label) + '" placeholder="Charge or discount">' +
        '<input data-fcecharge="' + ix + '" data-f="amount" inputmode="decimal" value="' +
          esc(M.toR(c.amount)) + '" placeholder="0">' +
        '<button data-fcechargedel="' + ix + '" title="Remove">' + I('x') + '</button></div>';
    }).join('');

    var history = (cfg.noteHistory || []).slice(0, 6).map(function (n) {
      return '<button class="fce-chip" data-fcenote="' + esc(n) + '">' + esc(n.slice(0, 46)) +
        (n.length > 46 ? '…' : '') + '</button>';
    }).join('');

    var rec = Edits.get(Editor.invoiceId) || {};
    var revs = (rec.revisions || []).map(function (r, ix) {
      return '<div class="fce-rev"><span>' + esc((r.at || '').replace('T', ' ').slice(0, 16)) +
        ' · ' + esc(r.by || '') + ' · ' + esc(r.note || '') + '</span>' +
        '<button class="btn sm" data-fcerev="' + ix + '">Restore</button></div>';
    }).join('');

    return '<div class="fce-sec"><h4>Invoice header</h4>' +
        '<div class="fce-g2">' + f('title', 'Title', sheet.title) + f('number', 'Invoice number', sheet.number) + '</div>' +
        '<div class="fce-g2">' + f('invoiceDate', 'Invoice date', sheet.date, 'date') +
          f('dueDate', 'Due date', sheet.dueDate, 'date') + '</div>' +
        '<div class="fce-g2">' + f('orderNumber', 'Order number', sheet.orderNumber) +
          f('warehouse', 'Warehouse', sheet.warehouse) + '</div>' +
        '<div class="fce-g2">' + f('paymentStatus', 'Payment status', sheet.paymentStatus) +
          f('salesperson', 'Salesperson', sheet.salesperson) + '</div>' +
      '</div>' +
      '<div class="fce-sec"><h4>Customer on the invoice</h4>' +
        f('shop', 'Shop / business', sheet.shop) +
        '<div class="fce-g2">' + f('owner', 'Owner', sheet.owner) + f('code', 'Customer code', sheet.code) + '</div>' +
        '<div class="fce-g2">' + f('contact', 'Mobile', sheet.contact) + f('region', 'Region', sheet.region) + '</div>' +
        f('address', 'Address', sheet.address) +
      '</div>' +
      '<div class="fce-sec"><h4>Items</h4>' + lines +
        '<button class="btn" data-fce="addline">' + I('plus') + 'Add a line</button>' +
      '</div>' +
      '<div class="fce-sec"><h4>Extra charges &amp; discounts</h4>' + charges +
        '<button class="btn" data-fce="addcharge">' + I('plus') + 'Add a charge</button>' +
        '<p class="hint" style="margin-top:6px">Use a minus figure for a discount.</p>' +
      '</div>' +
      '<div class="fce-sec"><h4>Totals</h4>' +
        '<div class="fce-g2">' + f('paidAmount', 'Amount paid', M.toR(sheet.paid)) +
          f('previousBalance', 'Previous balance', M.toR(sheet.opening)) + '</div>' +
        f('grandTotal', 'Grand total (leave blank to calculate)',
          Edits.get(Editor.invoiceId) && Edits.get(Editor.invoiceId).fields.grandTotal !== undefined
            ? Edits.get(Editor.invoiceId).fields.grandTotal : '') +
      '</div>' +
      '<div class="fce-sec"><h4>Comments &amp; instructions</h4>' +
        '<label class="fce-f"><textarea data-fcefield="notes" rows="4" ' +
          'placeholder="Special instructions:&#10;Delivery required before evening.&#10;Payment will be collected after 15 days.">' +
          esc(sheet.notes) + '</textarea></label>' +
        '<div class="fce-note-tools">' +
          '<button class="fce-chip" data-fce="savedefaultnote">Save as default</button>' +
          (cfg.defaultInvoiceNotes ? '<button class="fce-chip" data-fcenote="' +
            esc(cfg.defaultInvoiceNotes) + '">Use default</button>' : '') +
          history +
        '</div>' +
      '</div>' +
      (revs ? '<div class="fce-sec"><h4>Earlier versions</h4><div class="fce-revs">' + revs + '</div></div>' : '') +
      '<div class="fce-sec"><p class="hint">Everything here is printed exactly as it stands. ' +
        'The invoice record itself — stock, ledger and payments — is not changed by editing this paper.</p></div>';
  },

  /* ── edits ── */
  setField: function (key, value) {
    var rec = Edits.ensure(Editor.invoiceId);
    if (value === '' && key !== 'notes') delete rec.fields[key]; else rec.fields[key] = value;
    if (key === 'notes') rec.notes = value;
    Editor.touch();
  },
  setRow: function (key, field, value) {
    var rec = Edits.ensure(Editor.invoiceId);
    var extra = (rec.extraRows || []).filter(function (r) { return r.id === key; })[0];
    if (extra) { extra[field] = value; }
    else {
      rec.rows[key] = rec.rows[key] || {};
      if (value === '') delete rec.rows[key][field]; else rec.rows[key][field] = value;
      if (!Object.keys(rec.rows[key]).length) delete rec.rows[key];
    }
    Editor.touch();
  },
  removeRow: function (key) {
    var rec = Edits.ensure(Editor.invoiceId);
    var ix = (rec.extraRows || []).map(function (r) { return r.id; }).indexOf(key);
    if (ix > -1) rec.extraRows.splice(ix, 1);
    else if (rec.removed.indexOf(key) === -1) rec.removed.push(key);
    Editor.touch(); Editor.render();
  },
  addRow: function () {
    var rec = Edits.ensure(Editor.invoiceId);
    rec.extraRows.push({ id: FDB.uid('xr'), description: '', descriptionUr: '', brand: '', pack: '',
                         quantity: '', unitPrice: '', discount: '' });
    Editor.touch(); Editor.render();
  },
  addCharge: function () {
    var rec = Edits.ensure(Editor.invoiceId);
    rec.charges.push({ label: '', amount: '' });
    Editor.touch(); Editor.render();
  },
  setCharge: function (ix, field, value) {
    var rec = Edits.ensure(Editor.invoiceId);
    if (rec.charges[ix]) { rec.charges[ix][field] = value; Editor.touch(); }
  },
  removeCharge: function (ix) {
    var rec = Edits.ensure(Editor.invoiceId);
    rec.charges.splice(ix, 1); Editor.touch(); Editor.render();
  },

  touch: function () {
    Editor.dirty = true;
    Editor.savedAt = null;
    var badge = D.getElementById('fceSaved');
    if (badge) { badge.classList.remove('on'); badge.textContent = 'Saving…'; }
    Editor.repaintPreview();
    clearTimeout(Editor.saveTimer);
    Editor.saveTimer = setTimeout(Editor.flush, 700);
  },
  flush: function () {
    if (!Editor.invoiceId) return Promise.resolve();
    clearTimeout(Editor.saveTimer);
    var id = Editor.invoiceId;
    return Edits.save(id, { revision: true, note: 'Edited before printing' }).then(function () {
      Editor.dirty = false;
      Editor.savedAt = nowISO();
      var badge = D.getElementById('fceSaved');
      if (badge) { badge.classList.add('on'); badge.innerHTML = I('check') + 'Saved'; }
    }).catch(function () {
      var badge = D.getElementById('fceSaved');
      if (badge) badge.textContent = 'Could not save — take a backup';
    });
  },
  revert: function () {
    global.ERP.UI.confirm('Undo every manual edit?', {
      detail: 'The invoice goes back to exactly as it was recorded.',
      okText: 'Undo edits', cancelText: 'Keep my edits', tone: 'warn'
    }).then(function (ok) {
      if (!ok) return;
      var id = Editor.invoiceId;
      return Edits.clear(id).then(function () {
        Edits.ensure(id);
        Editor.render();
        say('Manual edits removed. The invoice prints as recorded again.');
      });
    });
  }
};

/* ══ wiring ══ */
D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var t = e.target.closest('[data-fce]');
  if (t) {
    var a = t.dataset.fce;
    e.preventDefault();
    if (a === 'close') { Editor.close(); return; }
    if (a === 'addline') { Editor.addRow(); return; }
    if (a === 'addcharge') { Editor.addCharge(); return; }
    if (a === 'revert') { Editor.revert(); return; }
    if (a === 'savedefaultnote') {
      var box = D.querySelector('[data-fcefield="notes"]');
      var text = box ? box.value : '';
      var cfg = ERP.Settings.get();
      var hist = (cfg.noteHistory || []).filter(function (n) { return n !== text; });
      if (text) hist.unshift(text);
      ERP.Settings.save({ defaultInvoiceNotes: text, noteHistory: hist.slice(0, 20) })
        .then(function () { Editor.render(); say('Saved as the default comment.'); });
      return;
    }
    if (a === 'print' || a === 'pdf' || a === 'word' || a === 'wa') {
      Editor.flush().then(function () {
        var m = Editor.model();
        ERP.Viewer.current = m;
        if (a === 'word') { ERP.Viewer.word(); return; }
        if (a === 'wa') { ERP.Viewer.whatsapp(); return; }
        /* print from the editor's own preview pane */
        var host = D.getElementById('fceditor');
        host.classList.add('fce-printing');
        ERP.Viewer.open(m, { zoom: ERP.isMobile && ERP.isMobile() ? ERP.mobile.fitZoom() : 1 });
        setTimeout(function () { ERP.Viewer.print(a === 'pdf'); }, 120);
      });
      return;
    }
  }
  var rm = e.target.closest('[data-fceremove]');
  if (rm) { e.preventDefault(); Editor.removeRow(rm.dataset.fceremove); return; }
  var cd = e.target.closest('[data-fcechargedel]');
  if (cd) { e.preventDefault(); Editor.removeCharge(+cd.dataset.fcechargedel); return; }
  var nt = e.target.closest('[data-fcenote]');
  if (nt) {
    e.preventDefault();
    var area = D.querySelector('[data-fcefield="notes"]');
    if (area) { area.value = nt.dataset.fcenote; Editor.setField('notes', area.value); }
    return;
  }
  var rv = e.target.closest('[data-fcerev]');
  if (rv) {
    e.preventDefault();
    Edits.restore(Editor.invoiceId, +rv.dataset.fcerev).then(function () {
      Editor.render(); say('Earlier version restored.');
    });
    return;
  }
  var tab = e.target.closest('[data-fcetab]');
  if (tab) {
    e.preventDefault();
    D.body.classList.toggle('fce-preview', tab.dataset.fcetab === 'preview');
    Editor.render();
    return;
  }
  /* the preview's own toolbar gets an entry point */
  var ed = e.target.closest('[data-fcv="edittext"]');
  if (ed) {
    e.preventDefault();
    var m = ERP.Viewer.current;
    if (m && m.kind === 'INVOICE') { ERP.Viewer.close(); Editor.open(m.entityId); }
  }
}, true);

D.addEventListener('input', function (e) {
  var el = e.target;
  if (!el.dataset || !Editor.invoiceId) return;
  if (el.dataset.fcefield !== undefined) { Editor.setField(el.dataset.fcefield, el.value); return; }
  if (el.dataset.fcerow !== undefined) { Editor.setRow(el.dataset.fcerow, el.dataset.f, el.value); return; }
  if (el.dataset.fcecharge !== undefined) { Editor.setCharge(+el.dataset.fcecharge, el.dataset.f, el.value); return; }
});

/* an unfinished edit is never lost to a closed tab */
global.addEventListener('beforeunload', function () { if (Editor.dirty) Editor.flush(); });
global.addEventListener('pagehide', function () { if (Editor.dirty) Editor.flush(); });

/* the preview offers the editor, and says when a document carries edits */
var origOpen = ERP.Viewer.open;
ERP.Viewer.open = function (model, opts) {
  origOpen.call(ERP.Viewer, model, opts);
  if (!model || model.kind !== 'INVOICE') return;
  var bar = D.querySelector('#fcviewer .fcv-bar');
  if (!bar || bar.querySelector('[data-fcv="edittext"]')) return;
  var b = D.createElement('button');
  b.className = 'fcv-btn';
  b.setAttribute('data-fcv', 'edittext');
  b.textContent = model.edited ? 'Edit text (edited)' : 'Edit before printing';
  bar.insertBefore(b, bar.querySelector('[data-fcv="close"]'));
};

/* Edits are loaded once the database is open. The boot has usually been
   started by the time this module runs, so it chains onto that promise
   rather than wrapping the function. */
(ERP.bootPromise || Promise.resolve()).then(function () { return Edits.loadAll(); })
  .then(function () { ERP.editsReady = true; })
  .catch(function () { ERP.editsReady = true; });

ERP.Editor = Editor;
})(typeof window !== 'undefined' ? window : globalThis);
