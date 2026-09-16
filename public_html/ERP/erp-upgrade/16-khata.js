/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 16
   THE CUSTOMER ACCOUNT STATEMENT  ·  the khata, kept properly
   Every shop has one account page showing its whole history: what was sold,
   what was paid, what came back, and what was adjusted — each line with the
   balance as it stood after it. The running balance is worked out from the
   transactions every time it is shown; it is never stored and never patched.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, FDB = global.FDB, D = global.document;
var S = ERP.S;
var I = function (n) { return global.I ? global.I(n) : ''; };
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function u(t) { return global.u ? global.u(t) : esc(t); }
function say(m) { return global.say ? global.say(m) : null; }
function nowISO() { return new Date().toISOString(); }
function today() { return global.FC_TODAY ? global.FC_TODAY() : new Date().toISOString().slice(0, 10); }
function fmtDate(x) { return global.fmtDate ? global.fmtDate(x) : x; }

/* ══════════════════════════════════════════════════════════════════════════
   ACCOUNT ADJUSTMENTS
   A correction to an account is a posted entry of its own with a reason and
   an audit record — never a quiet edit of a balance.
   ══════════════════════════════════════════════════════════════════════════ */
var Adjustments = ERP.Adjustments = {
  reasons: ['Opening balance correction', 'Discount allowed', 'Rounding', 'Bad debt written off',
            'Cheque returned', 'Additional charges', 'Freight recovered', 'Other correction'],
  all: function () { return S.accountAdjustments || (S.accountAdjustments = []); },
  forCustomer: function (id) {
    return Adjustments.all().filter(function (a) { return a.customerId === id && a.status !== 'REVERSED'; });
  },
  create: function (o) {
    var amount = M.toP(o.amount);
    var errs = [];
    if (!o.customerId || !global.custBy(o.customerId)) errs.push('Choose a shop.');
    if (!(amount > 0)) errs.push('Enter an amount greater than zero.');
    if (o.direction !== 'DEBIT' && o.direction !== 'CREDIT') errs.push('Choose whether this adds to or reduces what the shop owes.');
    if (!o.reason) errs.push('Give a reason — every adjustment is recorded against your name.');
    if (errs.length) return Promise.reject({ validation: errs });

    var opId = o.clientOpId || FDB.uid('adjop');
    return FDB.tx(['sequences', 'accountAdjustments', 'auditLog', 'operations'], function (api) {
      return FDB.claimOperation(api, opId, 'AccountAdjustment', {}).then(function () {
        return FDB.nextNumber(api, 'ACC').then(function (number) {
          var c = global.custBy(o.customerId) || {};
          var rec = {
            id: FDB.uid('acc'), adjustmentNumber: number, clientOpId: opId,
            customerId: o.customerId, customerNameSnapshot: c.sh || '',
            adjustmentDate: o.date || today(),
            direction: o.direction,                  /* DEBIT adds to what is owed */
            amount: amount, reason: o.reason, notes: o.notes || '',
            description: (ERP.Desc ? ERP.Desc.clean(o.description) : (o.description || '')),
            status: 'POSTED', createdBy: global.CURRENT_USER || 'Owner', createdAt: nowISO()
          };
          api.put('accountAdjustments', rec);
          Adjustments.all().unshift(rec);
          ERP.Audit.write(api, {
            action: 'Account adjustment posted', entity: 'AccountAdjustment', entityId: rec.id,
            ref: number, reason: rec.reason,
            newValues: { shop: rec.customerNameSnapshot, direction: rec.direction, amount: rec.amount }
          });
          return rec;
        });
      });
    }).then(function (r) { ERP.Mirror.refresh(); return r; });
  },
  reverse: function (id, reason) {
    var rec = Adjustments.all().filter(function (a) { return a.id === id; })[0];
    if (!rec) return Promise.resolve(null);
    return FDB.tx(['accountAdjustments', 'auditLog'], function (api) {
      rec.status = 'REVERSED'; rec.reversedAt = nowISO(); rec.reverseReason = reason || '';
      api.put('accountAdjustments', rec);
      ERP.Audit.write(api, { action: 'Account adjustment reversed', entity: 'AccountAdjustment',
        entityId: id, ref: rec.adjustmentNumber, reason: reason || '',
        oldValues: { status: 'POSTED' }, newValues: { status: 'REVERSED' } });
    }).then(function () { ERP.Mirror.refresh(); return rec; });
  }
};

/* ── the ledger everywhere now includes adjustments ───────────────────────
   Patched in one place so the statement, the invoice's "previous balance",
   the receivables report and the collection figures cannot disagree. ── */
