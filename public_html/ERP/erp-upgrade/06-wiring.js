/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 6/6
   WIRING
   Panels for payments and returns, the business profile, backup/restore,
   the database status chip, styles, event handlers, and the patches that
   point the fourteen existing screens at the new database.
   (§9 §16 §28 §29 §33 §42 §43 §49 §54 §56)
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, FDB = global.FDB, B = ERP.Builder;
var D = global.document;
var esc = function (s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
var I = function (n) { return global.I ? global.I(n) : ''; };
var say = function (m) { return global.say ? global.say(m) : null; };
function todayISO() { return global.FC_TODAY ? global.FC_TODAY() : new Date().toISOString().slice(0, 10); }
function fmtDate(x) { return global.fmtDate ? global.fmtDate(x) : x; }

/* ══════════════════════════════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
/* ── invoice builder ── */
.fcb{padding-bottom:120px}
.fcb-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}
@media(max-width:1100px){.fcb-grid{grid-template-columns:1fr}.fcb-side{order:-1}}
.fcb-card{margin-bottom:14px}
.fcb-party{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;
  background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;margin-top:4px}
.fcb-party i{font-style:normal;display:block;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}
.fcb-party b{font-size:14px}
.fcb-party b.due{color:var(--clay)}
.fcb-picker{position:relative;margin-bottom:12px}
.fcb-search{display:flex;align-items:center;gap:8px;border:1.5px solid var(--line);border-radius:var(--r);
  padding:6px 8px 6px 12px;background:var(--surface)}
.fcb-search:focus-within{border-color:var(--violet);box-shadow:0 0 0 3px var(--violet-50)}
.fcb-search svg{color:var(--muted);flex:none}
.fcb-search input{flex:1;border:none;outline:none;background:none;font-size:15px;padding:6px 0}
.fcb-results{position:absolute;z-index:40;top:calc(100% + 6px);left:0;right:0;max-height:340px;overflow:auto;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-lg);padding:6px}
.fcb-res{display:block;width:100%;text-align:left;padding:9px 11px;border-radius:var(--r-sm);border:none;background:none}
.fcb-res:hover,.fcb-res:focus-visible{background:var(--violet-50)}
.fcb-res-n{font-weight:600}
.fcb-res-n .rn{color:var(--muted);font-weight:500;font-size:13px}
.fcb-res-m{font-size:12.5px;color:var(--muted)}
.fcb-res-s{font-size:12.5px;font-weight:600;margin-top:1px}
.fcb-res-s.ok{color:var(--green)} .fcb-res-s.bad{color:var(--clay)}
.fcb-none{padding:18px;text-align:center;color:var(--muted)}
.fcb-tw{overflow-x:auto}
table.fcb-table{width:100%;border-collapse:collapse;min-width:840px}
table.fcb-table th{font-size:11.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);
  text-align:left;padding:8px 8px;border-bottom:1px solid var(--line)}
table.fcb-table td{padding:8px;border-bottom:1px solid var(--line-2);vertical-align:middle}
table.fcb-table tr.over td{background:var(--clay-50)}
.fcb-pn{font-weight:600;line-height:1.35}
.fcb-pn .rn{color:var(--muted);font-weight:500;font-size:13px}
.fcb-ps{font-size:12px;color:var(--muted)}
.fcb-in{width:100%;max-width:110px;text-align:right;padding:7px 9px;border:1.5px solid var(--line);
  border-radius:var(--r-sm);background:var(--surface);font-size:15px}
.fcb-in:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 3px var(--violet-50)}
.fcb-mini{padding:5px 7px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);font-size:12.5px;max-width:150px}
.fcb-avail{font-size:11.5px;color:var(--muted);margin-top:2px}
.fcb-avail.bad{color:var(--clay);font-weight:600}
.fcb-chk{display:block;font-size:11.5px;color:var(--muted);margin-top:3px}
.fcb-chk input{margin-right:4px}
.fcb-fallback{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
.fcb-fallback select{flex:1;min-width:200px;padding:8px 10px;border:1.5px solid var(--line);
  border-radius:var(--r-sm);background:var(--surface);font-size:14px}
.fcb-acts{white-space:nowrap}
.fcb-acts .icon-btn{padding:4px 7px;border-radius:6px;font-size:13px;color:var(--muted)}
.fcb-acts .icon-btn:hover{background:var(--surface-2);color:var(--ink)}
.fcb-acts .icon-btn.danger:hover{background:var(--clay-50);color:var(--clay)}
.fcb-acts .icon-btn[disabled]{opacity:.3}
tr.fcb-empty td{padding:26px;text-align:center;color:var(--muted)}
.fcb-check{margin-top:10px;padding:9px 12px;background:var(--violet-50);border-radius:var(--r-sm);
  font-size:13.5px;color:var(--violet-ink);font-weight:600}
.fcb-sum>div,.fcb-stotals>div{display:flex;justify-content:space-between;align-items:baseline;
  padding:7px 0;border-bottom:1px solid var(--line-2)}
.fcb-sum>div:last-child,.fcb-stotals>div:last-child{border-bottom:none}
.fcb-sum i,.fcb-stotals i{font-style:normal;color:var(--muted);font-size:13px}
.fcb-sum b,.fcb-stotals b{font-variant-numeric:tabular-nums}
.fcb-sum .grand,.fcb-stotals .grand{border-top:1.5px solid var(--violet);margin-top:4px;padding-top:9px}
.fcb-sum .grand b{font-size:19px;font-weight:800}
.fcb-sticky{position:fixed;left:var(--rail);right:0;bottom:0;z-index:35;background:var(--surface);
  border-top:1px solid var(--line);box-shadow:0 -8px 24px rgba(18,17,26,.08);padding:10px 22px}
body.mini .fcb-sticky{left:68px}
@media(max-width:1200px){.fcb-sticky{left:68px}}
@media(max-width:760px){.fcb-sticky{left:0;padding:10px 12px}}
.fcb-sticky-in{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.fcb-stotals{display:flex;gap:18px;flex:1;flex-wrap:wrap}
.fcb-stotals>div{display:block;border-bottom:none;padding:0}
.fcb-stotals .grand{border-top:none;margin:0;padding:0}
.fcb-stotals .grand b{font-size:20px}
.fcb-btns{display:flex;gap:8px;margin-left:auto}
.btn.lg{padding:11px 18px;font-size:15px}
.fcb-errs ul{margin:6px 0 0 16px;padding:0}
.fcb-errs li{margin:2px 0}
table.fcb-list{width:100%;border-collapse:collapse;min-width:1050px}
table.fcb-list th{font-size:11.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);
  text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
table.fcb-list td{padding:9px 10px;border-bottom:1px solid var(--line-2);vertical-align:middle}
table.fcb-list .sub{font-size:12px;color:var(--muted)}
.fcb-rowacts{white-space:nowrap}
.fcb-rowacts .btn.sm{margin-right:3px}
.lnk{background:none;border:none;padding:0;font:inherit;color:var(--violet);font-weight:600;text-align:left}
.lnk:hover{text-decoration:underline}
/* ── document viewer ── */
#fcviewer{position:fixed;inset:0;z-index:120;background:rgba(12,10,20,.62);backdrop-filter:blur(3px);
  display:none;flex-direction:column}
#fcviewer.on{display:flex}
.fcv-bar{display:flex;align-items:center;gap:7px;padding:9px 14px;background:var(--surface);
  border-bottom:1px solid var(--line);flex-wrap:wrap}
.fcv-t{display:flex;align-items:center;gap:9px;font-size:14.5px}
.fcv-t .mono{font-family:var(--mono);font-size:12.5px;color:var(--muted)}
.fcv-sp{flex:1}
.fcv-btn{padding:7px 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);
  font-size:13.5px;font-weight:600}
