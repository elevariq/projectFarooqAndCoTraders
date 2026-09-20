/* ══════════════════════════════════════════════════════════════════════════
   PAYMENT SEARCH — finding a payment quickly, and the Payments screen it drives

   Client request (2026-09-21): "the search bar of payment and invoice". The
   invoice list was done on 2026-09-19 (33-invoice-search.js); this is the
   same job for the Payments screen, whose search box did much less than it
   said:

     - its placeholder read "Search shop or reference…", but the row text it
       searched was only "<shop> <method>" — a reference (cheque / transaction
       number), a receipt number, an amount or a date could never be found;
     - it looked at the shop name as printed, one substring, so "ahmad ali" did
       not find "Ali Ahmad", and Urdu letter variants (ک/ك, ی/ي, ہ/ه) were
       different letters;
     - the Paid to shops list, the reversed vouchers and the "Receipts &
       vouchers" log below were not filtered by it at all, and the log stopped
       at the latest 200 payments with no way to reach older ones;
     - there was no date range beyond "This week / month / year", no amount
       range, no way to look for the payments made against one invoice.

   What this module does (rules are the ones of the invoice search, on purpose
   — the two boxes must behave the same way; the helpers come from
   ERP.InvoiceSearch.util):

     - One cached, normalised text index per payment, dropped whenever records
       change (Mirror.refresh). Fields kept apart so "Search in" can narrow the
       words: receipt / voucher no., shop or supplier (+ phone, owner, region),
       cheque / transaction reference, invoice or purchase no. it was applied
       to, amount, notes & other.
     - Every space-separated word must be found (AND, any order), substring
       match, Urdu/English folding. A shop is matched by the name written on
       the receipt AND by its current name (looked up at search time).
     - A date typed into the box (12/09/2026, 2026-09-12, 12 Sep 2026,
       Sep 2026, 09/2026) is a date FILTER, and the screen says how it read it.
     - Direction (received from shops / paid to shops / paid to suppliers),
       method, region, custom From–To dates, amount from–to, newest / oldest /
       highest / lowest first. Inputs that can never match (From after To,
       minimum above maximum) are said out loud rather than shown as a quietly
       empty list.
     - The three lists of the screen, and the reversed vouchers, are all drawn
       from the same result, so the box narrows everything at once. A list
       shows its first 100 rows and a button for the rest — nothing is
       unreachable any more. CSV exports every match.

   The Payments screen itself is drawn here (this module loads after
   06-wiring.js and replaces its PAGES.payments); the numbers, buttons and ids
   the earlier screen had are kept: data-fcpayopen (start a payment with no
   shop pre-selected), #fcPaidToShops, data-fcreceipt (open the document).
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, D = global.document;
var U = ERP.InvoiceSearch.util;
var norm = U.norm, joinN = U.joinN, compact = U.compact, hasTerm = U.hasTerm, SEP = U.SEP;

var esc = function (s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
var I = function (n) { return global.I ? global.I(n) : ''; };
function fmtDate(x) { return global.fmtDate ? global.fmtDate(x) : x; }

var SCOPES = [
  ['all',       'Everything'],
  ['number',    'Receipt / voucher no.'],
  ['party',     'Shop or supplier / phone'],
  ['reference', 'Cheque / reference no.'],
  ['invoice',   'Invoice / purchase no.'],
  ['amount',    'Amount'],
  ['notes',     'Notes & other']
];
var SCOPE_FIELD = { number: 'number', reference: 'reference', invoice: 'invoice', amount: 'amount', notes: 'other' };

var SORTS = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['high',   'Highest amount'],
  ['low',    'Lowest amount']
];

var DIRS = [
  ['all',   'All payments'],
  ['rec',   'Received from shops'],
  ['shops', 'Paid to shops'],
  ['sup',   'Paid to suppliers']
];

var PERIODS = [['all', 'All dates'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'],
               ['month', 'This month'], ['lastmonth', 'Last month'], ['last30', 'Last 30 days'],
               ['last90', 'Last 3 months'], ['year', 'This year'], ['lastyear', 'Last 12 months'],
               ['custom', 'Custom range…']];

var DEFAULTS = { q: '', scope: 'all', dir: 'all', method: 'all', period: 'all', from: '', to: '',
                 min: '', max: '', region: 'all', sort: 'newest' };

/* the screen's remembered state — every control writes straight into it */
var PL = ERP.PaymentList = Object.assign({ limit: {}, seen: null, notice: null }, DEFAULTS);

/* ══════════════════════════════════════════════════════════════════════════
   WHAT KIND OF PAYMENT IS THIS
   ══════════════════════════════════════════════════════════════════════════ */