var origCustomerLedger = ERP.Ledger.customer;
ERP.Ledger.customer = function (customerId, fromISO, toISO) {
  var full = origCustomerLedger.call(ERP.Ledger, customerId, null, null);
  var rows = full.rows.map(function (r) {
    return { iso: r.iso, ref: r.ref, what: r.what, dr: r.dr, cr: r.cr, kind: r.kind,
             id: r.id, createdAt: r.createdAt };
  });
  Adjustments.forCustomer(customerId).forEach(function (a) {
    rows.push({
      iso: a.adjustmentDate, ref: a.adjustmentNumber,
      what: 'Adjustment — ' + a.reason,
      description: a.description || '',
      dr: a.direction === 'DEBIT' ? a.amount : 0,
      cr: a.direction === 'CREDIT' ? a.amount : 0,
      kind: 'ADJUSTMENT', id: a.id, createdAt: a.createdAt
    });
  });
  rows.sort(function (a, b) {
    if (a.kind === 'OPENING') return -1;
    if (b.kind === 'OPENING') return 1;
    if (a.iso !== b.iso) return a.iso < b.iso ? -1 : 1;
    return (a.createdAt || '') < (b.createdAt || '') ? -1
         : (a.createdAt || '') > (b.createdAt || '') ? 1 : 0;
  });
  /* Opening is the balance as it stood before the period; closing is the
     balance at the end of it. Anything dated after the period is left out
     of both — a statement for January must not be moved by a February sale. */
  var bal = 0, opening = 0, out = [];
  rows.forEach(function (r) {
    var delta = r.dr - r.cr;
    if (fromISO && r.iso < fromISO) { bal += delta; opening = bal; return; }
    if (toISO && r.iso > toISO) return;
    bal += delta;
    out.push(Object.assign({}, r, { balance: bal }));
  });
  return {
    opening: opening, rows: out, closing: bal,
    debit: out.reduce(function (a, r) { return a + r.dr; }, 0),
    credit: out.reduce(function (a, r) { return a + r.cr; }, 0)
  };
};

/* ══════════════════════════════════════════════════════════════════════════
   THE KHATA — one page of entries, with everything needed to read them
   ══════════════════════════════════════════════════════════════════════════ */
var TYPE = {
  OPENING:    { label: 'Opening balance', cls: 'neu',  icon: 'clock' },
  SALE:       { label: 'Sale',            cls: 'info', icon: 'tag' },
  PAYMENT:    { label: 'Payment received', cls: 'ok',  icon: 'wallet' },
  REFUND:     { label: 'Refund paid',     cls: 'low',  icon: 'wallet' },
  RETURN:     { label: 'Sales return',    cls: 'low',  icon: 'swap' },
  ADJUSTMENT: { label: 'Adjustment',      cls: 'neu',  icon: 'edit' }
};

