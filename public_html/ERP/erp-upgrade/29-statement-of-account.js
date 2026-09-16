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
  function I(n) { return global.icon ? global.icon(n) : ''; }
  function say(m) { try { global.say(m); } catch (e) {} }
  function fmtDate(d) { return global.fmtDate ? global.fmtDate(d) : d; }

  /* ════════════════════════════════════════════════════════════════════════
     STATE
     ════════════════════════════════════════════════════════════════════════ */
  var SOA = { type: 'CUSTOMER', regionId: '', partyId: '', from: '', to: '' };

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
    return '<option value="">All areas</option>' +
      (global.REGIONS || []).filter(function (r) { return r.active !== false; })
        .map(function (r) {
          return '<option value="' + esc(r.id) + '"' + (SOA.regionId === r.id ? ' selected' : '') +
            '>' + esc(r.en) + (r.ur ? ' — ' + esc(r.ur) : '') + '</option>';
        }).join('');
  }
  function card(cls, l, v, d) {
    return '<div class="kh-card ' + cls + '"><i>' + l + '</i><b>' + v + '</b>' +
      (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
  }

  /* ════════════════════════════════════════════════════════════════════════
     THE SCREEN
     ════════════════════════════════════════════════════════════════════════ */
  global.PAGES.soa = function () {
    var isCust = SOA.type !== 'SUPPLIER';
    var list = partyList();

    if (!list.length) {
      return '<div class="empty"><div class="ei">' + I('users') + '</div>' +
        '<b>No ' + (isCust ? 'shops' : 'suppliers') + ' on file' +
        (isCust && SOA.regionId ? ' in this area' : '') + '</b>' +
        '<p>' + (isCust ? 'Add a shop, or clear the area filter.' : 'Add a supplier first.') + '</p></div>';
    }
    if (!list.some(function (p) { return p.id === SOA.partyId; })) SOA.partyId = list[0].id;
    var party = list.filter(function (p) { return p.id === SOA.partyId; })[0];
    var L = ledgerFor(SOA.partyId);

    var movementIn = isCust ? L.debit : L.credit;    /* invoiced / purchased  — adds to what they owe */
    var movementOut = isCust ? L.credit : L.debit;   /* received / paid       — reduces it */

    var rows = L.rows.map(function (r) {
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
      '<div class="bar">' +
        '<label class="f"><span>Party type</span><select data-soaf="type">' +
          '<option value="CUSTOMER"' + (isCust ? ' selected' : '') + '>Customer</option>' +
          '<option value="SUPPLIER"' + (!isCust ? ' selected' : '') + '>Supplier</option>' +
        '</select></label>' +
        (isCust ? '<label class="f"><span>Area</span><select data-soaf="regionId">' + regionOptions() +
          '</select></label>' : '') +
        '<label class="f"><span>' + (isCust ? 'Shop' : 'Supplier') + '</span><select data-soaf="partyId">' +
          list.map(function (p) {
            return '<option value="' + p.id + '"' + (p.id === SOA.partyId ? ' selected' : '') + '>' +
              esc(partyName(p)) + '</option>';
          }).join('') + '</select></label>' +
        '<label class="f"><span>From</span><input type="date" data-soaf="from" value="' + esc(SOA.from) + '"></label>' +
        '<label class="f"><span>To</span><input type="date" data-soaf="to" value="' + esc(SOA.to) + '"></label>' +
        '<div class="grow"></div>' +
        '<button class="btn" data-soaprint>' + I('print') + 'Print / PDF</button>' +
        '<button class="btn pri" data-soaexcel>' + I('sheet') + 'Excel</button>' +
      '</div>' +

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
        (isCust && party.region && global.regionOf ? ' · ' + esc(global.regionOf(party.region).en) : '') +
        '</p>' : '') +

      (L.rows.length
        ? '<div class="tw" style="margin-top:12px"><table class="kh-table"><thead><tr>' +
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

  D.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-soaprint]')) {
      e.preventDefault();
      if (!SOA.partyId) return;
      var m = ERP.DocModel.statement(SOA.partyId, SOA.type, SOA.from || null, SOA.to || null);
      ERP.Viewer.open(m);
      ERP.Audit.detached({ action: 'Statement of account opened', entity: 'Report', entityId: 'soa',
        reason: SOA.type + ' ' + SOA.partyId });
      return;
    }
    if (e.target.closest('[data-soaexcel]')) {
      e.preventDefault();
      if (!SOA.partyId) return;
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