/* the direction, whether or not it was later reversed */
function dirOf(p) {
  if (p.direction === 'IN') return 'rec';
  return p.partyType === 'CUSTOMER' ? 'shops' : 'sup';
}
/* the list it belongs on: a reversed payment is in none of the three */
function groupOf(p) { return p.status === 'REVERSED' ? 'rev' : dirOf(p); }
function typeLabel(p) {
  return ({ rec: 'Received from shop', shops: 'Paid to shop', sup: 'Paid to supplier' })[dirOf(p)];
}

/* ══════════════════════════════════════════════════════════════════════════
   THE INDEX
   ══════════════════════════════════════════════════════════════════════════ */
var cache = null, stamp = '', version = 0;

function build() {
  var S = ERP.S, out = {}, invById = {}, purById = {}, byPay = {};
  S.invoices.forEach(function (i) { invById[i.id] = i; });
  S.purchases.forEach(function (u) { purById[u.id] = u; });
  S.allocations.forEach(function (a) { (byPay[a.paymentId] = byPay[a.paymentId] || []).push(a); });
  S.payments.forEach(function (p) {
    var refs = [], applied = 0;
    (byPay[p.id] || []).forEach(function (a) {
      applied += a.amount || 0;
      var d = a.invoiceId ? invById[a.invoiceId] : purById[a.purchaseId];
      var no = d && (d.invoiceNumber || d.purchaseNumber);
      if (no) refs.push(no);
    });
    var total = M.toR(p.amount);
    var withPaisa = total % 1 ? [total.toFixed(2), Number(total).toLocaleString('en-US', { minimumFractionDigits: 2 })] : [];
    var e = {
      number: joinN([p.receiptNumber, compact(p.receiptNumber)]),
      party: joinN([p.partyNameSnapshot, p.partyOwnerSnapshot, p.regionSnapshot]),
      reference: joinN([p.reference, compact(p.reference)]),
      invoice: joinN(refs.reduce(function (a, no) { return a.concat([no, compact(no)]); }, [])),
      amount: joinN([String(total), Number(total).toLocaleString('en-US')].concat(withPaisa)),
      date: U.dateText(p.paymentDate),
      other: joinN([p.note, p.description, p.method, p.receivedBy, typeLabel(p),
                    ({ rec: 'receipt', shops: 'refund voucher', sup: 'voucher' })[dirOf(p)],
                    p.status === 'REVERSED' ? 'reversed cancelled ' + (p.reverseReason || '') : '']),
      refs: refs,
      onAccount: Math.max(0, p.amount - applied)
    };
    e.all = [e.number, e.party, e.reference, e.invoice, e.amount, e.date, e.other].filter(Boolean).join(SEP);
    out[p.id] = e;
  });
  return out;
}

function ensure(force) {
  var S = ERP.S, rev = 0;
  S.payments.forEach(function (p) { if (p.status === 'REVERSED') rev++; });    /* a reversal changes no length */
  var s = [S.payments.length, rev, S.allocations.length, S.invoices.length, S.purchases.length, version].join('.');
  if (!force && cache && s === stamp) return cache;
  cache = build(); stamp = s;
  return cache;
}
/* records change through one place, so that is where the index is dropped */
if (ERP.Mirror) {
  var origRefresh = ERP.Mirror.refresh;
  ERP.Mirror.refresh = function () {
    var r = origRefresh.apply(ERP.Mirror, arguments);
    version++;
    return r;
  };
}

/* The party's CURRENT name, phone, owner and region, by id at search time (not
   cached in the index) so a rename is seen at once; the name printed on the
   receipt is in the index already, and both are searched. */