var Khata = ERP.Khata = {
  TYPE: TYPE,

  /* Every entry, with the running balance worked out across the whole
     account — so a filtered view still shows true balances. */
  entries: function (customerId) {
    var L = ERP.Ledger.customer(customerId, null, null);
    return L.rows.map(function (r) {
      var e = {
        id: r.id, iso: r.iso, date: fmtDate(r.iso), type: r.kind, ref: r.ref,
        description: r.description || r.what, debit: r.dr, credit: r.cr, balance: r.balance,
        qty: r.qty, qtyLabel: (ERP.Desc && ERP.Desc.qtyLabel) ? ERP.Desc.qtyLabel(r) : '—',
        detail: '', method: '', canOpen: false
      };
      if (r.kind === 'INVOICE') {
        e.type = 'SALE';
        var inv = ERP.Invoices.byId(r.id);
        if (inv) {
          var items = ERP.Invoices.items(inv.id);
          /* the ledger row already resolved this: a manually entered
             description wins, otherwise the generated one. Never regenerate
             over the user's own words. */
          e.description = r.description || ('Invoice ' + inv.invoiceNumber);
          e.detail = items.slice(0, 4).map(function (it) {
            return (it.descriptionEnSnapshot || it.descriptionSnapshot) +
              (it.packageSnapshot && it.packageSnapshot !== 'Bag' ? ' ' + it.packageSnapshot : '') +
              ' × ' + Number(it.quantity).toLocaleString('en-US') + ' bags';
          }).join(' · ') + (items.length > 4 ? ' · +' + (items.length - 4) + ' more' : '');
          e.method = inv.paymentMethod || '';
          e.warehouse = inv.warehouseSnapshot;
          e.salesperson = inv.salesperson;
          e.canOpen = 'invoice';
        }
      } else if (r.kind === 'PAYMENT' || r.kind === 'REFUND') {
        var p = ERP.Payments.byId(r.id);
        e.type = r.kind === 'REFUND' ? 'REFUND' : 'PAYMENT';
        if (p) {
          e.description = (r.kind === 'REFUND' ? 'Refund ' : 'Receipt ') + p.receiptNumber;
          e.method = p.method;
          e.detail = [p.reference ? 'Ref ' + p.reference : '', p.note || ''].filter(Boolean).join(' · ');
          e.canOpen = 'payment';
        }
      } else if (r.kind === 'RETURN') {
        var ret = S.custReturns.filter(function (x) { return x.id === r.id; })[0];
        if (ret) {
          e.description = 'Return ' + ret.returnNumber + ' against ' + ret.invoiceNumber;
          e.detail = ERP.Returns.customerItems(ret.id).map(function (it) {
            return (it.descriptionEnSnapshot || it.descriptionSnapshot) + ' × ' + it.quantity;
          }).join(' · ') + (ret.reason ? ' — ' + ret.reason : '');
          e.canOpen = 'custreturn';
        }
      } else if (r.kind === 'ADJUSTMENT') {
        var a = Adjustments.all().filter(function (x) { return x.id === r.id; })[0];
        if (a) { e.detail = a.notes || ''; e.canReverse = true; }
      }
      return e;
    });
  },

  filter: function (list, f) {
    f = f || {};
    var q = (f.q || '').toLowerCase().trim();
    return list.filter(function (e) {
      if (f.from && e.iso < f.from && e.type !== 'OPENING') return false;
      if (f.to && e.iso > f.to) return false;
      if (f.types && f.types.length && f.types.indexOf(e.type) === -1 && e.type !== 'OPENING') return false;
      if (f.method && e.method !== f.method) return false;
      if (q) {
        var hay = [e.ref, e.description, e.detail, e.method, e.date].filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  },

  summary: function (customerId, f) {
    var all = Khata.entries(customerId);
    var shown = Khata.filter(all, f);
    var inPeriod = shown.filter(function (e) { return e.type !== 'OPENING'; });
    var first = shown[0];
    /* the balance as it stood before the first shown entry */
    var openingBalance = first ? first.balance - first.debit + first.credit : ERP.Ledger.customerBalance(customerId);
    var sum = function (list, k) { return list.reduce(function (a, e) { return a + e[k]; }, 0); };
    var ofType = function (t) { return inPeriod.filter(function (e) { return e.type === t; }); };
    var payments = ofType('PAYMENT');
    var lastPayment = payments.length ? payments[payments.length - 1] : null;
    var lastTx = inPeriod.length ? inPeriod[inPeriod.length - 1] : null;
    return {
      opening: openingBalance,
      sales: sum(ofType('SALE'), 'debit'),
      salesCount: ofType('SALE').length,
      payments: sum(payments, 'credit'),
      paymentCount: payments.length,
      returns: sum(ofType('RETURN'), 'credit'),
      refunds: sum(ofType('REFUND'), 'debit'),
      adjustmentsDr: sum(ofType('ADJUSTMENT'), 'debit'),
      adjustmentsCr: sum(ofType('ADJUSTMENT'), 'credit'),
      debit: sum(inPeriod, 'debit'), credit: sum(inPeriod, 'credit'),
      closing: shown.length ? shown[shown.length - 1].balance : ERP.Ledger.customerBalance(customerId),
      overall: ERP.Ledger.customerBalance(customerId),
      lastTransactionDate: lastTx ? lastTx.iso : null,
      lastPaymentDate: lastPayment ? lastPayment.iso : null,
      lastPaymentAmount: lastPayment ? lastPayment.credit : 0,
      count: inPeriod.length, rows: shown, all: all
    };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   THE PAGE
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
.kh-head{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;margin-bottom:14px}
@media(max-width:900px){.kh-head{grid-template-columns:1fr}}
.kh-id b{font-size:20px;display:block;line-height:1.25}
.kh-id .sub{color:var(--muted);font-size:13.5px;margin-top:2px}
.kh-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:12px}
.kh-facts div{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 10px}
.kh-facts i{font-style:normal;display:block;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)}
.kh-facts b{font-size:14px}
.kh-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kh-card{border:1px solid var(--line);border-radius:var(--r);padding:12px 13px;background:var(--surface)}
.kh-card i{font-style:normal;display:block;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}
.kh-card b{display:block;font-size:19px;font-weight:800;margin-top:3px;font-variant-numeric:tabular-nums}
.kh-card.sale b{color:var(--violet)}
.kh-card.credit b{color:var(--green)}
.kh-card.due b{color:var(--clay)}
.kh-card.warn b{color:var(--ochre)}
.kh-card .d{font-size:11.5px;color:var(--muted);margin-top:2px}
table.kh-table{width:100%;border-collapse:collapse;min-width:880px}
table.kh-table th{font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);
  text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
table.kh-table td{padding:10px;border-bottom:1px solid var(--line-2);vertical-align:top}
table.kh-table tr.opening td{background:var(--surface-2);font-weight:600}
.kh-desc b{display:block}
.kh-desc span{display:block;font-size:12px;color:var(--muted);margin-top:1px}
.kh-dr{color:var(--clay);font-weight:600;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.kh-cr{color:var(--green);font-weight:600;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.kh-bal{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.kh-bal.neg{color:var(--green)}
.kh-pager{display:flex;align-items:center;gap:10px;justify-content:flex-end;padding:10px 2px;flex-wrap:wrap}
.kh-pager span{font-size:12.5px;color:var(--muted)}
@media(max-width:760px){
  body.fc-mobile table.kh-table{min-width:0}
  body.fc-mobile .kh-cards{grid-template-columns:1fr 1fr}
  body.fc-mobile .kh-card b{font-size:16px}
}`;
(function () { var s = D.createElement('style'); s.id = 'fc-khata-css'; s.textContent = CSS; D.head.appendChild(s); })();

var K = ERP.KhataState = {
  customerId: null, preset: 'all', from: '', to: '',
  types: [], method: '', q: '', order: 'desc', page: 1, perPage: 50
};

function period() {
  if (K.preset === 'custom') return { from: K.from || null, to: K.to || null, label: 'Custom range' };
  var p = ERP.Period.resolve ? ERP.Period.resolve(K.preset) : null;
  if (p) return { from: p[0], to: p[1], label: p[2] || '' };
  return { from: null, to: null, label: 'All time' };
}
function filters() {
  var p = period();
  return { from: p.from, to: p.to, types: K.types, method: K.method, q: K.q };
}

global.PAGES.khata = function (customerId) {
  K.customerId = customerId || K.customerId;
  var c = global.custBy ? global.custBy(K.customerId) : null;
  if (!c) return '<div class="empty"><div class="ei">' + I('users') + '</div><b>Shop not found</b>' +
    '<p>Pick a shop from the customers list.</p>' +
    '<button class="btn pri" data-go="customers">Open customers</button></div>';

  var f = filters(), p = period();
  var sum = Khata.summary(c.id, f);
  var rows = sum.rows.slice();
  if (K.order === 'desc') rows.reverse();
  var pages = Math.max(1, Math.ceil(rows.length / K.perPage));
  if (K.page > pages) K.page = pages;
  var slice = rows.slice((K.page - 1) * K.perPage, K.page * K.perPage);
  var region = c.region && global.regionOf ? global.regionOf(c.region) : null;

  var fact = function (l, v) { return '<div><i>' + l + '</i><b>' + (v || '—') + '</b></div>'; };
  var card = function (cls, l, v, d) {
    return '<div class="kh-card ' + cls + '"><i>' + l + '</i><b>' + v + '</b>' +
      (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  };

  var presets = [['all', 'All time'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'],
                 ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['year', 'This year'],
                 ['custom', 'Custom range']];
  var typeOpts = ['SALE', 'PAYMENT', 'RETURN', 'ADJUSTMENT', 'REFUND'];

  var body = slice.map(function (e) {
    var t = TYPE[e.type] || TYPE.SALE;
    return '<tr' + (e.type === 'OPENING' ? ' class="opening"' : '') + ' data-row>' +
      '<td data-label="Date">' + esc(e.date) + '</td>' +
      '<td data-label="Type">' + (global.pill ? global.pill(t.cls, t.label) : esc(t.label)) + '</td>' +
      '<td data-label="Reference" class="mono">' + esc(e.ref || '—') + '</td>' +
      '<td data-label="Description / تفصیل" class="kh-desc"><b>' + esc(e.description) + '</b>' +
        (e.detail ? '<span>' + esc(e.detail) + '</span>' : '') +
        (e.method ? '<span>' + esc(e.method) + '</span>' : '') + '</td>' +
      '<td data-label="Qty" class="kh-qty">' + esc(e.qtyLabel || '—') + '</td>' +
      '<td data-label="Debit" class="kh-dr">' + (e.debit ? M.fmtPlain(e.debit) : '—') + '</td>' +
      '<td data-label="Credit" class="kh-cr">' + (e.credit ? M.fmtPlain(e.credit) : '—') + '</td>' +
      '<td data-label="Balance" class="kh-bal' + (e.balance < 0 ? ' neg' : '') + '">' +
        M.fmtPlain(e.balance) + '</td>' +
      '<td data-label="" class="c">' +
        (e.canOpen ? '<button class="btn sm" data-khopen="' + e.canOpen + '" data-id="' + e.id + '">Open</button>' : '') +
        (e.canReverse ? '<button class="btn sm" data-khreverse="' + e.id + '">Reverse</button>' : '') +
      '</td></tr>';
  }).join('');

  return '<div class="kh-head">' +
      '<div class="card"><div class="card-b">' +
        '<div class="kh-id"><b>' + esc(c.sh || '') + '</b>' +
          '<div class="sub">' + esc(c.ow || 'Owner not recorded') + ' · ' +
            (region ? u(region.ur) + ' — ' + esc(region.en) : 'No region') + '</div></div>' +
        '<div class="kh-facts">' +
          fact('Customer ID', esc(c.legacyCode || c.id)) +
          fact('Phone', esc(c.ph || '')) +
          fact('WhatsApp', esc(c.wa || c.ph || '')) +
          fact('Address', esc(c.addr || c.area || '')) +
          fact('Route', esc(c.route || '')) +
          fact('Salesperson', esc(c.salesperson || 'Not assigned')) +
        '</div>' +
        '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn pri" data-khpay="' + c.id + '">' + I('wallet') + 'Receive payment</button>' +
          '<button class="btn pri" data-khrefund="' + c.id + '">' + I('wallet') + 'Pay this shop</button>' +
          '<button class="btn" data-khadjust="' + c.id + '">' + I('edit') + 'Adjustment</button>' +
          '<button class="btn" data-fcnew="sale">' + I('plus') + 'New invoice</button>' +
        '</div>' +
      '</div></div>' +
      '<div class="card"><div class="card-b"><div class="kh-cards">' +
        card('', 'Opening balance', M.fmt(sum.opening), p.label) +
        card('sale', 'Total sales', M.fmt(sum.sales), sum.salesCount + ' invoice' + (sum.salesCount === 1 ? '' : 's')) +
        card('credit', 'Payments received', M.fmt(sum.payments),
          sum.lastPaymentDate ? 'Last ' + fmtDate(sum.lastPaymentDate) : 'None in this period') +
        card('credit', 'Returns &amp; credits', M.fmt(sum.returns + sum.adjustmentsCr)) +
        card(sum.closing > 0 ? 'due' : 'credit', 'Current balance', M.fmt(sum.closing),
          sum.closing > 0 ? 'Owed by the shop' : sum.closing < 0 ? 'In credit' : 'Settled') +
        card('warn', 'Last transaction', sum.lastTransactionDate ? fmtDate(sum.lastTransactionDate) : '—') +
      '</div></div></div>' +
    '</div>' +

    '<div class="bar">' +
      '<div class="tsearch">' + I('search') +
        '<input placeholder="Invoice or receipt number, product, note…" data-khq value="' + esc(K.q) + '"></div>' +
      '<label class="fld">' + I('cal') + '<select data-khfil="preset">' + presets.map(function (x) {
        return '<option value="' + x[0] + '"' + (K.preset === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
      }).join('') + '</select></label>' +
      (K.preset === 'custom'
        ? '<label class="fld"><input type="date" data-khfil="from" value="' + esc(K.from) + '"></label>' +
          '<label class="fld"><input type="date" data-khfil="to" value="' + esc(K.to) + '"></label>' : '') +
      '<label class="fld">' + I('filter') + '<select data-khfil="type">' +
        '<option value="">All entries</option>' +
        typeOpts.map(function (t) {
          return '<option value="' + t + '"' + (K.types[0] === t ? ' selected' : '') + '>' +
            TYPE[t].label + '</option>';
        }).join('') + '</select></label>' +
      '<label class="fld">' + I('wallet') + '<select data-khfil="method"><option value="">Any method</option>' +
        ERP.ENUM.methods.map(function (m) {
          return '<option value="' + m + '"' + (K.method === m ? ' selected' : '') + '>' + m + '</option>';
        }).join('') + '</select></label>' +
      '<label class="fld">' + I('swap') + '<select data-khfil="order">' +
        '<option value="desc"' + (K.order === 'desc' ? ' selected' : '') + '>Newest first</option>' +
        '<option value="asc"' + (K.order === 'asc' ? ' selected' : '') + '>Oldest first</option>' +
      '</select></label>' +
      '<div class="grow"></div>' +
      '<button class="btn" data-khexport="print">' + I('print') + 'Print</button>' +
      '<button class="btn" data-khexport="pdf">PDF</button>' +
      '<button class="btn" data-khexport="word">Word</button>' +
      '<button class="btn" data-khexport="excel">' + I('sheet') + 'Excel</button>' +
    '</div>' +

    (slice.length
      ? '<div class="card"><div class="card-b" style="padding:0">' +
        '<div class="tw"><table class="kh-table"><thead><tr>' +
          '<th>Date</th><th>Type</th><th>Folio / Reference #</th>' +
          '<th>Description / تفصیل</th><th class="r">Qty</th>' +
          '<th class="r">Debit / بنام</th><th class="r">Credit / جمع</th>' +
          '<th class="r">Balance / بقایا</th><th></th>' +
        '</tr></thead><tbody>' + body + '</tbody>' +
        '<tfoot><tr><td colspan="5"><b>Totals for this view</b></td>' +
          '<td class="kh-dr">' + M.fmtPlain(sum.debit) + '</td>' +
          '<td class="kh-cr">' + M.fmtPlain(sum.credit) + '</td>' +
          '<td class="kh-bal">' + M.fmtPlain(sum.closing) + '</td><td></td></tr></tfoot>' +
        '</table></div></div></div>' +
        (pages > 1 ? '<div class="kh-pager">' +
          '<span>Page ' + K.page + ' of ' + pages + ' · ' + rows.length + ' entries</span>' +
          '<button class="btn sm" data-khpage="prev"' + (K.page === 1 ? ' disabled' : '') + '>Previous</button>' +
          '<button class="btn sm" data-khpage="next"' + (K.page === pages ? ' disabled' : '') + '>Next</button>' +
        '</div>' : '')
      : '<div class="empty"><div class="ei">' + I('doc') + '</div><b>No entries in this view</b>' +
        '<p>' + (K.q || K.types.length || K.method || K.preset !== 'all'
          ? 'Nothing matches these filters. Widen the period or clear the search.'
          : 'This shop has no transactions yet. Raise an invoice or record a payment to start the account.') +
        '</p><button class="btn pri" data-fcnew="sale">' + I('plus') + 'New invoice</button></div>');
};

if (global.PAGEMETA) {
  global.PAGEMETA.khata = ['Account statement',
    'The complete history of a shop — sales, payments, returns and adjustments, with the balance after each one.'];
}

/* a way in from the customer profile */
var origProfile = global.PAGES.customerProfile;
if (origProfile) {
  global.PAGES.customerProfile = function (id) {
    var html = origProfile(id);
    return '<div class="bar"><div class="grow"></div>' +
      '<button class="btn pri" data-khata="' + id + '">' + I('doc') + 'Account statement</button>' +
      '<button class="btn" data-khpay="' + id + '">' + I('wallet') + 'Receive payment</button>' +
      '<button class="btn" data-khrefund="' + id + '">' + I('wallet') + 'Pay this shop</button>' +
      '</div>' + html;
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   DOCUMENTS
   ══════════════════════════════════════════════════════════════════════════ */
function statementModel(customerId, f) {
  var c = global.custBy(customerId) || {};
  var sum = Khata.summary(customerId, f);
  var region = c.region && global.regionOf ? global.regionOf(c.region) : null;
  var p = period();
  var rows = sum.rows.slice();
  if (K.order === 'desc') rows = rows.slice().reverse();
  return {
    kind: 'STATEMENT', entityId: customerId, template: 'modern',
    title: 'ACCOUNT STATEMENT',
    number: 'STMT-' + (c.legacyCode || c.id),
    status: sum.closing > 0 ? 'Balance due' : sum.closing < 0 ? 'In credit' : 'Settled',
    date: fmtDate(today()), rawDate: today(),
    business: ERP.DocModel.business(),
    party: {
      label: 'ACCOUNT OF', shop: c.sh, owner: c.ow, code: c.legacyCode || c.id,
      contact: c.ph || '', whatsapp: c.wa || '', address: c.addr || c.area || '',
      region: region ? region.ur + ' — ' + region.en : '', id: customerId
    },
    metaLabel: 'STATEMENT DETAILS',
    meta: [
      ['Period', p.from || p.to ? (p.from ? fmtDate(p.from) : 'Beginning') + ' → ' + (p.to ? fmtDate(p.to) : 'Today') : 'All time'],
      ['Opening balance', M.fmt(sum.opening)],
      ['Closing balance', M.fmt(sum.closing), true],
      ['Entries', String(sum.count)],
      ['Generated', fmtDate(today()) + ' ' + new Date().toTimeString().slice(0, 5)],
      ['Generated by', global.CURRENT_USER || 'Owner']
    ],
    strip: [['Opening', M.fmt(sum.opening)], ['Sales', M.fmt(sum.sales)],
            ['Payments', M.fmt(sum.payments)], ['Balance', M.fmt(sum.closing)]],
    columns: [
      { key: 'sr', label: 'Date', width: 0.11 },
      { key: 'pack', label: 'Folio / Reference #', align: 'center', width: 0.14 },
      { key: 'description', label: 'Description / تفصیل', width: 0.30 },
      { key: 'brand', label: 'Qty', align: 'right', width: 0.09 },
      { key: 'qty', label: 'Debit / بنام', align: 'right', width: 0.11 },
      { key: 'rate', label: 'Credit / جمع', align: 'right', width: 0.11 },
      { key: 'amount', label: 'Balance / بقایا', align: 'right', width: 0.14 }
    ],
    rows: rows.map(function (e) {
      return {
        sr: e.date, brand: e.qtyLabel || '—', pack: e.ref || '—',
        description: e.description + (e.detail ? ' — ' + e.detail : ''), descriptionUr: '',
        qty: e.debit ? M.fmtPlain(e.debit) : '—',
        rate: e.credit ? M.fmtPlain(e.credit) : '—',
        amount: M.fmtPlain(e.balance)
      };
    }),
    itemsFooter: { description: 'Totals', qty: M.fmtPlain(sum.debit), rate: M.fmtPlain(sum.credit),
                   amount: M.fmtPlain(sum.closing) },
    totals: [
      { label: 'Opening balance', value: M.fmt(sum.opening) },
      { label: 'Total sales', value: M.fmt(sum.sales) },
      { label: 'Payments received', value: '− ' + M.fmt(sum.payments) },
      { label: 'Returns and credits', value: '− ' + M.fmt(sum.returns + sum.adjustmentsCr) },
      (sum.adjustmentsDr ? { label: 'Charges added', value: M.fmt(sum.adjustmentsDr) } : null),
      { label: 'Closing balance', labelUr: 'بقایا رقم', value: M.fmt(sum.closing), big: true, rule: true }
    ].filter(Boolean),
    words: global.words ? global.words(Math.round(M.toR(Math.abs(sum.closing)))) : '',
    notes: sum.lastPaymentDate
      ? 'Last payment of ' + M.fmt(sum.lastPaymentAmount) + ' received on ' + fmtDate(sum.lastPaymentDate) + '.'
      : 'No payment has been received in this period.',
    ledger: [],
    signatures: ['Prepared by', 'Authorised signature', 'Received by (shopkeeper)'],
    footer: {
      thanks: 'Please confirm the closing balance at your earliest convenience.',
      terms: 'Generated from the recorded transactions of ' + ERP.Settings.get().businessName + '.',
      bank: ERP.Settings.get().bankDetails || ''
    },
    actions: { whatsapp: true, sms: true, email: true },
    summary: sum
  };
}
ERP.statementModel = statementModel;

/* the old statement panel now opens this richer document */
ERP.DocModel.statement = (function (orig) {
  return function (partyId, type, fromISO, toISO) {
    if (type === 'SUPPLIER') return orig.call(ERP.DocModel, partyId, type, fromISO, toISO);
    return statementModel(partyId, { from: fromISO || null, to: toISO || null, types: [], method: '', q: '' });
  };
})(ERP.DocModel.statement);

function exportExcel(customerId) {
  var c = global.custBy(customerId) || {};
  var f = filters(), p = period();
  var sum = Khata.summary(customerId, f);
  var b = ERP.Settings.get();
  var head = [
    [{ v: b.businessName, style: 3 }], [b.tagline || ''], ['Customer account statement'],
    ['Shop', c.sh || ''], ['Owner', c.ow || ''], ['Customer ID', c.legacyCode || c.id],
    ['Phone', c.ph || ''],
    ['Period', (p.from ? fmtDate(p.from) : 'Beginning') + ' → ' + (p.to ? fmtDate(p.to) : 'Today')],
    ['Generated', fmtDate(today()) + ' ' + new Date().toTimeString().slice(0, 5)],
    ['Generated by', global.CURRENT_USER || 'Owner'], []
  ];
  var ledger = head.concat([['Date', 'Type', 'Folio / Reference #', 'Description / تفصیل', 'Qty',
                             'Debit / بنام', 'Credit / جمع', 'Balance / بقایا']])
    .concat(sum.rows.map(function (e) {
      return [e.date, (TYPE[e.type] || {}).label || e.type, e.ref || '',
              e.description + (e.detail ? ' — ' + e.detail : ''), e.qtyLabel || '—',
              M.toR(e.debit), M.toR(e.credit), M.toR(e.balance)];
    }))
    .concat([[], ['', '', '', 'Totals', '', M.toR(sum.debit), M.toR(sum.credit), M.toR(sum.closing)]]);
  var summary = head.concat([
    ['Opening balance', M.toR(sum.opening)],
    ['Total sales', M.toR(sum.sales)],
    ['Payments received', M.toR(sum.payments)],
    ['Returns and credits', M.toR(sum.returns + sum.adjustmentsCr)],
    ['Charges added', M.toR(sum.adjustmentsDr)],
    ['Closing balance', M.toR(sum.closing)],
    ['Last transaction', sum.lastTransactionDate ? fmtDate(sum.lastTransactionDate) : ''],
    ['Last payment', sum.lastPaymentDate ? fmtDate(sum.lastPaymentDate) : '']
  ]);
  var bytes = ERP.XLSX.build([{ name: 'Statement', rows: ledger }, { name: 'Summary', rows: summary }],
    { title: 'Account statement — ' + (c.sh || ''), author: b.businessName });
  var name = 'statement-' + String(c.sh || c.id).replace(/[^\w]+/g, '-').toLowerCase() + '-' + today() + '.xlsx';
  var blob = new global.Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  var a = D.createElement('a');
  a.href = global.URL.createObjectURL(blob); a.download = name;
  D.body.appendChild(a); a.click();
  setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 1200);
  ERP.Audit.detached({ action: 'Statement exported to Excel', entity: 'Customer', entityId: customerId });
  return name;
}
ERP.exportStatementExcel = exportExcel;

/* ══════════════════════════════════════════════════════════════════════════
   PANEL — posting an adjustment
   ══════════════════════════════════════════════════════════════════════════ */
var ADJ_FOR = null;
global.PANELS.adjustment = {
  t: 'Account adjustment', s: 'Correct a shop account, on the record', cta: 'Post adjustment',
  f: function () {
    var custs = (global.CUSTOMERS || []);
    var pre = ADJ_FOR || K.customerId || (custs[0] || {}).id;
    return '<div class="banner info">' + I('alert') + '<div><p>An adjustment is posted as its own entry ' +
      'with your name and the reason against it. Balances are never quietly rewritten.</p></div></div>' +
      '<label class="f"><span>Shop</span><select data-f="cust">' +
        custs.map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === pre ? ' selected' : '') + '>' + esc(c.sh) + '</option>';
        }).join('') + '</select></label>' +
      '<div class="f2">' +
        '<label class="f"><span>Effect</span><select data-f="direction">' +
          '<option value="DEBIT">Increase what the shop owes (debit)</option>' +
          '<option value="CREDIT">Reduce what the shop owes (credit)</option></select></label>' +
        '<label class="f"><span>Amount</span><input data-f="amount" inputmode="decimal" placeholder="0"></label>' +
      '</div>' +
      '<div class="f2">' +
        '<label class="f"><span>Date</span><input type="date" data-f="date" value="' + today() + '"></label>' +
        '<label class="f"><span>Reason</span><select data-f="reason">' +
          Adjustments.reasons.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') +
        '</select></label>' +
      '</div>' +
      '<label class="f fc-desc"><span>Description / تفصیل</span>' +
        '<input data-f="description" maxlength="500" ' +
        'placeholder="Appears on the statement \u2014 English or Urdu"></label>' +
      '<label class="f"><span>Internal note</span><input data-f="notes" placeholder="Optional"></label>';
  },
  save: function (v) {
    ERP.Adjustments.create({
      customerId: v.cust, direction: v.direction, amount: v.amount,
      date: v.date, reason: v.reason, notes: v.notes, description: v.description
    }).then(function (r) {
      global.paint();
      say('Adjustment ' + r.adjustmentNumber + ' posted.');
    }).catch(function (e) {
      say(e && e.validation ? e.validation[0] : 'The adjustment could not be posted.');
    });
    return { msg: 'Posting adjustment…' };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   WIRING
   ══════════════════════════════════════════════════════════════════════════ */
D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var go = e.target.closest('[data-khata]');
  if (go) {
    e.preventDefault();
    K.customerId = go.dataset.khata; K.page = 1;
    global.go('khata', K.customerId);
    return;
  }
  var pay = e.target.closest('[data-khpay]');
  if (pay) {
    e.preventDefault();
    if (ERP.setPayFor) ERP.setPayFor(pay.dataset.khpay);
    global.openPanel('payment');
    return;
  }
  var refund = e.target.closest('[data-khrefund]');
  if (refund) {
    e.preventDefault();
    if (ERP.setRefundFor) ERP.setRefundFor(refund.dataset.khrefund);
    global.openPanel('refund');
    return;
  }
  var adj = e.target.closest('[data-khadjust]');
  if (adj) { e.preventDefault(); ADJ_FOR = adj.dataset.khadjust; global.openPanel('adjustment'); return; }

  var open = e.target.closest('[data-khopen]');
  if (open) {
    e.preventDefault();
    var kind = open.dataset.khopen, id = open.dataset.id;
    if (kind === 'invoice') ERP.Viewer.open(ERP.DocModel.invoice(id));
    else if (kind === 'payment') ERP.Viewer.open(ERP.DocModel.receipt(id));
    else if (kind === 'custreturn') ERP.Viewer.open(ERP.DocModel.customerReturn(id));
    return;
  }
  var rev = e.target.closest('[data-khreverse]');
  if (rev) {
    e.preventDefault();
    var why = global.prompt('Why is this adjustment being reversed?');
    if (why === null) return;
    ERP.Adjustments.reverse(rev.dataset.khreverse, why || 'No reason given')
      .then(function () { global.paint(); say('Adjustment reversed.'); });
    return;
  }
  var pg = e.target.closest('[data-khpage]');
  if (pg) {
    e.preventDefault();
    K.page += pg.dataset.khpage === 'next' ? 1 : -1;
    if (K.page < 1) K.page = 1;
    global.paint();
    return;
  }
  var ex = e.target.closest('[data-khexport]');
  if (ex) {
    e.preventDefault();
    var what = ex.dataset.khexport;
    if (what === 'excel') { say('Excel file downloaded — ' + exportExcel(K.customerId)); return; }
    var m = statementModel(K.customerId, filters());
    ERP.Viewer.open(m);
    if (what === 'word') { setTimeout(function () { ERP.Viewer.word(); }, 120); }
    else if (what === 'print' || what === 'pdf') {
      setTimeout(function () { ERP.Viewer.print(what === 'pdf'); }, 160);
    }
    return;
  }
}, true);

D.addEventListener('input', function (e) {
  if (e.target.dataset && e.target.dataset.khq !== undefined) {
    K.q = e.target.value; K.page = 1;
    clearTimeout(K._t);
    K._t = setTimeout(function () {
      if (global.cur !== 'khata') return;
      var el = D.querySelector('[data-khq]'), pos = el && el.selectionStart;
      global.paint();
      var back = D.querySelector('[data-khq]');
      if (back) { back.focus(); try { back.setSelectionRange(pos, pos); } catch (err) {} }
    }, 180);
  }
});
D.addEventListener('change', function (e) {
  var el = e.target;
  if (!el.dataset || el.dataset.khfil === undefined) return;
  var k = el.dataset.khfil;
  if (k === 'type') K.types = el.value ? [el.value] : [];
  else if (k === 'preset') { K.preset = el.value; }
  else K[k] = el.value;
  K.page = 1;
  global.paint();
});

/* adjustments load with everything else. The promise is exposed so callers —
   and tests — can wait for the account to be complete rather than guessing at
   a delay; the khata repaints itself either way once the rows land. */
ERP.adjustmentsReady = (ERP.bootPromise || Promise.resolve()).then(function () {
  return FDB.hydrate().then(function (d) {
    S.accountAdjustments = (d.accountAdjustments || [])
      .sort(function (a, b) { return a.adjustmentDate < b.adjustmentDate ? 1 : -1; });
    ERP.Mirror.refresh();
  });
}).catch(function () { S.accountAdjustments = S.accountAdjustments || []; });
})(typeof window !== 'undefined' ? window : globalThis);
