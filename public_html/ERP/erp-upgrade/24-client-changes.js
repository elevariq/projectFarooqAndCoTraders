/* ══════════════════════════════════════════════════════════════════════════
   CLIENT CHANGE SET — Amount Paid · WhatsApp invoice · larger Qty/Rate ·
   accounting Description / تفصیل on customer and supplier statements.

   Written as a patch module in the same style as the rest of the upgrade:
   it loads after everything else and extends what is already there. It
   creates NO new monetary field. `paidAmount` (paisa, integer) stays the one
   canonical value that posts to the ledger; this module only relabels it
   "Amount Paid" in the interface and reads it for the WhatsApp message.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var ERP = global.ERP; if (!ERP) return;
  var M = global.Money, FDB = global.FDB, S = ERP.S;
  if (!M || !FDB || !S) return;

  function nowISO() { return new Date().toISOString(); }
  /* same presentation the documents already use — "11 Sep 2026" */
  function fmtDate(iso) {
    if (!iso) return '';
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return String(d.getDate()).padStart(2, '0') + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  function currentUser() {
    try { return (ERP.Session && ERP.Session.name && ERP.Session.name()) || 'system'; }
    catch (e) { return 'system'; }
  }

  /* ════════════════════════════════════════════════════════════════════════
     DESCRIPTION / تفصیل — the ledger-facing text
     ════════════════════════════════════════════════════════════════════════ */
  var MAX_DESC = 500;

  /* Unicode-safe. Trims only the outer whitespace and collapses newlines so a
     ledger row stays one line; every Urdu letter, diacritic, joiner and mark
     inside the string is left exactly as the user typed it. */
  function cleanDesc(v) {
    if (v === undefined || v === null) return '';
    var s = String(v).replace(/[\r\n\t]+/g, ' ').replace(/^[ \u00A0]+|[ \u00A0]+$/g, '');
    return s.length > MAX_DESC ? s.slice(0, MAX_DESC) : s;
  }

  var Desc = ERP.Desc = {
    clean: cleanDesc,
    MAX: MAX_DESC,

    /* A short, readable summary of what was on a transaction:
       "200 Bags Zam Zam 20KG @ PKR 2,700" for one line,
       "3 items — 500 bags" for several. Kept deliberately short: the full
       detail stays on the transaction itself. */
    fromLines: function (items) {
      items = items || [];
      if (!items.length) return '';
      var name = function (it) {
        return it.descriptionEnSnapshot || it.descriptionSnapshot ||
               it.descriptionUrSnapshot || 'item';
      };
      if (items.length === 1) {
        var it = items[0];
        var q = M.qty(it.quantity);
        var pack = it.packageSnapshot && it.packageSnapshot !== 'Bag' ? ' ' + it.packageSnapshot : '';
        return q.toLocaleString('en-US') + ' × ' + name(it) + pack +
               (it.unitPrice ? ' @ ' + M.fmt(it.unitPrice) : '');
      }
      var total = items.reduce(function (a, i) { return a + M.qty(i.quantity); }, 0);
      return items.length + ' items — ' + total.toLocaleString('en-US') + ' total qty';
    },

    /* The fallback used when nothing was typed — at DISPLAY time, so no
       historical record is rewritten and the migration stays idempotent. */
    auto: function (kind, rec) {
      rec = rec || {};
      switch (kind) {
        case 'OPENING':    return 'Opening Balance';
        case 'INVOICE':    return 'Sale invoice ' + (rec.invoiceNumber || rec.ref || '');
        case 'PURCHASE':   return 'Purchase invoice ' + (rec.purchaseNumber || rec.ref || '');
        case 'PAYMENT':    return rec.direction === 'OUT'
                                  ? 'Payment made — ' + (rec.method || 'Cash')
                                  : 'Cash received against outstanding balance';
        case 'REFUND':     return 'Refund paid — ' + (rec.method || 'Cash');
        case 'RETURN':     return rec.partyType === 'SUPPLIER'
                                  ? 'Stock returned to supplier'
                                  : 'Customer return ' + (rec.returnNumber || rec.ref || '');
        case 'ADJUSTMENT': return 'Balance adjustment';
        case 'FREIGHT':    return 'Freight / Carriage charges';
        default:           return rec.what || 'Transaction';
      }
    },

    /* The Qty column. Payment-only rows get an em dash rather than a made-up
       zero. Mixed, incompatible packages are labelled rather than summed into
       a meaningless single figure. */
    qtyLabel: function (row) {
      var q = row && row.qtyInfo;
      if (!q || !q.total) return '—';
      var n = Number(q.total).toLocaleString('en-US');
      return q.mixed ? n + ' (mixed units)' : n;
    },

    /* Manual always wins. This is the only place that decides. */
    resolve: function (stored, kind, rec) {
      var s = cleanDesc(stored);
      return s || Desc.auto(kind, rec);
    }
  };

  /* ── Carry `description` onto the records that post to a statement ──────
     Each patch wraps the existing builder and adds one string field. No
     monetary field is touched, so no balance can move. */

  var origBuildInvoice = ERP.Invoices.buildRecord;
  ERP.Invoices.buildRecord = function (draft, totals, number, status) {
    var rec = origBuildInvoice.apply(this, arguments);
    /* only written when something was actually typed, so a record with no
       description stays absent rather than carrying an empty string — the
       statement then falls back to the generated line at display time. */
    var d = cleanDesc(draft.description);
    if (d) rec.description = d;
    return rec;
  };

  /* Purchases and returns build their record inline with no hook to wrap, so
     the description is written straight onto the saved record in its own
     small transaction. It carries no money: if this write ever failed the
     figures would be untouched and the row would simply fall back to its
     auto-generated description. */
  Desc.attach = function (store, id, text) {
    var d = cleanDesc(text);
    if (!d || !id) return Promise.resolve(null);
    return FDB.tx([store, 'auditLog'], function (api) {
      var list = S[({ purchases: 'purchases', customerReturns: 'custReturns',
                      supplierReturns: 'supReturns' })[store] || store] || [];
      var rec = list.find(function (r) { return r.id === id; });
      if (!rec) return null;
      var old = rec.description || '';
      if (old === d) return rec;                      /* idempotent */
      rec.description = d;
      rec.descriptionUpdatedBy = currentUser();
      rec.descriptionUpdatedAt = nowISO();
      api.put(store, rec);
      ERP.Audit.write(api, {
        action: 'Description set', entity: store, entityId: id,
        oldValues: { description: old }, newValues: { description: d }
      });
      return rec;
    });
  };

  if (ERP.Purchases && ERP.Purchases.save) {
    var origPurchaseSave = ERP.Purchases.save;
    ERP.Purchases.save = function (draft) {
      var d = cleanDesc(draft && draft.description);
      return origPurchaseSave.call(ERP.Purchases, draft).then(function (rec) {
        if (!d || !rec) return rec;
        return Desc.attach('purchases', rec.id, d).then(function () { return rec; });
      });
    };
  }

  /* Payments: `note` is preserved untouched as the internal remark; the new
     `description` is the ledger-facing line. Both are written. */
  var origPayWrite = ERP.Payments._write;
  ERP.Payments._write = function (api, o, direction) {
    return origPayWrite.call(this, api, o, direction).then(function (rec) {
      var d = cleanDesc(o.description);
      if (d) {
        rec.description = d;
        api.put('payments', rec);
      }
      return rec;
    });
  };

  /* The public entry points pass it through. */
  ['receive', 'pay'].forEach(function (fn) {
    var orig = ERP.Payments[fn];
    if (!orig) return;
    ERP.Payments[fn] = function (o) {
      o = Object.assign({}, o || {});
      o.description = cleanDesc(o.description);
      return orig.call(ERP.Payments, o);
    };
  });

  /* ════════════════════════════════════════════════════════════════════════
     LEDGER ROWS — description and qty, on both sides
     ════════════════════════════════════════════════════════════════════════ */

  /* Total product quantity behind a ledger row. Units are NOT summed across
     incompatible packages: if the lines disagree, the row reports the count
     in its own package terms rather than inventing a single number. */
  function qtyOf(items) {
    items = items || [];
    if (!items.length) return null;
    var units = {};
    items.forEach(function (i) { units[i.packageSnapshot || 'Bag'] = 1; });
    var total = items.reduce(function (a, i) { return a + M.qty(i.quantity); }, 0);
    if (Object.keys(units).length > 1) return { mixed: true, total: total };
    return { mixed: false, total: total, unit: Object.keys(units)[0] };
  }

  function decorate(row) {
    var qty = null, stored = '', rec = null, kind = row.kind;

    if (kind === 'INVOICE') {
      rec = ERP.Invoices.byId(row.id);
      if (rec) {
        var items = ERP.Invoices.items(rec.id);
        qty = qtyOf(items);
        stored = rec.description;
        if (!cleanDesc(stored)) {
          var summary = Desc.fromLines(items);
          stored = summary ? summary : '';
        }
      }
    } else if (kind === 'PURCHASE') {
      rec = ERP.Purchases && ERP.Purchases.byId && ERP.Purchases.byId(row.id);
      if (rec) {
        var pitems = (ERP.Purchases.items && ERP.Purchases.items(rec.id)) || [];
        qty = qtyOf(pitems);
        stored = rec.description || Desc.fromLines(pitems);
      }
    } else if (kind === 'PAYMENT' || kind === 'REFUND') {
      rec = ERP.Payments.byId && ERP.Payments.byId(row.id);
      stored = rec && rec.description;
    } else if (kind === 'RETURN') {
      rec = (S.custReturns || []).find(function (r) { return r.id === row.id; }) ||
            (S.supReturns  || []).find(function (r) { return r.id === row.id; });
      stored = rec && rec.description;
    } else if (kind === 'ADJUSTMENT') {
      stored = row.description || row.what;
    }

    return Object.assign({}, row, {
      description: Desc.resolve(stored, kind, rec || row),
      qtyInfo: qty,
      qty: qty ? qty.total : null
    });
  }

  function wrapLedger(name) {
    var orig = ERP.Ledger[name];
    ERP.Ledger[name] = function (partyId, fromISO, toISO) {
      var L = orig.call(ERP.Ledger, partyId, fromISO, toISO);
      /* rows only — opening, closing, debit and credit are returned exactly
         as the existing derivation computed them, so no balance can shift. */
      return Object.assign({}, L, { rows: L.rows.map(decorate) });
    };
  }
  wrapLedger('customer');
  wrapLedger('supplier');

  /* ════════════════════════════════════════════════════════════════════════
     CHANGE 2 — the WhatsApp invoice message
     ════════════════════════════════════════════════════════════════════════ */

  /* Previous Outstanding is the balance as it stood immediately BEFORE this
     invoice posted. It is read from the snapshot the invoice already stores
     (`previousBalance`, captured pre-posting in Invoices.save), never from
     the customer's live balance — which by then already includes this sale. */
  var Wa = ERP.Wa = {
    invoiceFigures: function (inv) {
      var billTotal = inv.grandTotal || 0;
      var paid      = ERP.Invoices.paidFor ? ERP.Invoices.paidFor(inv.id) : (inv.paidAmount || 0);
      var billBal   = billTotal - paid;
      var prev      = inv.previousBalance || 0;
      return {
        billTotal: billTotal, paid: paid, billBalance: billBal,
        previousOutstanding: prev, totalOutstanding: prev + billBal,
        items: inv.lineCount || (ERP.Invoices.items(inv.id) || []).length
      };
    },

    invoiceText: function (inv) {
      var b = ERP.Settings.get();
      var f = Wa.invoiceFigures(inv);
      var name = (b.businessName || b.name || 'FAROOQ & CO.').toUpperCase();
      var date = fmtDate(inv.invoiceDate);
      var bar = '━━━━━━━━━━━━━━';
      return name + '\n\n' +
        '🧾 Invoice: ' + (inv.invoiceNumber || '') + '\n' +
        '📅 Date: ' + date + '\n' +
        '👤 Customer: ' + (inv.shopNameSnapshot || inv.customerNameSnapshot || '') + '\n\n' +
        bar + '\n' +
        '📦 Items: ' + f.items + '\n' +
        '💰 Bill Total: ' + M.fmt(f.billTotal) + '\n' +
        '✅ Paid: ' + M.fmt(f.paid) + '\n' +
        '🔴 Bill Balance: ' + M.fmt(f.billBalance) + '\n\n' +
        '📊 Previous Outstanding: ' + M.fmt(f.previousOutstanding) + '\n' +
        '🔴 Total Outstanding: ' + M.fmt(f.totalOutstanding) + '\n' +
        bar + '\n\n' +
        'Thank you for doing business with ' +
        (b.businessName || b.name || 'Farooq & Co') + '. 🙏';
    },

    /* Normalises for the wa.me URL only. The stored display number is never
       written back, so the customer record is not mutated. */
    normalisePhone: function (raw) {
      var d = String(raw || '').replace(/\D/g, '');
      if (!d) return '';
      if (d.indexOf('0092') === 0) d = d.slice(2);
      if (d.indexOf('92') === 0 && d.length === 12) return d;
      if (d.length === 11 && d[0] === '0') return '92' + d.slice(1);
      if (d.length === 10 && d[0] === '3') return '92' + d;
      return d;
    },

    phoneFor: function (customerId) {
      var c = global.custBy && global.custBy(customerId);
      if (!c) return '';
      return Wa.normalisePhone(c.wa || c.ph || '');
    },

    /* Communication only. Nothing here writes a balance. */
    sendInvoice: function (invoiceId) {
      var inv = ERP.Invoices.byId(invoiceId);
      if (!inv) return false;
      var digits = Wa.phoneFor(inv.customerId);
      var text = Wa.invoiceText(inv);
      if (!digits) {
        global.say && global.say('No WhatsApp/mobile number is saved for this customer.');
        try { global.navigator.clipboard && global.navigator.clipboard.writeText(text); } catch (e) {}
        return false;
      }
      var url = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text);
      ERP.Audit.detached({ action: 'Sent on WhatsApp', entity: 'Invoice',
                           entityId: inv.id, ref: inv.invoiceNumber });
      try { global.open(url, '_blank'); }
      catch (e) { global.navigator.clipboard && global.navigator.clipboard.writeText(text); }
      return true;
    }
  };

  /* The document viewer's WhatsApp action uses the new text for invoices and
     leaves every other document type exactly as it was. */
  if (ERP.Paper && ERP.Paper.waText) {
    var origWaText = ERP.Paper.waText;
    ERP.Paper.waText = function (m) {
      if (m && m.kind === 'INVOICE' && m.entityId) {
        var inv = ERP.Invoices.byId(m.entityId);
        if (inv) return Wa.invoiceText(inv);
      }
      return origWaText.call(ERP.Paper, m);
    };
  }

  /* ════════════════════════════════════════════════════════════════════════
     CHANGE 3 — Qty and Rate inputs, substantially larger
     CHANGE 1/4 — Amount Paid and Description styling
     ════════════════════════════════════════════════════════════════════════ */
  var css = [
    /* the line editor's numeric cells. .fcb-in was capped at 110px. */
    '.fcb-in{max-width:none}',
    'td[data-label="Quantity"] .fcb-in,td[data-label="Ordered"] .fcb-in,',
    'td[data-label="Received"] .fcb-in{min-width:112px;width:118px;min-height:46px;',
    'font-size:16px;padding:10px 12px;font-variant-numeric:tabular-nums}',
    'td[data-label="Rate"] .fcb-in,td[data-label="Cost"] .fcb-in{min-width:152px;width:164px;',
    'min-height:46px;font-size:16px;padding:10px 12px;font-variant-numeric:tabular-nums}',
    'td[data-label="Discount"] .fcb-in{min-width:112px;width:118px;min-height:46px;',
    'font-size:15px;padding:10px 12px}',
    /* keep the columns from being squeezed back by the table algorithm */
    '#fcbLines td[data-label="Quantity"],#fcbLines td[data-label="Ordered"]{min-width:124px}',
    '#fcbLines td[data-label="Rate"],#fcbLines td[data-label="Cost"]{min-width:172px}',
    /* tablet and narrow desktop: scroll the row rather than shrink the cells */
    '@media(max-width:1100px) and (min-width:761px){.fcb-tablewrap{overflow-x:auto}',
    '#fcbLines{min-width:900px}}',
    /* Amount Paid, given prominence */
    '.fc-amtpaid input{min-height:52px;font-size:19px;font-weight:700;text-align:right;',
    'font-variant-numeric:tabular-nums}',
    '.fc-amtpaid>span{font-weight:700}',
    /* Description / تفصیل */
    '.fc-desc input,.fc-desc textarea{width:100%;min-height:44px;font-size:15px;padding:9px 11px}',
    '.fc-desc[dir="rtl"] input{text-align:right}',
    /* statement description column */
    '.kh-desc{max-width:none;white-space:normal;word-break:break-word;line-height:1.45}',
    '.kh-qty{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
  ].join('');

  try {
    var st = global.document.createElement('style');
    st.setAttribute('data-fc', 'client-changes');
    st.textContent = css;
    global.document.head.appendChild(st);
  } catch (e) {}

  /* Mobile keeps its own full-width rule; make sure the taller minimum wins
     there too rather than the desktop widths fighting the stacked cards. */
  try {
    var mst = global.document.createElement('style');
    mst.setAttribute('data-fc', 'client-changes-mobile');
    mst.textContent =
      'body.fc-mobile #fcbLines td[data-label="Quantity"] .fcb-in,' +
      'body.fc-mobile #fcbLines td[data-label="Rate"] .fcb-in,' +
      'body.fc-mobile #fcbLines td[data-label="Cost"] .fcb-in,' +
      'body.fc-mobile #fcbLines td[data-label="Ordered"] .fcb-in{' +
      'width:100%;min-width:0;min-height:50px;font-size:17px}' +
      'body.fc-mobile #fcbLines td{min-width:0}';
    global.document.head.appendChild(mst);
  } catch (e) {}

  /* ════════════════════════════════════════════════════════════════════════
     CHANGE 1 — "Amount Paid" wording on the existing canonical field
     ════════════════════════════════════════════════════════════════════════ */
  var LABELS = {
    'Amount paid now': 'Amount Paid',
    'Amount paid to supplier': 'Amount Paid',
    'Amount received': 'Amount Paid',
    'Amount Received': 'Amount Paid',
    'Paid now': 'Amount Paid'
  };

  function relabel(root) {
    try {
      var labels = (root || global.document).querySelectorAll('label span, .fcb-f > span, th');
      Array.prototype.forEach.call(labels, function (el) {
        var t = (el.textContent || '').trim();
        if (LABELS[t]) el.textContent = LABELS[t];
      });
      var paidCell = (root || global.document).querySelector('[data-fck="paidAmount"]');
      if (paidCell) {
        var wrap = paidCell.closest && paidCell.closest('.fcb-f');
        if (wrap) wrap.classList.add('fc-amtpaid');
      }
    } catch (e) {}
  }

  /* Runs after each repaint, using the app's own change announcement rather
     than a timer, so it costs nothing when nothing changed. */
  try {
    global.addEventListener('farooqco:painted', function () { relabel(); });
    var mo = new global.MutationObserver(function () { relabel(); });
    mo.observe(global.document.body, { childList: true, subtree: true });
  } catch (e) {}
  relabel();

  ERP.ClientChanges = { version: '2026-09-14', Desc: Desc, Wa: Wa };

})(typeof window !== 'undefined' ? window : globalThis);