.fcv-btn:hover{background:var(--surface-2)}
.fcv-btn.pri{background:var(--violet);border-color:var(--violet);color:#fff}
.fcv-z{font-size:12.5px;color:var(--muted);min-width:42px;text-align:center}
.fcv-pill{font-size:11.5px;padding:2px 9px;border-radius:99px;background:var(--surface-2);color:var(--muted);font-weight:600}
.fcv-pill.ok{background:var(--green-50);color:var(--green)}
.fcv-pill.bad{background:var(--clay-50);color:var(--clay)}
.fcv-scroll{flex:1;overflow:auto;padding:22px 12px 60px;display:flex;justify-content:center;align-items:flex-start}
.fcv-page{transform-origin:top center;box-shadow:0 20px 60px rgba(0,0,0,.35);background:#fff}
/* ── database status chip ── */
.fcdb{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:4px 10px;border-radius:99px;
  background:var(--green-50);color:var(--green);font-weight:600;cursor:pointer;border:none}
.fcdb.warn{background:var(--ochre-50);color:var(--ochre)}
.fcdb.bad{background:var(--clay-50);color:var(--clay)}
.fcdb .dot{width:7px;height:7px;border-radius:99px;background:currentColor}
.fcset-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.fcalloc{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line-2)}
.fcalloc b{flex:1;font-weight:600}
.fcalloc input{width:120px;text-align:right;padding:6px 8px;border:1.5px solid var(--line);border-radius:var(--r-sm)}
.fcret-row{display:grid;grid-template-columns:1fr 84px 170px 70px;gap:8px;align-items:center;padding:8px 0;
  border-bottom:1px solid var(--line-2)}
.fcret-row input,.fcret-row select{padding:6px 8px;border:1.5px solid var(--line);border-radius:var(--r-sm);background:var(--surface)}
@media(max-width:620px){.fcret-row{grid-template-columns:1fr}}
`;
(function injectCss() {
  var s = D.createElement('style');
  s.id = 'fc-upgrade-css';
  s.textContent = CSS + '\n' + (ERP.Paper ? ERP.Paper.css : '');
  D.head.appendChild(s);
})();

/* ══════════════════════════════════════════════════════════════════════════
   PANELS — payments, returns, statements
   ══════════════════════════════════════════════════════════════════════════ */
var PAY_FOR = null, RETURN_FOR = null, SUPRET_FOR = null, STMT_FOR = null;
ERP.setPayFor = function (id) { PAY_FOR = id; };

/* Area filter for the "Receive payment" shop picker — same idea as the Area
   filter already on the invoice builder (§ regionFilter in 05-ui-builder.js):
   picking an Area narrows the Shop list to just that area's customers. */
var PAY_AREA = '';
function payAreaOptions() {
  /* the region a pre-filled shop belongs to must stay selectable even if it
     has since been switched off — otherwise the dropdown silently falls back
     to "All areas" while the Shop list still shows just that one shop, which
     is a confusing mismatch on a money screen */
  var regions = (global.REGIONS || []).filter(function (r) { return r.active !== false || r.id === PAY_AREA; });
  return '<option value=""' + (!PAY_AREA ? ' selected' : '') + '>All areas</option>' +
    regions.map(function (r) {
      return '<option value="' + esc(r.id) + '"' + (PAY_AREA === r.id ? ' selected' : '') + '>' +
        esc(r.en) + (r.ur ? ' — ' + esc(r.ur) : '') + (r.active === false ? ' (inactive)' : '') + '</option>';
    }).join('');
}
function payCustomersInArea() {
  return (global.CUSTOMERS || []).filter(function (c) {
    return !PAY_AREA || (c.region || '') === PAY_AREA;
  });
}
/* Shared between the initial render and the live Area-change handler so the
   two can never disagree. An area with genuinely no shops is shown as an
   explicit empty state — it must NOT silently fall back to every shop, or
   the Area dropdown and the Shop list would contradict each other. */
function payShopOptionsHtml(custs, preId) {
  if (!custs.length) return '<option value="" disabled selected>No shops in this area</option>';
  return custs.map(function (c) {
    return '<option value="' + c.id + '"' + (c.id === preId ? ' selected' : '') + '>' + esc(c.sh) + '</option>';
  }).join('');
}
function payBalanceHtml(custs, preId) {
  if (!custs.length) {
    return I('alert') + '<div><b>No shops in this area</b><p>Pick a different area, or choose "All areas".</p></div>';
  }
  var id = (preId && custs.some(function (c) { return c.id === preId; })) ? preId : custs[0].id;
  return I('wallet') + '<div><p>Outstanding balance: <b>' + M.fmt(ERP.Ledger.customerBalance(id)) + '</b></p></div>';
}

function openInvoicesForCustomer(cid) {
  return ERP.Invoices.all().filter(function (i) {
    return i.customerId === cid && i.status !== 'DRAFT' && i.status !== 'CANCELLED' &&
           ERP.Invoices.outstanding(i) > 0;
  }).sort(function (a, b) { return a.invoiceDate < b.invoiceDate ? -1 : 1; });
}

var PANELS = global.PANELS;

PANELS.payment = {
  t: 'Receive payment', s: 'Money received from a shop', cta: 'Record payment & print receipt',
  f: function () {
    var all = (global.CUSTOMERS || []);
    if (!all.length) return '<div class="banner warn">' + I('alert') + '<div><b>No shops on file</b><p>Add a shop first.</p></div></div>';
    var preCust = PAY_FOR ? global.custBy(PAY_FOR) : null;
    PAY_AREA = preCust ? (preCust.region || '') : '';
    var custs = payCustomersInArea();
    var pre = (PAY_FOR && custs.some(function (c) { return c.id === PAY_FOR; })) ? PAY_FOR : undefined;
    return '<label class="f"><span>Area</span><select data-f="area" id="fcPayArea">' + payAreaOptions() +
      '</select></label>' +
      '<label class="f"><span>Shop</span><select data-f="cust" id="fcPayCust"' + (custs.length ? '' : ' disabled') + '>' +
        payShopOptionsHtml(custs, pre) + '</select></label>' +
      '<div class="banner ' + (custs.length ? 'info' : 'warn') + '" id="fcPayBal">' + payBalanceHtml(custs, pre) + '</div>' +
      '<div class="f2 fc-amtpaid"><label class="f"><span>Amount Paid</span>' +
        '<input data-f="amt" inputmode="decimal" placeholder="e.g. 100000"></label>' +
        '<label class="f"><span>Method</span><select data-f="method">' +
          ERP.ENUM.methods.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="f2"><label class="f"><span>Date</span><input type="date" data-f="date" value="' + todayISO() + '"></label>' +
        '<label class="f"><span>Reference</span><input data-f="ref" class="mono" placeholder="Cheque / transaction no"></label></div>' +
      '<label class="f"><span>Apply to</span><select data-f="mode" id="fcPayMode">' +
        '<option value="auto">Oldest unpaid invoices first</option>' +
        '<option value="account">Leave on account</option>' +
        '<option value="pick">Choose invoices…</option></select></label>' +
      '<div id="fcPayList"></div>' +
      '<label class="f fc-desc"><span>Description / \u062a\u0641\u0635\u06cc\u0644</span>' +
        '<input data-f="desc" maxlength="500" ' +
        'placeholder="Appears on the statement \u2014 English or Urdu"></label>' +
      '<label class="f"><span>Internal note</span><input data-f="note" placeholder="Optional"></label>';
  },
  save: function (v) {
    var amount = String(v.amt || '').replace(/[^\d.]/g, '');
    if (!amount || Number(amount) <= 0) return 'Enter the amount received.';
    var allocations = [];
    if (v.mode === 'pick') {
      D.querySelectorAll('[data-fcalloc]').forEach(function (el) {
        var a = String(el.value || '').replace(/[^\d.]/g, '');
        if (a && Number(a) > 0) allocations.push({ invoiceId: el.dataset.fcalloc, amount: a });
      });
      var sum = allocations.reduce(function (x, a) { return x + Number(a.amount); }, 0);
      if (sum > Number(amount) + 0.001) return 'The amounts applied to invoices come to more than the payment.';
    } else if (v.mode === 'account') {
      allocations = [{ invoiceId: null, amount: 0 }];
    }
    ERP.Payments.receive({
      customerId: v.cust, amount: amount, method: v.method, reference: v.ref,
      date: v.date || todayISO(), note: v.note, description: v.desc,
      allocations: v.mode === 'pick' ? allocations : (v.mode === 'account' ? [] : null)
    }).then(function (p) {
      global.paint();
      say('Receipt ' + p.receiptNumber + ' recorded.');
      ERP.Notify.fire('PAYMENT_RECEIVED', { id: p.id, ref: p.receiptNumber });
      setTimeout(function () { ERP.Viewer.open(ERP.DocModel.receipt(p.id)); }, 220);
    }).catch(function (e) {
      say(e && e.validation ? e.validation[0] : 'The payment could not be saved. Nothing was changed.');
    });
    return { msg: 'Saving payment…' };
  }
};

PANELS.paysup = {
  t: 'Pay supplier', s: 'Money paid to a mill', cta: 'Record payment & print voucher',
  f: function () {
    var sups = (global.SUPPLIERS || []).filter(function (s) { return s.active !== false; });
    var pre = PAY_FOR || (sups[0] || {}).id;
    return '<label class="f"><span>Supplier</span><select data-f="sup">' +
        sups.map(function (s) {
          return '<option value="' + s.id + '"' + (s.id === pre ? ' selected' : '') + '>' + esc(s.co) + '</option>';
        }).join('') + '</select></label>' +
      '<div class="banner info">' + I('wallet') + '<div><p>Payable: <b>' +
        M.fmt(ERP.Ledger.supplierBalance(pre)) + '</b></p></div></div>' +
      '<div class="f2 fc-amtpaid"><label class="f"><span>Amount Paid</span><input data-f="amt" inputmode="decimal"></label>' +
        '<label class="f"><span>Method</span><select data-f="method">' +
          ERP.ENUM.methods.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="f2"><label class="f"><span>Date</span><input type="date" data-f="date" value="' + todayISO() + '"></label>' +
        '<label class="f"><span>Reference</span><input data-f="ref" class="mono" placeholder="Optional"></label></div>' +
      '<label class="f fc-desc"><span>Description / \u062a\u0641\u0635\u06cc\u0644</span>' +
        '<input data-f="desc" maxlength="500" ' +
        'placeholder="Appears on the statement \u2014 English or Urdu"></label>' +
      '<label class="f"><span>Internal note</span><input data-f="note" placeholder="Optional"></label>';
  },
  save: function (v) {
    var amount = String(v.amt || '').replace(/[^\d.]/g, '');
    if (!amount || Number(amount) <= 0) return 'Enter the amount paid.';
    ERP.Payments.pay({ supplierId: v.sup, amount: amount, method: v.method, reference: v.ref,
      date: v.date || todayISO(), note: v.note, description: v.desc })
      .then(function (p) {
        global.paint(); say('Voucher ' + p.receiptNumber + ' recorded.');
        setTimeout(function () { ERP.Viewer.open(ERP.DocModel.receipt(p.id)); }, 220);
      }).catch(function (e) { say(e && e.validation ? e.validation[0] : 'The payment could not be saved.'); });
    return { msg: 'Saving payment…' };
  }
};

PANELS.creditnote = {
  t: 'Customer return', s: 'Bags coming back from a shop — as many products as needed',
  cta: 'Post return & credit note',
  f: function () {
    var invs = ERP.Invoices.all().filter(function (i) {
      return i.status !== 'DRAFT' && i.status !== 'CANCELLED';
    }).sort(function (a, b) { return a.invoiceDate < b.invoiceDate ? 1 : -1; }).slice(0, 400);
    if (!invs.length) return '<div class="banner warn">' + I('alert') +
      '<div><b>No invoices yet</b><p>A return must reference the invoice the bags were sold on.</p></div></div>';
    var pre = RETURN_FOR && ERP.Invoices.byId(RETURN_FOR) ? RETURN_FOR : invs[0].id;
    return '<label class="f"><span>Original invoice</span><select data-f="invoice" id="fcRetInv">' +
        invs.map(function (i) {
          return '<option value="' + i.id + '"' + (i.id === pre ? ' selected' : '') + '>' +
            esc(i.invoiceNumber) + ' · ' + esc(i.shopNameSnapshot) + ' · ' + M.fmt(i.grandTotal) + '</option>';
        }).join('') + '</select></label>' +
      '<div class="f2">' +
        '<label class="f"><span>Return date</span><input type="date" data-f="date" value="' + todayISO() + '"></label>' +
        '<label class="f"><span>Warehouse receiving</span><select data-f="wid">' +
          (global.activeWh ? global.activeWh() : []).map(function (w) {
            return '<option value="' + w.id + '">' + esc(w.name) + '</option>'; }).join('') +
        '</select></label></div>' +
      '<div class="f2">' +
        '<label class="f"><span>Reason</span><select data-f="reason">' +
          (ERP.Options ? ERP.Options.list('returnReasons')
                       : ['Damaged product', 'Defective stock', 'Wrong product', 'Excess supplied',
                          'Unsold stock', 'Other approved return'])
            .map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="f"><span>What happens to the money</span><select data-f="treatment">' +
          '<option value="ADJUST_OUTSTANDING_BALANCE">Reduce what the shop owes</option>' +
          '<option value="CUSTOMER_CREDIT">Hold as customer credit</option>' +
          '<option value="REFUND">Refund the money</option>' +
          '<option value="REPLACEMENT">Replace the goods</option>' +
        '</select><span class="hint">A replacement issues the same bags again instead of crediting money.</span></label>' +
      '</div>' +
      '<div class="f"><span>Quantity and condition per line</span>' +
        '<div id="fcRetLines">' + retLines(pre) + '</div></div>' +
      '<label class="f fc-desc"><span>Description / تفصیل</span>' +
        '<input data-f="description" maxlength="500" ' +
        'placeholder="Appears on the statement \u2014 English or Urdu"></label>' +
      '<label class="f"><span>Internal note</span><input data-f="notes" placeholder="Optional"></label>';
  },
  save: function (v) {
    var items = [];
    D.querySelectorAll('[data-fcret]').forEach(function (el) {
      var q = String(el.value || '').replace(/[^\d.]/g, '');
      if (!q || Number(q) <= 0) return;
      var cond = D.querySelector('[data-fcretcond="' + el.dataset.fcret + '"]');
      items.push({ invoiceItemId: el.dataset.fcret, quantity: Number(q),
                   condition: cond ? cond.value : 'SELLABLE' });
    });
    if (!items.length) return 'Enter how many bags are coming back on at least one line.';
    ERP.Returns.fromCustomer({
      invoiceId: v.invoice, items: items, date: v.date, warehouseId: v.wid,
      reason: v.reason, treatment: v.treatment, notes: v.notes, description: v.description
    }).then(function (r) {
      global.paint();
      say('Return ' + r.returnNumber + ' posted — ' + r.lineCount +
          (r.lineCount === 1 ? ' line' : ' lines') + ', ' + r.totalQty + ' bags.');
      ERP.Notify.fire('RETURN_APPROVED', { id: r.id, ref: r.returnNumber });
      setTimeout(function () { ERP.Viewer.open(ERP.DocModel.customerReturn(r.id)); }, 220);
    }).catch(function (e) {
      say(e && e.validation ? e.validation[0] : 'The return could not be posted. Nothing was changed.');
    });
    return { msg: 'Posting return…' };
  }
};

function retLines(invoiceId) {
  var items = ERP.Invoices.items(invoiceId);
  if (!items.length) return '<p class="hint">That invoice has no lines.</p>';
  return items.map(function (it) {
    var left = ERP.Returns.returnableQty(it.id);
    var sold = it.quantity;
    return '<div class="fcret-row"><div><b>' +
      esc(it.descriptionEnSnapshot || it.descriptionSnapshot) + '</b>' +
      '<div class="hint">' + esc(it.packageSnapshot) + ' · sold ' + sold +
      (sold - left ? ' · already returned ' + (sold - left) : '') +
      ' · rate ' + M.fmtPlain(it.unitPrice) + '</div></div>' +
      '<input data-fcret="' + it.id + '" inputmode="decimal" placeholder="0"' +
        (left <= 0 ? ' disabled' : '') + '>' +
      '<select data-fcretcond="' + it.id + '"' + (left <= 0 ? ' disabled' : '') + '>' +
        ERP.ENUM.returnCondition.map(function (c) {
          return '<option value="' + c + '">' + esc(ERP.Returns.conditionLabel(c)) + '</option>';
        }).join('') + '</select>' +
      '<span class="hint">max ' + left + '</span></div>';
  }).join('');
}

PANELS.statement = {
  t: 'Customer account statement', s: 'Every invoice, payment and credit', cta: 'Generate statement',
  f: function () {
    var custs = (global.CUSTOMERS || []);
    var pre = STMT_FOR || (custs[0] || {}).id;
    return '<label class="f"><span>Shop</span><select data-f="cust">' +
        custs.map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === pre ? ' selected' : '') + '>' + esc(c.sh) + '</option>';
        }).join('') + '</select></label>' +
      '<label class="f"><span>Period</span><select data-f="period">' +
        '<option value="all">All time</option><option value="month">This month</option>' +
        '<option value="lastmonth">Last month</option><option value="year">This year</option></select></label>';
  },
  save: function (v) {
    var r = v.period === 'all' ? [null, null] : ERP.Reports.range(v.period);
    var m = ERP.DocModel.statement(v.cust, 'CUSTOMER', r[0], r[1]);
    setTimeout(function () { ERP.Viewer.open(m); }, 200);
    return { msg: 'Statement generated.' };
  }
};
PANELS.supstatement = {
  t: 'Supplier account statement', s: 'Purchases, payments and returns', cta: 'Generate statement',
  f: function () {
    var sups = (global.SUPPLIERS || []);
    var pre = STMT_FOR || (sups[0] || {}).id;
    return '<label class="f"><span>Supplier</span><select data-f="sup">' +
        sups.map(function (s) {
          return '<option value="' + s.id + '"' + (s.id === pre ? ' selected' : '') + '>' + esc(s.co) + '</option>';
        }).join('') + '</select></label>' +
      '<label class="f"><span>Period</span><select data-f="period">' +
        '<option value="all">All time</option><option value="month">This month</option>' +
        '<option value="lastmonth">Last month</option><option value="year">This year</option></select></label>';
  },
  save: function (v) {
    var r = v.period === 'all' ? [null, null] : ERP.Reports.range(v.period);
    setTimeout(function () { ERP.Viewer.open(ERP.DocModel.statement(v.sup, 'SUPPLIER', r[0], r[1])); }, 200);
    return { msg: 'Statement generated.' };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS: business profile, backup, restore, database status (§28 §29 §33)
   ══════════════════════════════════════════════════════════════════════════ */
var FIELDS = [
  ['businessName', 'Business name'], ['legalName', 'Legal name'], ['tagline', 'Positioning line'],
  ['taglineUr', 'Positioning line (Urdu)'], ['slogan', 'Slogan (Urdu)'], ['logoText', 'Logo text'],
  ['address', 'Address'], ['city', 'City'], ['phone', 'Mobile numbers'], ['shopPhone', 'Shop phone'],
  ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['website', 'Website'], ['ntn', 'NTN'],
  ['registrationNo', 'Registration number'], ['proprietor', 'Proprietor'],
  ['salesDocPrefix', 'Invoice document prefix (InvNo)'], ['invoicePrefix', 'Invoice prefix'], ['purchasePrefix', 'Purchase prefix'], ['receiptPrefix', 'Receipt prefix'],
  ['currencyLabel', 'Currency label'], ['defaultTaxRate', 'Default tax rate (%)'],
  ['invoiceFooter', 'Invoice footer'], ['terms', 'Default terms'], ['bankDetails', 'Bank details']
];

function settingsBlock() {
  var b = ERP.Settings.get(), st = FDB.status();
  var seq = Object.keys(ERP.S.sequences).map(function (k) {
    return k + ' → ' + ERP.S.sequences[k].n;
  }).join(' · ') || 'none issued yet';
  return '<div class="card"><div class="card-h"><h3>Business profile</h3>' +
      '<span class="pill neu">Shown on every invoice, receipt and message</span></div>' +
    '<div class="card-b"><div class="fcset-grid">' +
      FIELDS.map(function (f) {
        var long = /address|terms|bankDetails|invoiceFooter/.test(f[0]);
        return '<label class="f"' + (long ? ' style="grid-column:1/-1"' : '') + '><span>' + f[1] + '</span>' +
          (long ? '<textarea data-fcset="' + f[0] + '" rows="2">' + esc(b[f[0]] || '') + '</textarea>'
                : '<input data-fcset="' + f[0] + '" value="' + esc(b[f[0]] === undefined ? '' : b[f[0]]) + '">') +
          '</label>';
      }).join('') +
      '<label class="f"><span>Invoice layout</span><select data-fcset="invoiceTemplate">' +
        '<option value="classic"' + (b.invoiceTemplate !== 'modern' ? ' selected' : '') + '>Classic — as the shop\'s current invoice</option>' +
        '<option value="modern"' + (b.invoiceTemplate === 'modern' ? ' selected' : '') + '>Modern — itemised with brand and package columns</option>' +
      '</select></label>' +
      '<label class="f"><span>Tax enabled</span><select data-fcset="taxEnabled">' +
        '<option value="no"' + (b.taxEnabled ? '' : ' selected') + '>No</option>' +
        '<option value="yes"' + (b.taxEnabled ? ' selected' : '') + '>Yes</option></select></label>' +
      '<label class="f"><span>Allow selling below zero stock</span><select data-fcset="allowNegativeStock">' +
        '<option value="no"' + (b.allowNegativeStock ? '' : ' selected') + '>No — block overselling</option>' +
        '<option value="yes"' + (b.allowNegativeStock ? ' selected' : '') + '>Yes — allow negative stock</option></select></label>' +
      '<label class="f"><span>Logo image (optional)</span><input type="file" accept="image/*" data-fclogo></label>' +
    '</div>' +
    '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn pri" data-fcbact="savesettings">' + I('check') + 'Save business profile</button>' +
      (b.logoDataUrl ? '<button class="btn" data-fcbact="clearlogo">Remove logo</button>' : '') +
    '</div></div></div>' +

    '<div class="card"><div class="card-h"><h3>Database</h3>' +
      '<span class="fcdb ' + (st.healthy ? '' : st.driver === 'memory' ? 'bad' : 'warn') + '">' +
      '<span class="dot"></span>' + esc(st.label) + '</span></div>' +
    '<div class="card-b">' +
      '<p style="color:var(--muted);margin-top:0">' + esc(st.detail) + '</p>' +
      '<div class="fcset-grid">' +
        [['Invoices', ERP.S.invoices.length], ['Invoice lines', ERP.S.invoiceItems.length],
         ['Purchases', ERP.S.purchases.length], ['Purchase lines', ERP.S.purchaseItems.length],
         ['Payments', ERP.S.payments.length], ['Allocations', ERP.S.allocations.length],
         ['Customer returns', ERP.S.custReturns.length], ['Supplier returns', ERP.S.supReturns.length],
         ['Stock movements', ERP.S.movements.length], ['Inventory rows', Object.keys(ERP.S.inventory).length],
         ['Products', (global.PRODUCTS || []).length], ['Shops', (global.CUSTOMERS || []).length],
         ['Suppliers', (global.SUPPLIERS || []).length], ['Audit entries', ERP.S.audit.length]]
          .map(function (r) {
            return '<div class="kpi" style="border:1px solid var(--line);border-radius:var(--r);padding:10px 12px">' +
              '<div class="k">' + r[0] + '</div><div class="v" style="font-size:20px">' +
              Number(r[1]).toLocaleString('en-US') + '</div></div>';
          }).join('') +
      '</div>' +
      '<p class="hint" style="margin-top:10px">Number sequences: ' + esc(seq) + '</p>' +
      '<p class="hint">Lists available to the entry screens: ' +
        (ERP.sources ? ERP.sources.PRODS().length + ' products · ' + ERP.sources.CUSTS().length +
          ' shops · ' + ERP.sources.SUPS().length + ' suppliers · ' + ERP.sources.WHS().length +
          ' warehouses · ' + ERP.sources.REGS().length + ' regions' : 'not reported') +
        ((global.FC_BRIDGE_MISSING || []).length
          ? ' — <b>missing: ' + esc((global.FC_BRIDGE_MISSING || []).join(', ')) + '</b>' : '') + '</p>' +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn pri" data-fcbact="backup">' + I('down') + 'Backup Database</button>' +
        '<button class="btn" data-fcbact="exportbiz">Export Business Data (CSV pack)</button>' +
        '<label class="btn" style="cursor:pointer">Restore from backup…' +
          '<input type="file" accept="application/json" data-fcrestore style="display:none"></label>' +
      '</div>' +
      '<div class="banner warn" style="margin-top:10px">' + I('alert') +
        '<div><p>Restoring replaces records with the ones in the backup file. A backup of the current ' +
        'state is downloaded first, and if the file holds fewer records than this device does you are ' +
        'told exactly what would go before anything changes.</p></div></div>' +
    '</div></div>' +

    '<div class="card"><div class="card-h"><h3>Audit log</h3>' +
      '<span class="pill neu">' + ERP.S.audit.length + ' entries</span></div><div class="card-b">' +
      '<div class="tw"><table class="fcb-list"><thead><tr><th>When</th><th>User</th><th>Action</th>' +
        '<th>Reference</th><th>Detail</th></tr></thead><tbody>' +
        ERP.S.audit.slice(0, 60).map(function (a) {
          return '<tr><td class="mono">' + esc((a.createdAt || '').replace('T', ' ').slice(0, 16)) + '</td>' +
            '<td>' + esc(a.userId) + '</td><td>' + esc(a.action) + '</td>' +
            '<td class="mono">' + esc(a.ref || '—') + '</td>' +
            '<td class="sub">' + esc(a.reason || (a.newValues ? JSON.stringify(a.newValues).slice(0, 90) : '')) + '</td></tr>';
        }).join('') + '</tbody></table></div></div></div>';
}

/* Append the new blocks to the existing Settings page rather than replacing it */
var origSettings = global.PAGES.settings;
global.PAGES.settings = function () {
  return (origSettings ? origSettings() : '') + settingsBlock();
};

function doBackup(silent) {
  return FDB.exportAll().then(function (dump) {
    var blob = new global.Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
    var a = D.createElement('a');
    a.href = global.URL.createObjectURL(blob);
    a.download = 'farooq-co-erp-backup-' + todayISO() + '-' + Date.now().toString(36) + '.json';
    D.body.appendChild(a); a.click();
    setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    ERP.Audit.detached({ action: 'Database backup created', entity: 'System', entityId: 'backup' });
    if (!silent) say('Backup downloaded.');
    return dump;
  });
}

function exportBusinessCsv() {
  var files = [];
  function csv(rows) {
    return '\ufeff' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c === undefined || c === null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
  }
  var inv = [['Invoice', 'Date', 'Shop', 'Region', 'Warehouse', 'Bags', 'Grand total', 'Paid', 'Balance', 'Status']];
  ERP.Invoices.all().forEach(function (i) {
    inv.push([i.invoiceNumber, i.invoiceDate, i.shopNameSnapshot, i.regionSnapshot, i.warehouseSnapshot,
      i.totalQty, M.toR(i.grandTotal), M.toR(ERP.Invoices.paidFor(i.id)), M.toR(ERP.Invoices.outstanding(i)),
      ERP.STATUS_LABEL[i.status]]);
  });
  files.push(['invoices', csv(inv)]);
  var li = [['Invoice', 'Line', 'Product', 'Product (Urdu)', 'Brand', 'Package', 'Qty', 'Rate', 'Discount', 'Amount', 'Cost snapshot']];
  ERP.S.invoiceItems.forEach(function (it) {
    var i = ERP.Invoices.byId(it.invoiceId) || {};
    li.push([i.invoiceNumber, it.sortOrder + 1, it.descriptionEnSnapshot, it.descriptionSnapshot,
      it.brandSnapshot, it.packageSnapshot, it.quantity, M.toR(it.unitPrice), M.toR(it.discount),
      M.toR(it.lineTotal), M.toR(it.costSnapshot)]);
  });
  files.push(['invoice-lines', csv(li)]);
  var led = [['Shop', 'Region', 'Balance']];
  (global.CUSTOMERS || []).forEach(function (c) {
    led.push([c.sh, (global.regionTxt ? global.regionTxt(c.region) : ''), M.toR(ERP.Ledger.customerBalance(c.id))]);
  });
  files.push(['customer-balances', csv(led)]);
  files.forEach(function (f, ix) {
    setTimeout(function () {
      var blob = new global.Blob([f[1]], { type: 'text/csv;charset=utf-8' });
      var a = D.createElement('a');
      a.href = global.URL.createObjectURL(blob);
      a.download = 'farooq-co-' + f[0] + '-' + todayISO() + '.csv';
      D.body.appendChild(a); a.click();
      setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 1200);
    }, ix * 400);
  });
  ERP.Audit.detached({ action: 'Business data exported', entity: 'System', entityId: 'export' });
  say('Exporting ' + files.length + ' CSV files…');
}

/* ══════════════════════════════════════════════════════════════════════════
   EVENT WIRING
   ══════════════════════════════════════════════════════════════════════════ */
D.addEventListener('click', function (e) {
  var t = e.target, h = function (s) { return t.closest(s); };

  /* document viewer */
  var v = h('[data-fcv]');
  if (v) {
    var act = v.dataset.fcv;
    if (act === 'close') ERP.Viewer.close();
    else if (act === 'zoomin') ERP.Viewer.setZoom(1);
    else if (act === 'zoomout') ERP.Viewer.setZoom(-1);
    else if (act === 'print') ERP.Viewer.print(false);
    else if (act === 'pdf') ERP.Viewer.print(true);
    else if (act === 'word') ERP.Viewer.word();
    else if (act === 'wa') ERP.Viewer.whatsapp();
    else if (act === 'sms') ERP.Viewer.sms();
    else if (act === 'edit') { var m = ERP.Viewer.current; ERP.Viewer.close(); editInvoice(m.entityId); }
    else if (act === 'dup') { var m2 = ERP.Viewer.current; ERP.Viewer.close(); duplicateInvoice(m2.entityId); }
    else if (act === 'pay') { var m3 = ERP.Viewer.current; ERP.Viewer.close();
      PAY_FOR = (ERP.Invoices.byId(m3.entityId) || {}).customerId; global.openPanel('payment'); }
    else if (act === 'return') { var m4 = ERP.Viewer.current; ERP.Viewer.close();
      RETURN_FOR = m4.entityId; global.openPanel('creditnote'); }
    else if (act === 'cancel') { var m5 = ERP.Viewer.current; cancelInvoice(m5.entityId); }
    e.preventDefault(); return;
  }

  /* start any transaction type in the shared editor */
  var nb = h('[data-fcnew]');
  if (nb) { e.preventDefault(); B.start(nb.dataset.fcnew); return; }

  /* builder actions */
  var ba = h('[data-fcbact]');
  if (ba) {
    var a = ba.dataset.fcbact;
    e.preventDefault();
    if (a === 'new') { B.start('sale'); return; }
    if (a === 'newpurchase') { B.start('purchase'); return; }
    if (a === 'save') { B.save(false); return; }
    if (a === 'draft') { B.save(true); return; }
    if (a === 'cancel') {
      if (!B.dirty || global.confirm('Discard this ' + (B.mode === 'sale' ? 'invoice' : 'purchase') + '?')) {
        B.draft = null; global.go(B.mode === 'sale' ? 'invoices' : 'purchases');
      }
      return;
    }
    if (a === 'openpicker') {
      B.pickerOpen = true;
      ERP.BuilderRender.results();
      var el = D.getElementById('fcbPick'); if (el) el.focus();
      return;
    }
    if (a === 'addplain') {
      var sel = D.getElementById('fcbPlain');
      if (sel && sel.value) ERP.BuilderUI.addLine(sel.value);
      return;
    }
    if (a === 'exportcsv') { ERP.InvoiceList.exportCsv(); return; }
    if (a === 'backup') { doBackup(); return; }
    if (a === 'exportbiz') { exportBusinessCsv(); return; }
    if (a === 'savesettings') { saveSettingsForm(); return; }
    if (a === 'clearlogo') { ERP.Settings.save({ logoDataUrl: '' }).then(function () { global.paint(); say('Logo removed.'); }); return; }
    return;
  }

  /* picker result */
  var add = h('[data-fcbadd]');
  if (add) { e.preventDefault(); ERP.BuilderUI.addLine(add.dataset.fcbadd); return; }

  /* line controls */
  var del = h('[data-fcdel]');
  if (del) {
    e.preventDefault();
    B.draft.items.splice(+del.dataset.fcdel, 1); B.dirty = true;
    ERP.BuilderRender.lines(); return;
  }
  var mv = h('[data-fcmove]');
  if (mv) {
    e.preventDefault();
    var ix = +mv.dataset.ix, to = mv.dataset.fcmove === 'up' ? ix - 1 : ix + 1;
    if (to >= 0 && to < B.draft.items.length) {
      var row = B.draft.items.splice(ix, 1)[0];
      B.draft.items.splice(to, 0, row); B.dirty = true; ERP.BuilderRender.lines();
    }
    return;
  }

  /* invoice list row actions */
  var ia = h('[data-fcinv]');
  if (ia) {
    e.preventDefault();
    var id = ia.dataset.id, what = ia.dataset.fcinv;
    if (what === 'view') ERP.Viewer.open(ERP.DocModel.invoice(id));
    else if (what === 'word') { ERP.Viewer.current = ERP.DocModel.invoice(id); ERP.Viewer.word(); }
    else if (what === 'edit') editInvoice(id);
    else if (what === 'dup') duplicateInvoice(id);
    else if (what === 'pay') { PAY_FOR = (ERP.Invoices.byId(id) || {}).customerId; global.openPanel('payment'); }
    else if (what === 'return') { RETURN_FOR = id; global.openPanel('creditnote'); }
    return;
  }

  /* receipts / statements opened from other screens */
  var rc = h('[data-fcreceipt]');
  if (rc) { e.preventDefault(); ERP.Viewer.open(ERP.DocModel.receipt(rc.dataset.fcreceipt)); return; }
  var db = h('.fcdb');
  if (db) { e.preventDefault(); global.go('settings'); return; }

  /* Clicking away closes the product list. This only removes that one
     element — repainting the page here would shut whatever dropdown the
     person had just opened. */
  if (B.pickerOpen && !h('.fcb-picker')) {
    B.pickerOpen = false;
    try { ERP.BuilderRender.results(); } catch (err) {}
  }
}, true);

D.addEventListener('input', function (e) {
  var el = e.target;
  if (el.id === 'fcbPick') { B.pickerQuery = el.value; B.pickerOpen = true; ERP.BuilderRender.results(); return; }
  if (el.dataset.fcq !== undefined) { ERP.InvoiceList.q = el.value; repaintList(); return; }
  if (el.dataset.fcline) {
    var ix = +el.dataset.ix, k = el.dataset.fcline;
    if (!B.draft || !B.draft.items[ix]) return;
    if (k === 'qty') B.draft.items[ix].quantity = el.value;
    if (k === 'rate') B.draft.items[ix].unitPrice = el.value;
    if (k === 'disc') B.draft.items[ix].discount = el.value;
    if (k === 'recv') B.draft.items[ix].receivedQty = el.value;
    B.dirty = true; ERP.BuilderUI.refreshTotals(); return;
  }
  if (el.dataset.fcb && B.draft) {
    var key = el.dataset.fcb;
    if (['invoiceDiscount', 'freight', 'loading', 'otherCharges', 'paidAmount'].indexOf(key) > -1) {
      B.draft[key] = el.value; B.dirty = true; ERP.BuilderUI.refreshTotals(); return;
    }
    if (['notes', 'description', 'referenceNo', 'orderNumber', 'dispatchNumber', 'salesperson',
         'supplierInvoiceNo', 'vehicleNo', 'driver', 'deliveryRef'].indexOf(key) > -1) {
      B.draft[key] = el.value; B.dirty = true; return;
    }
  }
});

D.addEventListener('change', function (e) {
  var el = e.target;
  if (el.dataset.fcb && B.draft) {
    var key = el.dataset.fcb;
    if (key === 'regionFilter') {
      B.regionFilter = el.value; B.draft.customerId = '';
      ERP.BuilderRender.header(); return;
    }
    B.draft[key] = el.value; B.dirty = true;
    if (key === 'warehouseId') {
      B.draft.items.forEach(function (it) { it.warehouseId = el.value; });
      ERP.BuilderRender.header(); ERP.BuilderRender.lines(); return;
    }
    if (key === 'customerId' || key === 'supplierId' || key === 'invoiceId') {
      ERP.BuilderRender.header(); return;
    }
    ERP.BuilderUI.refreshTotals(); return;
  }
  if (el.dataset.fcline === 'wh' && B.draft) {
    B.draft.items[+el.dataset.ix].warehouseId = el.value; B.dirty = true;
    ERP.BuilderRender.lines(); return;
  }
  if (el.dataset.fcline === 'dir' && B.draft) {
    B.draft.items[+el.dataset.ix].direction = el.value; B.dirty = true;
    ERP.BuilderRender.lines(); return;
  }
  if (el.dataset.fcline === 'damaged' && B.draft) {
    B.draft.items[+el.dataset.ix].fromDamaged = el.checked; B.dirty = true;
    ERP.BuilderRender.lines(); return;
  }
  if (el.dataset.fcretcond && B.draft === null) { return; }
  if (el.dataset.fcfil) { ERP.InvoiceList[el.dataset.fcfil] = el.value; repaintList(); return; }
  if (el.id === 'fcPayCust') {
    var box = D.getElementById('fcPayBal');
    if (box) box.innerHTML = I('wallet') + '<div><p>Outstanding balance: <b>' +
      M.fmt(ERP.Ledger.customerBalance(el.value)) + '</b></p></div>';
    renderAllocList(); return;
  }
  if (el.id === 'fcPayArea') {
    PAY_AREA = el.value;
    var custSel = D.getElementById('fcPayCust');
    if (custSel) {
      var opts = payCustomersInArea();
      custSel.disabled = !opts.length;
      custSel.innerHTML = payShopOptionsHtml(opts);
      var bbox = D.getElementById('fcPayBal');
      if (bbox) {
        bbox.className = 'banner ' + (opts.length ? 'info' : 'warn');
        bbox.innerHTML = payBalanceHtml(opts);
      }
      if (opts.length) {
        renderAllocList();
      } else {
        /* no shop is selected in this state — don't let renderAllocList()
           overwrite this with a misleading "this shop has no unpaid
           invoices" message, which implies a shop that isn't there */
        var listHost = D.getElementById('fcPayList'); if (listHost) listHost.innerHTML = '';
      }
    }
    return;
  }
  if (el.id === 'fcPayMode') { renderAllocList(); return; }
  if (el.id === 'fcRetInv') {
    var host = D.getElementById('fcRetLines');
    if (host) host.innerHTML = retLines(el.value);
    return;
  }
  if (el.dataset.fclogo !== undefined && el.files && el.files[0]) {
    var fr = new global.FileReader();
    fr.onload = function () {
      ERP.Settings.save({ logoDataUrl: fr.result }).then(function () { say('Logo saved.'); });
    };
    fr.readAsDataURL(el.files[0]); return;
  }
  if (el.dataset.fcrestore !== undefined && el.files && el.files[0]) {
    var file = el.files[0];
    if (!global.confirm('Restore from "' + file.name + '"? A backup of the current data will be downloaded first, ' +
        'then the records in this file will be written over the current ones.')) { el.value = ''; return; }
    doBackup(true).then(function () {
      var r = new global.FileReader();
      r.onload = function () {
        var parsed;
        try { parsed = JSON.parse(r.result); }
        catch (x) { say('That file is not valid JSON.'); return; }
        var done = function () {
          ERP.Audit.detached({ action: 'Database restored from backup', entity: 'System', entityId: 'restore',
            reason: file.name });
          say('Restore complete — reloading.');
          setTimeout(function () { global.location.reload(); }, 900);
        };
        FDB.importAll(parsed, 'replace').then(done).catch(function (err) {
          /* the safety layer stopped it — ask, naming what would go */
          if (err && err.blocked && ERP.Guard && ERP.Guard.promptOverride) {
            var losses = (err.detail && err.detail.losses) || [];
            ERP.Guard.promptOverride(losses, file.name).then(function (ok) {
              if (!ok) { say('Nothing was changed.'); return; }
              FDB.importAll(parsed, 'replace').then(done).catch(function (e2) {
                say('Restore failed: ' + (e2.message || 'unknown error'));
              });
            });
            return;
          }
          say('Restore failed: ' + (err.message || 'unknown error'));
        });
      };
      r.readAsText(file);
    });
    return;
  }
});

var listTimer = null;
function repaintList() {
  clearTimeout(listTimer);
  listTimer = setTimeout(function () {
    if (global.cur !== 'invoices' && global.cur !== 'sales') return;
    var focus = D.activeElement, sel = focus && focus.selectionStart;
    global.paint();
    if (focus && focus.dataset && focus.dataset.fcq !== undefined) {
      var el = D.querySelector('[data-fcq]');
      if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch (e) {} }
    }
  }, 160);
}

function renderAllocList() {
  var host = D.getElementById('fcPayList'); if (!host) return;
  var mode = (D.getElementById('fcPayMode') || {}).value;
  var cid = (D.getElementById('fcPayCust') || {}).value;
  if (mode !== 'pick') { host.innerHTML = ''; return; }
  var invs = openInvoicesForCustomer(cid);
  host.innerHTML = invs.length ? '<div class="f"><span>Apply to these invoices</span>' + invs.map(function (i) {
    return '<div class="fcalloc"><b>' + esc(i.invoiceNumber) + '</b>' +
      '<span class="hint">' + esc(fmtDate(i.invoiceDate)) + ' · due ' + M.fmt(ERP.Invoices.outstanding(i)) + '</span>' +
      '<input data-fcalloc="' + i.id + '" inputmode="decimal" placeholder="0"></div>';
  }).join('') + '</div>' : '<p class="hint">This shop has no unpaid invoices — the payment will sit on account.</p>';
}

function saveSettingsForm() {
  var patch = {};
  D.querySelectorAll('[data-fcset]').forEach(function (el) {
    var k = el.dataset.fcset, v = el.value;
    if (k === 'taxEnabled' || k === 'allowNegativeStock') patch[k] = v === 'yes';
    else if (k === 'defaultTaxRate') patch[k] = Number(String(v).replace(/[^\d.]/g, '')) || 0;
    else patch[k] = v;
  });
  if (!patch.businessName) { say('The business name cannot be empty.'); return; }
  ERP.Settings.save(patch).then(function () {
    D.title = patch.businessName + ' — Warehouse ERP';
    global.paint(); say('Business profile saved. It appears on every document from now on.');
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   INVOICE ACTIONS
   ══════════════════════════════════════════════════════════════════════════ */
function editInvoice(id) {
  var inv = ERP.Invoices.byId(id);
  if (!inv) { say('Invoice not found.'); return; }
  if (inv.status === 'CANCELLED') { say('A cancelled invoice cannot be edited. Duplicate it instead.'); return; }
  if (inv.status !== 'DRAFT') {
    if (!global.confirm('This invoice is confirmed. Editing it will adjust stock and the customer balance by the ' +
        'difference, and the change is recorded in the audit log. Continue?')) return;
  }
  var d = ERP.Invoices.toDraft(inv);
  d.id = inv.id; d.clientOpId = inv.clientOpId; d.revision = inv.revision || 0; d.existing = true;
  B.start('sale', d);
}
function duplicateInvoice(id) {
  var d = ERP.Invoices.duplicate(id);
  if (!d) { say('Invoice not found.'); return; }
  B.start('sale', d);
  say('New draft created from ' + d.duplicatedFrom + '. It takes its own number when you save.');
}
function cancelInvoice(id) {
  var reason = global.prompt('Why is this invoice being cancelled? (recorded in the audit log)');
  if (reason === null) return;
  ERP.Invoices.cancel(id, reason || 'No reason given').then(function (inv) {
    ERP.Viewer.close(); global.paint();
    say(inv.invoiceNumber + ' cancelled. Stock has been returned and the balance reversed.');
  }).catch(function () { say('The invoice could not be cancelled.'); });
}
ERP.actions = { editInvoice: editInvoice, duplicateInvoice: duplicateInvoice, cancelInvoice: cancelInvoice,
                backup: doBackup };

/* ══════════════════════════════════════════════════════════════════════════
   PATCHES — point the existing screens at the new database
   ══════════════════════════════════════════════════════════════════════════ */
/* 1. Sales page becomes the invoice list; the builder replaces the one-line
      sale panel. No duplicate module is introduced. */
global.PAGES.sales = global.PAGES.invoices;
if (global.PAGEMETA) {
  global.PAGEMETA.sales = ['Sales & invoices',
    'Every invoice, with its items, payments and balance. One invoice can carry as many products as the load needs.'];
  global.PAGEMETA.invoices = global.PAGEMETA.sales;
  global.PAGEMETA.invoiceBuilder = ['New invoice', 'Pick the shop, add every product on the load, then save.'];
}
if (global.NAV) {
  var navSales = global.NAV.find(function (n) { return n.id === 'sales'; });
  if (navSales) navSales.l = 'Sales & invoices';
}

/* 2. The old panels open the new screens instead */
var BUILDER_PANELS = {
  sale: 'sale', purchase: 'purchase', order: 'order', quotation: 'quotation',
  dispatch: 'dispatch', transfer: 'transfer', adjust: 'adjust', receive: 'receive',
  supreturn: 'supreturn'
};
var origOpenPanel = global.openPanel;
global.openPanel = function (k) {
  if (BUILDER_PANELS[k]) { B.start(BUILDER_PANELS[k]); return; }
  return origOpenPanel.call(global, k);
};

/* 3. Persistence: dbSave now also writes master data and the legacy blob
      into the database. The old localStorage record is still written so the
      warehouse PWA bridge keeps working. */
var origDbSave = global.dbSave;
var saveTimer = null;
var lastSelfWrite = null;
function readShared() {
  try { return global.localStorage.getItem('farooqco_erp_v1'); } catch (e) { return null; }
}
global.dbSave = function () {
  try { origDbSave && origDbSave(); } catch (e) {}
  lastSelfWrite = readShared();
  if (!ERP.S.loaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () { ERP.persistMasterAndLegacy(); }, 400);
};

/* paint() ends by announcing "farooqco:changed", and the app answers its own
   announcement with dbLoad() + paint(). In the launcher the announcement goes
   to the launcher frame and nothing comes back, but opening the ERP file
   directly makes the window its own parent — so it repainted forever, which
   wiped whatever the person was typing. The echo is now recognised and
   ignored; a genuine change from the warehouse app still reloads. */
var origDbLoad = global.dbLoad;
global.dbLoad = function () {
  var raw = readShared();
  if (raw !== null && raw === lastSelfWrite) return false;
  var changed = origDbLoad.apply(global, arguments);
  if (changed) { lastSelfWrite = raw; try { ERP.Mirror.refresh(); } catch (e) {} }
  return changed;
};

/* 3b. Anything saved through a panel may have edited a product, shop or
      supplier record, so the master tables are flushed in full after it. */
var origSavePanel = global.savePanel;
global.savePanel = function () {
  var r = origSavePanel.apply(global, arguments);
  ERP.markMasterDirty();
  global.dbSave();
  return r;
};

/* 4. Stock moved by the older screens (dispatch, transfer) now writes a
      persisted movement instead of only changing a number in memory. */
var origMoveStock = global.moveStock;
global.moveStock = function (pid, wid, delta, kind, ref, note) {
  var map = { Purchase: 'PURCHASE_IN', Sale: 'SALE_OUT', Dispatch: 'DISPATCH_OUT',
              'Transfer out': 'TRANSFER_OUT', 'Transfer in': 'TRANSFER_IN' };
  ERP.queue(function () {
    return FDB.tx(['inventory', 'stockMovements'], function (api) {
      ERP.Inventory.apply(api, { productId: pid, warehouseId: wid, qtyDelta: delta,
        kind: map[kind] || 'ADJUSTMENT', ref: ref || '', refType: kind || '', note: note || '',
        date: todayISO() });
    });
  });
};

/* 5. Balances everywhere come from the one ledger. */
global.custLedger = function (id, fromISO, toISO) {
  var L = ERP.Ledger.customer(id, fromISO, toISO);
  return {
    opening: M.toR(L.opening), closing: M.toR(L.closing),
    debit: M.toR(L.debit), credit: M.toR(L.credit),
    rows: L.rows.map(function (r) {
      return { iso: r.iso, date: fmtDate(r.iso), ref: r.ref, what: r.what,
               dr: M.toR(r.dr), cr: M.toR(r.cr), bal: M.toR(r.balance) };
    })
  };
};
global.supLedger = function (id, fromISO, toISO) {
  var L = ERP.Ledger.supplier(id, fromISO, toISO);
  return {
    opening: M.toR(L.opening), closing: M.toR(L.closing),
    debit: M.toR(L.debit), credit: M.toR(L.credit),
    rows: L.rows.map(function (r) {
      return { iso: r.iso, date: fmtDate(r.iso), ref: r.ref, what: r.what,
               dr: M.toR(r.dr), cr: M.toR(r.cr), bal: M.toR(r.balance) };
    })
  };
};
global.custBal = function (id) { return M.toR(ERP.Ledger.customerBalance(id)); };
global.supBal = function (id) { return M.toR(ERP.Ledger.supplierBalance(id)); };

/* 6. Opening a document from anywhere in the app uses the new viewer. */
var origOpenDoc = global.openDoc;
global.openDoc = function (no) {
  var inv = ERP.Invoices.byNumber(no);
  if (inv) { ERP.Viewer.open(ERP.DocModel.invoice(inv.id)); return; }
  var pay = ERP.S.payments.find(function (p) { return p.receiptNumber === no; });
  if (pay) { ERP.Viewer.open(ERP.DocModel.receipt(pay.id)); return; }
  var pur = ERP.S.purchases.find(function (p) { return p.purchaseNumber === no; });
  if (pur) { ERP.Viewer.open(ERP.DocModel.purchase(pur.id)); return; }
  var cr = ERP.S.custReturns.find(function (r) { return r.returnNumber === no; });
  if (cr) { ERP.Viewer.open(ERP.DocModel.customerReturn(cr.id)); return; }
  var sr = ERP.S.supReturns.find(function (r) { return r.returnNumber === no; });
  if (sr) { ERP.Viewer.open(ERP.DocModel.supplierReturn(sr.id)); return; }
  return origOpenDoc ? origOpenDoc.call(global, no) : null;
};

/* 7. Purchases screen gains the multi-line entry button. */
var origPurchases = global.PAGES.purchases;
global.PAGES.purchases = function () {
  var html = origPurchases ? origPurchases() : '';
  return html.replace('data-panel="purchase"', 'data-fcbact="newpurchase"');
};

/* 8. Payments screen: receipts open the new printable receipt. */
var origPayments = global.PAGES.payments;
global.PAGES.payments = function () {
  var html = typeof origPayments === 'function' ? origPayments() : origPayments;
  return html + '<div class="card"><div class="card-h"><h3>Receipts &amp; vouchers</h3>' +
    '<span class="pill neu">' + ERP.S.payments.length + '</span></div><div class="card-b">' +
    (ERP.S.payments.length ? '<div class="tw"><table class="fcb-list"><thead><tr><th>Number</th><th>Date</th>' +
      '<th>Party</th><th>Direction</th><th>Method</th><th class="r">Amount</th><th class="c">Document</th></tr></thead><tbody>' +
      ERP.S.payments.slice(0, 200).map(function (p) {
        return '<tr><td class="mono">' + esc(p.receiptNumber) + '</td><td>' + esc(fmtDate(p.paymentDate)) + '</td>' +
          '<td>' + esc(p.partyNameSnapshot) + '</td>' +
          '<td>' + (p.direction === 'IN' ? 'Received' : 'Paid out') + '</td>' +
          '<td>' + esc(p.method) + '</td><td class="r num">' + M.fmtPlain(p.amount) + '</td>' +
          '<td class="c"><button class="btn sm" data-fcreceipt="' + p.id + '">Open</button></td></tr>';
      }).join('') + '</tbody></table></div>'
    : '<p class="hint">No receipts yet. Record a payment and a numbered receipt is generated automatically.</p>') +
    '</div></div>';
};

/* 9. Reports read the invoice tables. */
var origReports = global.PAGES.reports;
global.PAGES.reports = function () {
  var r = ERP.Reports.sales(null, null);
  var byProduct = ERP.Reports.byProduct(null, null).slice(0, 12);
  var byRegion = ERP.Reports.byRegion(null, null);
  var extra = '<div class="card"><div class="card-h"><h3>Sales, profit and returns</h3>' +
      '<span class="pill neu">From invoice records</span></div><div class="card-b">' +
    '<div class="ledger l4">' +
      '<div class="kpi"><div class="k">Revenue</div><div class="v">' + M.fmt(r.revenue) + '</div>' +
        '<div class="d">' + r.count + ' invoices</div></div>' +
      '<div class="kpi"><div class="k">Cost of goods</div><div class="v">' + M.fmt(r.cost) + '</div>' +
        '<div class="d">From the cost recorded at sale time</div></div>' +
      '<div class="kpi"><div class="k">Gross profit</div><div class="v">' + M.fmt(r.grossProfit) + '</div>' +
        '<div class="d">' + r.margin + '% margin</div></div>' +
      '<div class="kpi"><div class="k">Returns</div><div class="v">' + M.fmt(r.returns) + '</div>' +
        '<div class="d">Credited back</div></div>' +
    '</div>' +
    (byProduct.length ? '<div class="tw" style="margin-top:12px"><table class="fcb-list"><thead><tr>' +
      '<th>Product</th><th>Package</th><th class="r">Bags sold</th><th class="r">Revenue</th>' +
      '<th class="r">Cost</th><th class="r">Gross profit</th></tr></thead><tbody>' +
      byProduct.map(function (p) {
        return '<tr><td>' + (global.u ? global.u(p.name || '') : '') + ' <span class="sub">' +
          esc(p.nameEn || '') + '</span></td><td>' + esc(p.pack) + '</td>' +
          '<td class="r num">' + Number(p.qty).toLocaleString('en-US') + '</td>' +
          '<td class="r num">' + M.fmtPlain(p.revenue) + '</td>' +
          '<td class="r num">' + M.fmtPlain(p.cost) + '</td>' +
          '<td class="r num"><b>' + M.fmtPlain(p.revenue - p.cost) + '</b></td></tr>';
      }).join('') + '</tbody></table></div>' : '') +
    (byRegion.length ? '<div class="tw" style="margin-top:12px"><table class="fcb-list"><thead><tr>' +
      '<th>Region</th><th class="r">Invoices</th><th class="r">Bags</th><th class="r">Revenue</th></tr></thead><tbody>' +
      byRegion.map(function (x) {
        return '<tr><td>' + esc(x.label) + '</td><td class="r num">' + x.count + '</td>' +
          '<td class="r num">' + Number(x.qty).toLocaleString('en-US') + '</td>' +
          '<td class="r num">' + M.fmtPlain(x.revenue) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '') +
    '</div></div>';
  return (origReports ? origReports() : '') + extra;
};

/* 10. Database status chip in the shell (§56) */
function paintDbChip() {
  var st = FDB.status();
  var host = D.querySelector('.top') || D.querySelector('.bar') || D.body;
  var chip = D.getElementById('fcDbChip');
  if (!chip) {
    chip = D.createElement('button');
    chip.id = 'fcDbChip';
    chip.className = 'fcdb';
    var anchor = D.getElementById('bellBtn');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(chip, anchor);
    else host.appendChild(chip);
  }
  chip.className = 'fcdb' + (st.healthy ? '' : st.driver === 'memory' ? ' bad' : ' warn');
  chip.innerHTML = '<span class="dot"></span>' +
    (st.healthy ? (FDB.pendingWrites ? 'Saving…' : 'Saved') : st.label);
  chip.title = st.detail;
}
var origPaint = global.paint;
global.paint = function (loading) {
  origPaint.call(global, loading);
  try { paintDbChip(); } catch (e) {}
};

/* 11. Warn before losing a half-built invoice */
global.addEventListener('beforeunload', function (e) {
  if (B.dirty && B.draft && B.draft.items && B.draft.items.length) {
    e.preventDefault(); e.returnValue = '';
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════════════ */
ERP.bootPromise = ERP.boot().then(function () {
  ERP.Mirror.refresh();
  try { global.paint(); } catch (e) { try { global.console.error(e); } catch (x) {} }
  var missing = global.FC_BRIDGE_MISSING || [];
  if (missing.length) {
    setTimeout(function () {
      say('The ' + missing.join(', ') + ' list did not load. Reload the page; if it happens again, ' +
          'restore a backup from Settings.');
    }, 800);
  }
  var st = FDB.status();
  if (!st.healthy) {
    setTimeout(function () {
      say(st.driver === 'memory'
        ? 'Storage is blocked for local files — take a backup from Settings before closing.'
        : 'Running on browser storage. Take regular backups from Settings.');
    }, 1200);
  }
  ERP.ready = true;
});
})(typeof window !== 'undefined' ? window : globalThis);