function currentPartyText() {
  var memo = {};
  return function (p) {
    var key = p.partyType + ':' + p.partyId;
    if (memo[key] !== undefined) return memo[key];
    var t = '';
    if (p.partyType === 'CUSTOMER') {
      var c = global.custBy ? global.custBy(p.partyId) : null;
      if (c) t = joinN([c.sh, c.ow, c.nameUr, c.ph, compact(c.ph), c.wa, c.legacyCode,
                        global.regionTxt ? global.regionTxt(c.region) : '']);
    } else {
      var s = global.supOf ? global.supOf(p.partyId) : null;
      if (s) t = joinN([s.co, s.cp, s.ph, compact(s.ph), s.lo]);
    }
    return (memo[key] = t);
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   FILTERING
   ══════════════════════════════════════════════════════════════════════════ */
function presetRange(key) {
  return U.presetRange(key);
}

/* everything the matcher and the screen both need, worked out once per search;
   `problems` are inputs that can never match — said to the person */
function prepare(state) {
  var p = ERP.InvoiceSearch.parse(state.q);
  var scope = (state.scope === 'party' || SCOPE_FIELD[state.scope]) ? state.scope : 'all';
  var problems = [], ranges = null;
  if (p.dates.length) {
    ranges = p.dates;                                   /* a typed date replaces the date filter */
  } else if (state.period === 'custom') {
    var f = U.validISO(state.from), t = U.validISO(state.to);
    if (f && t && f > t) problems.push('The “From” date is after the “To” date, so no payment can match.');
    if (f || t) ranges = [{ from: f || null, to: t || null }];
  } else if (state.period && state.period !== 'all') {
    var r = presetRange(state.period);
    if (r && (r[0] || r[1])) ranges = [{ from: r[0], to: r[1] }];
  }
  var minP = ERP.InvoiceSearch.toPaisa(state.min), maxP = ERP.InvoiceSearch.toPaisa(state.max);
  if (minP !== null && maxP !== null && minP > maxP) {
    problems.push('The minimum amount is above the maximum, so no payment can match.');
  }
  return { p: p, scope: scope, ranges: ranges, minP: minP, maxP: maxP, problems: problems };
}

function matcher(state) {
  var pr = prepare(state), idx = ensure(), terms = pr.p.terms;
  var cur = (pr.scope === 'all' || pr.scope === 'party') && terms.length ? currentPartyText() : null;
  return function (p) {
    if (pr.problems.length) return false;
    if (state.dir && state.dir !== 'all' && dirOf(p) !== state.dir) return false;
    if (state.method && state.method !== 'all' && p.method !== state.method) return false;
    if (state.region && state.region !== 'all') {
      /* a region belongs to a shop; a supplier has none, so it cannot pass */
      var c = p.partyType === 'CUSTOMER' && global.custBy ? global.custBy(p.partyId) : null;
      if (!c || c.region !== state.region) return false;
    }
    if (pr.ranges) {
      var d = p.paymentDate, ok = false;
      for (var k = 0; k < pr.ranges.length && !ok; k++) {
        var r = pr.ranges[k];
        ok = (!r.from || d >= r.from) && (!r.to || d <= r.to);
      }
      if (!ok) return false;
    }
    if (pr.minP !== null && p.amount < pr.minP) return false;
    if (pr.maxP !== null && p.amount > pr.maxP) return false;
    if (terms.length) {
      var e = idx[p.id];
      if (!e) { idx = ensure(true); e = idx[p.id]; if (!e) return false; }
      var hays = pr.scope === 'all' ? [e.all, cur(p)]
               : pr.scope === 'party' ? [e.party, cur(p)]
               : [e[SCOPE_FIELD[pr.scope]]];
      for (var j = 0; j < terms.length; j++) if (!hasTerm(hays, terms[j])) return false;
    }
    return true;
  };
}

function sortList(list, key) {
  function newer(a, b) {                               /* > 0 when a is newer than b */
    if (a.paymentDate !== b.paymentDate) return a.paymentDate < b.paymentDate ? -1 : 1;
    var x = a.createdAt || '', y = b.createdAt || '';
    if (x !== y) return x < y ? -1 : 1;
    return String(a.receiptNumber || '') < String(b.receiptNumber || '') ? -1 : 1;
  }
  var cmp;
  if (key === 'oldest') cmp = newer;
  else if (key === 'high') cmp = function (a, b) { return (b.amount - a.amount) || newer(b, a); };
  else if (key === 'low') cmp = function (a, b) { return (a.amount - b.amount) || newer(b, a); };
  else cmp = function (a, b) { return newer(b, a); };
  return list.sort(cmp);
}

/* The one result the whole screen, the totals and the CSV read. */
function results(state) {
  var S = ERP.S;
  var list = sortList(S.payments.filter(matcher(state)), state.sort);
  var groups = { rec: [], shops: [], sup: [], rev: [] }, sums = { rec: 0, shops: 0, sup: 0, rev: 0 };
  list.forEach(function (p) { var g = groupOf(p); groups[g].push(p); sums[g] += p.amount; });
  var whole = { rec: 0, shops: 0, sup: 0, rev: 0 }, wholeSum = { rec: 0, shops: 0, sup: 0, rev: 0 };
  S.payments.forEach(function (p) { var g = groupOf(p); whole[g]++; wholeSum[g] += p.amount; });
  return { list: list, groups: groups, sums: sums, whole: whole, wholeSum: wholeSum };
}

function describe(state) {
  var pr = prepare(state), notes = [];
  pr.p.dates.forEach(function (d) {
    var span = d.from === d.to ? d.label : 'all of ' + d.label;
    notes.push('“' + d.src + '” is read as ' + span + (d.dayFirst ? ' (day / month / year)' : '') +
      (state.period && state.period !== 'all' ? ' — this replaces the date filter' : '') + '.');
  });
  if (state.region && state.region !== 'all') {
    notes.push('A region belongs to a shop, so payments to suppliers are left out while one is chosen.');
  }
  return { notes: notes, problems: pr.problems, words: pr.p.terms };
}

function active(state) {
  return !!(String(state.q || '').trim() || (state.period && state.period !== 'all') ||
    (state.dir && state.dir !== 'all') || (state.method && state.method !== 'all') ||
    (state.region && state.region !== 'all') ||
    String(state.min || '').trim() || String(state.max || '').trim());
}
function reset(state) {
  var keep = state.sort;
  Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
  state.sort = keep || DEFAULTS.sort;
  state.limit = {}; state.notice = null;
  return state;
}

/* the receipts of a payment for the "Applied to" column and the CSV */
function appliedTo(p) {
  var e = ensure()[p.id] || { refs: [], onAccount: p.amount };
  return e;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE SCREEN
   ══════════════════════════════════════════════════════════════════════════ */
function options(pairs, cur) {
  return pairs.map(function (p) {
    return '<option value="' + esc(p[0]) + '"' + (cur === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
  }).join('');
}

function methods() {
  var seen = {}, out = [];
  (ERP.ENUM && ERP.ENUM.methods || []).concat(ERP.S.payments.map(function (p) { return p.method; }))
    .forEach(function (m) { if (m && !seen[m]) { seen[m] = 1; out.push([m, m]); } });
  return out;
}

function appliedCell(p) {
  var a = appliedTo(p);
  if (!a.refs.length) return '<span class="sub">' + (p.direction === 'IN' ? 'On account' : '—') + '</span>';
  return '<span class="mono">' + a.refs.slice(0, 3).map(esc).join(', ') + '</span>' +
    (a.refs.length > 3 ? ' <span class="sub">+' + (a.refs.length - 3) + ' more</span>' : '') +
    (a.onAccount > 0 && p.direction === 'IN' ? '<div class="sub">+ ' + M.fmtPlain(a.onAccount) + ' on account</div>' : '');
}
function refCell(p) {
  return '<span class="mono">' + esc(p.reference || '—') + '</span>' +
    (p.note ? '<div class="sub">' + esc(p.note.length > 60 ? p.note.slice(0, 57) + '…' : p.note) + '</div>' : '');
}
function shopCell(p) {
  var c = global.custBy ? global.custBy(p.partyId) : null;
  var name = c ? c.sh : p.partyNameSnapshot;
  return (c ? '<button class="lnk" data-cust="' + esc(c.id) + '">' + esc(name || '—') + '</button>' : esc(name || '—')) +
    (p.partyOwnerSnapshot ? '<div class="sub">' + esc(p.partyOwnerSnapshot) + '</div>' : '');
}
function regionCell(p) {
  var c = global.custBy ? global.custBy(p.partyId) : null;
  return global.regionLbl ? global.regionLbl(c ? c.region : null) : '—';
}
function docBtn(p, label) {
  return '<button class="btn sm" data-fcreceipt="' + esc(p.id) + '">' + I('doc') + label + '</button>';
}

/* "Show more" under a list that has more rows than it draws */
function moreBar(key, shown, of) {
  if (of <= shown) return '';
  return '<div class="fcb-count" style="margin:10px 12px"><span>Showing the first <b>' + shown + '</b> of <b>' + of +
    '</b> — narrow the search, or</span><button class="btn sm" data-fcpact="more" data-sec="' + key + '">Show ' +
    Math.min(pageRows(), of - shown) + ' more</button></div>';
}
/* rows a list shows before "Show more" (a property so a test can shrink it) */
function pageRows() { return ERP.PaymentSearch.PAGE_ROWS; }
function limitOf(key) { return PL.limit[key] || pageRows(); }

/* "Paid to shops  3 of 12 payments · Rs 45,000" — the count follows the search,
   the total is of what is listed */
function heading(title, noun, count, whole, sum, filtering, buttons) {
  var n = filtering ? whole : count;
  return '<div class="sec-t">' + title + ' <span>' + (filtering ? count + ' of ' + whole : count) + ' ' + noun +
    (n === 1 ? '' : 's') + (count ? ' · ' + M.fmtPlain(sum) : '') + '</span>' + buttons + '</div>';
}

function section(key, list, whole, filtering, emptyIdle, emptyFiltered, cols, rowFn, extraId) {
  var lim = limitOf(key), shown = list.slice(0, lim);
  return '<div class="card"' + (extraId ? ' id="' + extraId + '"' : '') + '>' + (list.length
    ? '<div class="tw"><table class="fcb-list"><thead><tr>' + cols + '</tr></thead><tbody>' +
      shown.map(rowFn).join('') + '</tbody></table></div>' + moreBar(key, shown.length, list.length)
    : '<div class="card-b"><p class="hint">' + (filtering && whole ? emptyFiltered : emptyIdle) + '</p></div>') + '</div>';
}

global.PAGES.payments = function () {
  var r = results(PL), filtering = active(PL), info = describe(PL);
  var g = r.groups, S = ERP.S;

  /* A payment recorded while a search or filter is on can be one that filter hides: it would seem not to have
     been saved. Say so (until the person next changes a control). */
  var shown = {}; r.list.forEach(function (p) { shown[p.id] = 1; });
  var fresh = [];
  if (PL.seen) S.payments.forEach(function (p) { if (!PL.seen[p.id] && !shown[p.id]) fresh.push(p.receiptNumber); });
  PL.seen = {}; S.payments.forEach(function (p) { PL.seen[p.id] = 1; });
  if (fresh.length && filtering) PL.notice = fresh;
  else if (!filtering) PL.notice = null;
  var show = function (k) { return PL.dir === 'all' || PL.dir === k; };

  /* ── the four figures ── */
  var recv = (global.CUSTOMERS || []).reduce(function (a, c) { return a + (c.bal || 0); }, 0);
  var pay = (global.SUPPLIERS || []).reduce(function (a, s) { return a + (s.due || 0); }, 0);
  var out = r.sums.shops + r.sums.sup;
  var kpis = '<div class="ledger l4">' +
    '<div class="kpi"><div class="k">' + I('checkC') + 'Received</div><div class="v">' +
      (r.sums.rec ? M.fmt(r.sums.rec) : '—') + '</div><div class="d">' + g.rec.length + ' receipt' + (g.rec.length === 1 ? '' : 's') +
      (filtering ? ' in this search' : '') + '</div></div>' +
    '<div class="kpi"><div class="k">' + I('clock') + 'Receivable</div><div class="v">' +
      (recv ? M.fmt(M.toP(recv)) : '—') + '</div><div class="d">From shops</div></div>' +
    '<div class="kpi"><div class="k">' + I('mill') + 'Payable</div><div class="v">' +
      (pay ? M.fmt(M.toP(pay)) : '—') + '</div><div class="d">To suppliers</div></div>' +
    '<div class="kpi"><div class="k">' + I('wallet') + 'Paid out</div><div class="v">' + (out ? M.fmt(out) : '—') +
      '</div><div class="d">' + g.sup.length + ' to suppliers · ' + g.shops.length + ' to shops' +
      (filtering ? ' in this search' : '') + '</div></div>' +
  '</div>';

  /* ── the search bar and the filters ── */
  var regions = (global.REGIONS || []).map(function (rg) {
    return '<option value="' + esc(rg.id) + '"' + (PL.region === rg.id ? ' selected' : '') + '>' + esc(rg.en) +
      (rg.deleted ? ' (deleted)' : '') + '</option>';
  }).join('');
  var bars =
    '<div class="bar">' +
      '<div class="tsearch fcb-psearch">' + I('search') +
        '<input placeholder="Receipt no., shop, phone, reference, amount, date…" ' +
        'title="Find a payment by receipt or voucher number, shop or supplier, phone, cheque / transaction reference, ' +
        'amount, a date such as 12/09/2026, or the invoice it was applied to" ' +
        'data-fcpq value="' + esc(PL.q) + '" autocomplete="off" spellcheck="false" aria-label="Search payments"></div>' +
      '<label class="fld" title="Which part of a payment the words are looked for in">' + I('filter') +
        '<select data-fcpfil="scope" aria-label="Search in">' + options(SCOPES.map(function (s) {
          return [s[0], s[0] === 'all' ? 'Search: everything' : 'Search: ' + s[1]];
        }), PL.scope) + '</select></label>' +
      '<label class="fld" title="Order of the lists">' + I('chart') +
        '<select data-fcpfil="sort" aria-label="Sort by">' + options(SORTS, PL.sort) + '</select></label>' +
      '<div class="grow"></div>' +
      '<button class="btn" data-fcpact="csv">' + I('sheet') + 'CSV</button>' +
      '<button class="btn" data-export="print">' + I('print') + 'Print</button>' +
    '</div>' +
    '<div class="bar fcb-filters">' +
      '<label class="fld">' + I('wallet') + '<select data-fcpfil="dir" aria-label="Kind of payment">' + options(DIRS, PL.dir) + '</select></label>' +
      '<label class="fld">' + I('cal') + '<select data-fcpfil="period" aria-label="Date">' + options(PERIODS, PL.period) + '</select></label>' +
      (PL.period === 'custom'
        ? '<label class="f"><span>From</span><input type="date" data-fcpfil="from" value="' + esc(PL.from) + '"></label>' +
          '<label class="f"><span>To</span><input type="date" data-fcpfil="to" value="' + esc(PL.to) + '"></label>'
        : '') +
      '<label class="fld">' + I('layers') + '<select data-fcpfil="method" aria-label="Method"><option value="all">All methods</option>' +
        options(methods(), PL.method) + '</select></label>' +
      '<label class="fld">' + I('pin') + '<select data-fcpfil="region" aria-label="Region"><option value="all">All regions</option>' +
        regions + '</select></label>' +
      '<label class="f"><span>Amount from</span><input inputmode="decimal" data-fcpfil="min" placeholder="0" value="' + esc(PL.min) + '"></label>' +
      '<label class="f"><span>Amount to</span><input inputmode="decimal" data-fcpfil="max" placeholder="any" value="' + esc(PL.max) + '"></label>' +
      (filtering ? '<button class="btn" data-fcpact="clear">Clear filters</button>' : '') +
    '</div>' +
    (PL.notice && filtering
      ? '<div class="fcb-note warn">' + I('alert') + '<span>' + (PL.notice.length === 1 ? 'The payment you just recorded, ' : PL.notice.length + ' payments just recorded, ') +
        '<b>' + PL.notice.slice(0, 3).map(esc).join(', ') + (PL.notice.length > 3 ? '…' : '') + '</b>, ' +
        (PL.notice.length === 1 ? 'is' : 'are') + ' saved but hidden by the search or filters above. ' +
        '<button class="btn sm" data-fcpact="clear">Clear filters</button></span></div>' : '') +
    info.problems.map(function (m) { return '<div class="fcb-note warn">' + I('alert') + '<span>' + esc(m) + '</span></div>'; }).join('') +
    info.notes.map(function (m) { return '<div class="fcb-note">' + I('cal') + '<span>' + esc(m) + '</span></div>'; }).join('');

  var everything = S.payments.length;
  var countLine = '<div class="fcb-count"><span>' + (filtering
    ? '<b>' + r.list.length + '</b> of ' + everything + ' payment' + (everything === 1 ? '' : 's') + ' match' +
      (r.list.length ? '' : ' — nothing on file fits these words and filters. Try fewer words, widen the dates, or search in “Everything”.')
    : '<b>' + everything + '</b> payment' + (everything === 1 ? '' : 's') + ' on file') + '</span>' +
    (filtering && !r.list.length ? '<button class="btn sm" data-fcpact="clear">Clear filters</button>' : '') + '</div>';

  /* ── Customer payments (money received) ── */
  var html = kpis + bars + countLine;
  if (show('rec')) {
    html += heading('Customer payments', 'receipt', g.rec.length, r.whole.rec, r.sums.rec, filtering,
        '<div class="r"><span style="display:inline-flex;flex-wrap:wrap;gap:8px;justify-content:flex-end">' +
        '<button class="btn sm pri" data-fcpayopen="payment">' + I('plus') + 'Receive payment</button>' +
        '<button class="btn sm" data-fcpayopen="refund">' + I('wallet') + 'Pay a shop</button></span></div>') +
      section('rec', g.rec, r.whole.rec, filtering,
        'No payments received yet. Money received from shops will be recorded here.',
        'No received payment matches these words and filters.',
        '<th>Receipt no.</th><th>Date</th><th>Shop</th><th>Region</th><th>Method</th><th class="r">Amount</th><th>Reference</th>' +
        '<th>Applied to</th><th class="r">Receipt</th>',
        function (p) {
          return '<tr><td data-label="Receipt no." class="fcb-key mono">' + esc(p.receiptNumber) + '</td>' +
            '<td data-label="Date">' + esc(fmtDate(p.paymentDate)) + '</td>' +
            '<td data-label="Shop" class="t-main">' + shopCell(p) + '</td>' +
            '<td data-label="Region">' + regionCell(p) + '</td>' +
            '<td data-label="Method">' + esc(p.method) + '</td>' +
            '<td data-label="Amount" class="num r"><b>' + M.fmtPlain(p.amount) + '</b></td>' +
            '<td data-label="Reference">' + refCell(p) + '</td>' +
            '<td data-label="Applied to">' + appliedCell(p) + '</td>' +
            '<td class="r fcb-rowacts">' + docBtn(p, 'Receipt') + '</td></tr>';
        });
  }

  /* ── Paid to shops (the client's 2026-09-20 request; keeps its id and its wording) ── */
  if (show('shops')) {
    html += heading('Paid to shops', 'payment', g.shops.length, r.whole.shops, r.sums.shops, filtering,
        '<div class="r"><button class="btn sm pri" data-fcpayopen="refund">' + I('plus') + 'Pay a shop</button></div>') +
      (g.shops.length || filtering && r.whole.shops
        ? section('shops', g.shops, r.whole.shops, filtering, '', 'No payment to a shop matches these words and filters.',
          '<th>Voucher no.</th><th>Date</th><th>Shop</th><th>Region</th><th>Method</th><th class="r">Amount</th><th>Reference</th><th class="r">Voucher</th>',
          function (p) {
            return '<tr><td data-label="Voucher no." class="fcb-key mono">' + esc(p.receiptNumber) + '</td>' +
              '<td data-label="Date">' + esc(fmtDate(p.paymentDate)) + '</td>' +
              '<td data-label="Shop" class="t-main">' + shopCell(p) + '</td>' +
              '<td data-label="Region">' + regionCell(p) + '</td>' +
              '<td data-label="Method">' + esc(p.method) + '</td>' +
              '<td data-label="Amount" class="num r"><b>' + M.fmtPlain(p.amount) + '</b></td>' +
              '<td data-label="Reference">' + refCell(p) + '</td>' +
              '<td class="r fcb-rowacts">' + docBtn(p, 'Voucher') + '</td></tr>';
          }, 'fcPaidToShops')
        : '<div class="card" id="fcPaidToShops"><div class="card-b"><p class="hint">No payments to shops yet. Use “Pay a shop” when you hand a shop cash ' +
          'or return money — a numbered voucher is made for every payment.</p></div></div>');
  }

  /* ── Supplier payments ── */
  if (show('sup')) {
    html += heading('Supplier payments', 'payment', g.sup.length, r.whole.sup, r.sums.sup, filtering,
        '<div class="r"><button class="btn sm" data-fcpayopen="paysup">' + I('plus') + 'Pay supplier</button></div>') +
      section('sup', g.sup, r.whole.sup, filtering,
        'No supplier payments yet. Payments made to the mills will be recorded here.',
        'No supplier payment matches these words and filters.',
        '<th>Voucher no.</th><th>Date</th><th>Supplier</th><th>Method</th><th class="r">Amount</th><th>Reference</th><th>Applied to</th><th class="r">Voucher</th>',
        function (p) {
          var s = global.supOf ? global.supOf(p.partyId) : null;
          return '<tr><td data-label="Voucher no." class="fcb-key mono">' + esc(p.receiptNumber) + '</td>' +
            '<td data-label="Date">' + esc(fmtDate(p.paymentDate)) + '</td>' +
            '<td data-label="Supplier" class="t-main">' + esc(s ? s.co : (p.partyNameSnapshot || '—')) + '</td>' +
            '<td data-label="Method">' + esc(p.method) + '</td>' +
            '<td data-label="Amount" class="num r"><b>' + M.fmtPlain(p.amount) + '</b></td>' +
            '<td data-label="Reference">' + refCell(p) + '</td>' +
            '<td data-label="Applied to">' + appliedCell(p) + '</td>' +
            '<td class="r fcb-rowacts">' + docBtn(p, 'Voucher') + '</td></tr>';
        });
  }

  /* ── Reversed — only when there are some (they count in no total above) ── */
  if (g.rev.length) {
    html += '<div class="sec-t">Reversed receipts &amp; vouchers <span>' + g.rev.length +
        (filtering ? ' of ' + r.whole.rev : '') + ' · counted in no total</span></div>' +
      section('rev', g.rev, r.whole.rev, filtering, '', '',
        '<th>Number</th><th>Date</th><th>Party</th><th>Kind</th><th>Method</th><th class="r">Amount</th><th>Reference</th>' +
        '<th>Why reversed</th><th class="r">Document</th>',
        function (p) {
          return '<tr><td data-label="Number" class="fcb-key mono">' + esc(p.receiptNumber) + '</td>' +
            '<td data-label="Date">' + esc(fmtDate(p.paymentDate)) + '</td>' +
            '<td data-label="Party">' + esc(p.partyNameSnapshot || '—') + '</td>' +
            '<td data-label="Kind">' + esc(typeLabel(p)) + '</td>' +
            '<td data-label="Method">' + esc(p.method) + '</td>' +
            '<td data-label="Amount" class="num r"><s>' + M.fmtPlain(p.amount) + '</s></td>' +
            '<td data-label="Reference">' + refCell(p) + '</td>' +
            '<td data-label="Why reversed">' + esc(p.reverseReason || '—') + '</td>' +
            '<td class="r fcb-rowacts">' + docBtn(p, 'Open') + '</td></tr>';
        });
  }
  return html;
};

/* ══════════════════════════════════════════════════════════════════════════
   CSV — every match, not just the rows on the screen
   ══════════════════════════════════════════════════════════════════════════ */
PL.exportCsv = function () {
  var rows = [['Number', 'Date', 'Kind', 'Party', 'Owner / contact', 'Region', 'Method', 'Amount', 'Reference',
               'Applied to', 'On account', 'Note', 'Status', 'Why reversed']];
  results(PL).list.forEach(function (p) {
    var a = appliedTo(p), c = p.partyType === 'CUSTOMER' && global.custBy ? global.custBy(p.partyId) : null;
    rows.push([p.receiptNumber, p.paymentDate, typeLabel(p), p.partyNameSnapshot, p.partyOwnerSnapshot,
      p.regionSnapshot || (c && global.regionTxt ? global.regionTxt(c.region) : ''), p.method, M.toR(p.amount),
      p.reference, a.refs.join(' '), M.toR(a.onAccount), p.note,
      p.status === 'REVERSED' ? 'Reversed' : 'Posted', p.reverseReason]);
  });
  var csv = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c === undefined || c === null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var blob = new global.Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var a = D.createElement('a');
  a.href = global.URL.createObjectURL(blob);
  a.download = 'farooq-co-payments-' + (global.todayISO ? global.todayISO() : new Date().toISOString().slice(0, 10)) + '.csv';
  D.body.appendChild(a); a.click();
  setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

/* the base search box is a fixed 280px; on a desktop this one may grow into the free
   space so its hint is not cut off (on a phone the base rule makes it full width) */
(function () {
  if (!D || D.getElementById('fc-paysearch-css')) return;
  var st = D.createElement('style'); st.id = 'fc-paysearch-css';
  st.textContent = '@media (min-width:761px){.tsearch.fcb-psearch{flex:1 1 340px;width:auto;max-width:560px}}';
  D.head.appendChild(st);
})();

/* ══════════════════════════════════════════════════════════════════════════
   EVENTS
   ══════════════════════════════════════════════════════════════════════════ */
var timer = null;
/* Repaint the screen after a keystroke or a choice, and put the cursor back
   where it was — the page is redrawn, so the box would otherwise lose focus. */
function repaint(delay) {
  clearTimeout(timer);
  timer = setTimeout(function () {
    if (global.cur !== 'payments') return;
    var f = D.activeElement, sel = null, key = null;
    if (f && f.dataset) {
      if (f.dataset.fcpq !== undefined) key = '[data-fcpq]';
      else if (f.dataset.fcpfil) key = '[data-fcpfil="' + f.dataset.fcpfil + '"]';
      try { sel = f.selectionStart; } catch (e) { sel = null; }
    }
    global.paint();
    if (key) {
      var el = D.querySelector(key);
      if (el) { el.focus(); if (sel !== null) { try { el.setSelectionRange(sel, sel); } catch (e) {} } }
    }
  }, delay);
}

D.addEventListener('input', function (e) {
  var el = e.target, ds = el && el.dataset;
  if (!ds) return;
  if (ds.fcpq !== undefined) { PL.q = el.value; PL.limit = {}; PL.notice = null; repaint(160); return; }
  /* the two amount boxes are typed into, so they follow the keys like the search box */
  if (ds.fcpfil === 'min' || ds.fcpfil === 'max') { PL[ds.fcpfil] = el.value; PL.limit = {}; PL.notice = null; repaint(160); }
});
D.addEventListener('change', function (e) {
  var el = e.target, ds = el && el.dataset;
  if (!ds || !ds.fcpfil) return;
  PL[ds.fcpfil] = el.value;
  PL.notice = null;
  if (ds.fcpfil !== 'sort') PL.limit = {};              /* a new order keeps its place; a new filter starts over */
  repaint(0);
});
D.addEventListener('click', function (e) {
  var b = e.target && e.target.closest ? e.target.closest('[data-fcpact]') : null;
  if (!b) return;
  e.preventDefault();
  var a = b.dataset.fcpact;
  if (a === 'clear') { reset(PL); global.paint(); return; }
  if (a === 'csv') { PL.exportCsv(); return; }
  if (a === 'more') {
    var k = b.dataset.sec;
    PL.limit[k] = limitOf(k) + pageRows();
    global.paint();
  }
});

ERP.PaymentSearch = {
  SCOPES: SCOPES, SORTS: SORTS, DIRS: DIRS, DEFAULTS: DEFAULTS, PAGE_ROWS: 100,
  matcher: matcher, results: results, describe: describe, active: active, reset: reset, index: ensure,
  groupOf: groupOf, dirOf: dirOf
};
})(typeof window !== 'undefined' ? window : globalThis);
