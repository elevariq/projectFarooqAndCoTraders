/* ══════════════════════════════════════════════════════════════════════════
   STATEMENT OF ACCOUNT — ONE SCREEN, EITHER PARTY

   Client request (2026-09-16): a place under Finance to check the complete
   khata of a Customer OR a Supplier — every purchase/sale, payment and the
   outstanding balance, with dates — without having to first open that
   shop's or mill's own profile page to find the "Statement" button.

   This adds no new ledger math. It is a filter bar (party type, area, party,
   date range) in front of the same ERP.Ledger.customer()/.supplier() figures
   and the same ERP.DocModel.statement() used by the existing per-shop and
   per-supplier "Statement" buttons, so this can never disagree with them.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var ERP = global.ERP; if (!ERP) return;
  var M = global.Money, D = global.document;
  if (!M || !ERP.Ledger || !ERP.DocModel || !global.PAGES) return;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function I(n) { return global.I ? global.I(n) : ''; }
  function say(m) { try { global.say(m); } catch (e) {} }
  function fmtDate(d) { return global.fmtDate ? global.fmtDate(d) : d; }

  /* ════════════════════════════════════════════════════════════════════════
     STATE
     ════════════════════════════════════════════════════════════════════════ */
  var SOA = { type: 'CUSTOMER', regionId: '', partyId: '', from: '', to: '' };
  /* an area deleted elsewhere must not stay selected here (the list would silently show nothing) */
  if (ERP.Areas && ERP.Areas.onDelete) ERP.Areas.onDelete(function (id) { if (SOA.regionId === id) { SOA.regionId = ''; SOA.partyId = ''; } });

  function customersInArea() {
    return (global.CUSTOMERS || []).filter(function (c) {
      return !SOA.regionId || (c.region || '') === SOA.regionId;
    });
  }
  function partyList() {
    if (SOA.type === 'SUPPLIER') {
      return (global.SUPPLIERS || []).filter(function (s) { return s.active !== false; })
        .slice().sort(function (a, b) {
          return (a.co || '').toLowerCase() < (b.co || '').toLowerCase() ? -1 : 1;
        });
    }
    return customersInArea().slice().sort(function (a, b) {
      return (a.sh || '').toLowerCase() < (b.sh || '').toLowerCase() ? -1 : 1;
    });
  }
  function partyName(p) { return SOA.type === 'SUPPLIER' ? (p.co || '') : (p.sh || ''); }
  function ledgerFor(id) {
    return SOA.type === 'SUPPLIER'
      ? ERP.Ledger.supplier(id, SOA.from || null, SOA.to || null)
      : ERP.Ledger.customer(id, SOA.from || null, SOA.to || null);
  }
  function partyById(id) {
    return SOA.type === 'SUPPLIER' ? (global.supOf && global.supOf(id)) : (global.custBy && global.custBy(id));
  }
  function regionOptions() {
    /* keep the currently selected area choosable even if it's since been
       switched off, or the dropdown would silently jump to "All areas"
       while the party list stayed filtered to the (now invisible) area */
    var regions = (global.REGIONS || []).filter(function (r) { return r.active !== false || r.id === SOA.regionId; });
    return '<option value="">All areas</option>' +
      regions.map(function (r) {
        return '<option value="' + esc(r.id) + '"' + (SOA.regionId === r.id ? ' selected' : '') +
          '>' + esc(r.en) + (r.ur ? ' — ' + esc(r.ur) : '') + (r.active === false ? ' (inactive)' : '') + '</option>';
      }).join('');
  }
  function card(cls, l, v, d) {
    return '<div class="kh-card ' + cls + '"><i>' + l + '</i><b>' + v + '</b>' +
      (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  }
  /* A zero-length party list (e.g. an area with no shops) must still leave
     the filter bar on screen — an empty state with no way to change the
     Area or Party type is a dead end the person can only escape by leaving
     the page and losing the screen's remembered state anyway. */
  function partyOptionsHtml(list) {
    if (!list.length) {
      return '<option value="" disabled selected>No ' +
        (SOA.type === 'SUPPLIER' ? 'suppliers on file' : (SOA.regionId ? 'shops in this area' : 'shops on file')) +
        '</option>';
    }
    return list.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === SOA.partyId ? ' selected' : '') + '>' +
        esc(partyName(p)) + '</option>';
    }).join('');
  }

  /* ════════════════════════════════════════════════════════════════════════
     THE SCREEN
     ════════════════════════════════════════════════════════════════════════ */
  global.PAGES.soa = function () {
    var isCust = SOA.type !== 'SUPPLIER';
    var list = partyList();

    if (list.length) {
      if (!list.some(function (p) { return p.id === SOA.partyId; })) SOA.partyId = list[0].id;
    } else {
      SOA.partyId = '';
    }
    var party = list.length ? list.filter(function (p) { return p.id === SOA.partyId; })[0] : null;

    var filterBar = '<div class="bar">' +
        '<label class="f"><span>Party type</span><select data-soaf="type">' +
          '<option value="CUSTOMER"' + (isCust ? ' selected' : '') + '>Customer</option>' +
          '<option value="SUPPLIER"' + (!isCust ? ' selected' : '') + '>Supplier</option>' +
        '</select></label>' +
        (isCust ? '<label class="f"><span>Area</span><select data-soaf="regionId">' + regionOptions() +
          '</select></label>' : '') +
        '<label class="f"><span>' + (isCust ? 'Shop' : 'Supplier') + '</span><select data-soaf="partyId"' +
          (list.length ? '' : ' disabled') + '>' + partyOptionsHtml(list) + '</select></label>' +
        '<label class="f"><span>From</span><input type="date" data-soaf="from" value="' + esc(SOA.from) + '"></label>' +
        '<label class="f"><span>To</span><input type="date" data-soaf="to" value="' + esc(SOA.to) + '"></label>' +
        '<div class="grow"></div>' +
        (isCust
          ? '<button class="btn" data-soapay>' + I('wallet') + 'Receive payment</button>' +
            '<button class="btn" data-soarefund>' + I('wallet') + 'Pay this shop</button>'
          : '<button class="btn" data-soapaysup>' + I('wallet') + 'Pay this supplier</button>') +
        '<button class="btn" data-soaprint>' + I('print') + 'Print / PDF</button>' +
        '<button class="btn pri" data-soaexcel>' + I('sheet') + 'Excel</button>' +
      '</div>';

    if (!list.length) {
      return '<div class="card"><div class="card-h"><h3>Statement of Account</h3>' +
          '<span class="pill neu">' + (isCust ? 'Customer' : 'Supplier') + ' ledger</span></div><div class="card-b">' +
        filterBar +
        '<div class="banner warn" style="margin-top:12px">' + I('alert') +
          '<div><b>No ' + (isCust ? 'shops' : 'suppliers') + ' on file' +
            (isCust && SOA.regionId ? ' in this area' : '') + '</b>' +
          '<p>' + (isCust ? 'Pick a different area, or add a shop.' : 'Add a supplier first.') + '</p></div></div>' +
      '</div></div>';
    }

    /* Ledger._roll() (02-services.js) treats an inverted range as "drop
       everything after To, fold everything before From into opening" — with
       From after To that silently discards transactions from both the
       period AND the opening balance instead of raising an error. Every
       other statement entry point in the app only ever offers preset
       periods (always valid); this screen is the first to expose raw
       From/To fields, so it's the first place that inversion is reachable
       at all — caught here rather than showing a wrong balance. */
    if (SOA.from && SOA.to && SOA.from > SOA.to) {
      return '<div class="card"><div class="card-h"><h3>Statement of Account</h3>' +
          '<span class="pill neu">' + (isCust ? 'Customer' : 'Supplier') + ' ledger</span></div><div class="card-b">' +
        filterBar +
        '<div class="banner warn" style="margin-top:12px">' + I('alert') +
          '<div><b>The "From" date is after the "To" date</b>' +
          '<p>Pick a From date on or before the To date.</p></div></div>' +
      '</div></div>';
    }

    var L = ledgerFor(SOA.partyId);

    var movementIn = isCust ? L.debit : L.credit;    /* invoiced / purchased  — adds to what they owe */
    var movementOut = isCust ? L.credit : L.debit;   /* received / paid       — reduces it */

    /* a long-lived account can carry thousands of entries; the on-screen
       table shows the most recent MAX_ROWS_SHOWN (L.rows is oldest-first,
       so the tail is the most recent) — Print/PDF and Excel are unaffected
       and always cover the full period regardless of this cap */
    var MAX_ROWS_SHOWN = 300;
    var truncated = L.rows.length > MAX_ROWS_SHOWN;
    var shownRows = truncated ? L.rows.slice(-MAX_ROWS_SHOWN) : L.rows;

    var rows = shownRows.map(function (r) {
      return '<tr>' +
        '<td data-label="Date">' + esc(fmtDate(r.iso)) + '</td>' +
        '<td data-label="Reference / Folio" class="mono">' + esc(r.ref || '—') + '</td>' +
        '<td data-label="Description">' + esc(r.description || r.what) + '</td>' +
        '<td data-label="Debit / بنام" class="r kh-dr">' + (r.dr ? M.fmtPlain(r.dr) : '—') + '</td>' +
        '<td data-label="Credit / جمع" class="r kh-cr">' + (r.cr ? M.fmtPlain(r.cr) : '—') + '</td>' +
        '<td data-label="Balance / بقایا" class="r kh-bal' + (r.balance < 0 ? ' neg' : '') + '">' +
          M.fmtPlain(r.balance) + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="card"><div class="card-h"><h3>Statement of Account</h3>' +
        '<span class="pill neu">' + (isCust ? 'Customer' : 'Supplier') + ' ledger</span></div><div class="card-b">' +
      filterBar +

      '<div class="kh-cards">' +
        card('', 'Opening balance', M.fmt(L.opening)) +
        card('sale', isCust ? 'Total invoiced' : 'Total purchased', M.fmt(movementIn)) +
        card('credit', isCust ? 'Total received' : 'Total paid', M.fmt(movementOut)) +
        card(L.closing > 0 ? 'due' : 'credit', 'Closing balance', M.fmt(L.closing),
          L.closing > 0 ? (isCust ? 'Owed by the shop' : 'Payable to the supplier')
            : L.closing < 0 ? 'In credit' : 'Settled') +
      '</div>' +

      (party ? '<p class="hint" style="margin:10px 0 0">' + esc(partyName(party)) +
        (isCust && party.ow ? ' · ' + esc(party.ow) : (!isCust && party.cp ? ' · ' + esc(party.cp) : '')) +
        (function () {
          var region = isCust && party.region && global.regionOf ? global.regionOf(party.region) : null;
          return region ? ' · ' + esc(region.en) : '';
        })() +
        '</p>' : '') +

      (truncated ? '<p class="hint" style="margin-top:12px">Showing the most recent ' + MAX_ROWS_SHOWN +
        ' of ' + L.rows.length + ' transactions. Use Print/PDF or Excel for the complete statement.</p>' : '') +

      (L.rows.length
        ? '<div class="tw" style="margin-top:' + (truncated ? '6' : '12') + 'px"><table class="kh-table"><thead><tr>' +
            '<th>Date</th><th>Reference / Folio</th><th>Description</th>' +
            '<th class="r">Debit / بنام</th><th class="r">Credit / جمع</th>' +
            '<th class="r">Balance / بقایا</th>' +
          '</tr></thead><tbody>' + rows + '</tbody>' +
          '<tfoot><tr><td colspan="3"><b>Totals for this period</b></td>' +
            '<td class="r kh-dr">' + M.fmtPlain(L.debit) + '</td>' +
            '<td class="r kh-cr">' + M.fmtPlain(L.credit) + '</td>' +
            '<td class="r kh-bal">' + M.fmtPlain(L.closing) + '</td></tr></tfoot>' +
          '</table></div>'
        : '<p class="hint" style="margin-top:12px">No transactions in this period.</p>') +
    '</div></div>';
  };

  /* ════════════════════════════════════════════════════════════════════════
     NAV — one entry under the existing Finance group, right after Payments
     ════════════════════════════════════════════════════════════════════════ */
  try {
    var NAV = global.NAV, GROUPS = global.NAVGROUPS;
    if (!NAV.some(function (n) { return n.id === 'soa'; })) {
      var at = NAV.map(function (n) { return n.id; }).indexOf('payments');
      NAV.splice(at < 0 ? NAV.length : at + 1, 0, { id: 'soa', l: 'Statement of Account', i: 'doc' });
    }
    GROUPS.forEach(function (g) {
      if (g[0] === 'Finance' && g[1].indexOf('soa') === -1) {
        var pos = g[1].indexOf('payments');
        g[1].splice(pos < 0 ? g[1].length : pos + 1, 0, 'soa');
      }
    });
    if (global.PAGEMETA) {
      global.PAGEMETA.soa = ['Statement of Account',
        'Pick a customer or supplier and see every invoice, payment and the balance, with dates.'];
    }
  } catch (e) {}

  /* ════════════════════════════════════════════════════════════════════════
     HANDLERS
     ════════════════════════════════════════════════════════════════════════ */
  D.addEventListener('change', function (e) {
    var el = e.target; if (!el.dataset || el.dataset.soaf === undefined) return;
    var k = el.dataset.soaf, v = el.value;
    if (k === 'type') { SOA.type = v; SOA.regionId = ''; SOA.partyId = ''; }
    else if (k === 'regionId') { SOA.regionId = v; SOA.partyId = ''; }
    else { SOA[k] = v; }
    global.paint();
  });

  function invalidRange() { return SOA.from && SOA.to && SOA.from > SOA.to; }

  D.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-soapay]')) {
      e.preventDefault();
      if (!SOA.partyId) return;
      if (ERP.setPayFor) ERP.setPayFor(SOA.partyId);
      global.openPanel('payment');
      return;
    }
    if (e.target.closest('[data-soarefund]')) {
      e.preventDefault();
      if (!SOA.partyId) return;
      if (ERP.setRefundFor) ERP.setRefundFor(SOA.partyId);
      global.openPanel('refund');
      return;
    }
    if (e.target.closest('[data-soapaysup]')) {
      e.preventDefault();
      if (!SOA.partyId) return;
      if (ERP.setPayFor) ERP.setPayFor(SOA.partyId);
      global.openPanel('paysup');
      return;
    }
    if (e.target.closest('[data-soaprint]')) {
      e.preventDefault();
      if (!SOA.partyId) return;
      if (invalidRange()) { say('The "From" date is after the "To" date — fix the range first.'); return; }
      var m = ERP.DocModel.statement(SOA.partyId, SOA.type, SOA.from || null, SOA.to || null);
      ERP.Viewer.open(m);
      ERP.Audit.detached({ action: 'Statement of account opened', entity: 'Report', entityId: 'soa',
        reason: SOA.type + ' ' + SOA.partyId });
      return;
    }
    if (e.target.closest('[data-soaexcel]')) {
      e.preventDefault();
      if (!SOA.partyId) return;
      if (invalidRange()) { say('The "From" date is after the "To" date — fix the range first.'); return; }
      var L = ledgerFor(SOA.partyId);
      var party = partyById(SOA.partyId);
      var pname = party ? partyName(party) : '';
      var head = ['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'];
      var rows = L.rows.map(function (r) {
        return [fmtDate(r.iso), r.ref || '', r.description || r.what, M.toR(r.dr), M.toR(r.cr), M.toR(r.balance)];
      });
      var title = ['Statement of Account — ' + pname];
      var period = ['Period', (SOA.from ? fmtDate(SOA.from) : 'Beginning') + ' to ' + (SOA.to ? fmtDate(SOA.to) : 'Today')];
      var sheet = { name: 'Statement', rows: [title, period, []].concat([head]).concat(rows) };
      try {
        var bytes = ERP.XLSX.build([sheet],
          { title: 'Statement of Account', author: ERP.Settings.get().businessName });
        var blob = new global.Blob([bytes],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var a = D.createElement('a');
        a.href = global.URL.createObjectURL(blob);
        a.download = 'Statement-' + (pname || SOA.partyId).replace(/[^\w-]+/g, '_') + '.xlsx';
        D.body.appendChild(a); a.click();
        setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 1200);
        ERP.Audit.detached({ action: 'Statement of account exported to Excel', entity: 'Report', entityId: 'soa' });
        say('Excel file downloaded.');
      } catch (err) { say('Could not build the Excel file.'); }
      return;
    }
  });
})(typeof window !== 'undefined' ? window : this);
