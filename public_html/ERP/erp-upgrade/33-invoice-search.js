/* ══════════════════════════════════════════════════════════════════════════
   INVOICE SEARCH — finding an old invoice quickly

   Client request (2026-09-19): "add a search option to find old invoices
   easily by Invoice Number, Customer Name, Date, or Product Name or any
   other."

   The Sales & invoices screen already had a search box, but it was a single
   substring test over one glued-together string, run per keystroke with a
   full scan of the line-items table for every invoice. It could not find by
   date (the date was never in the searched text, and the custom date range
   the code half-supported had no controls), treated Urdu letter variants as
   different letters, and rendered every invoice as a table row. This module
   is the engine that replaces it; the screen itself lives in 05-ui-builder.js
   (§37–39) and calls into ERP.InvoiceSearch.

     - One cached, normalised text index per invoice, built in a single pass
       and dropped whenever records change (Mirror.refresh), the same way
       11-search.js keeps its palette index warm. The Urdu/English folding is
       11-search's own ERP.Search.normalize, so ک/ك, ی/ي, ہ/ه and Arabic-Indic
       digits all match each other.
     - Every space-separated word in the box must be found (AND, any order):
       "zam zam sella" finds an invoice for that shop that carries that
       product. A hyphenated number stays together ("INV-2026-000123").
     - "Search in" narrows those words to one kind of field — invoice /
       order / dispatch / reference number, customer & phone, product,
       amount, or notes — so "Taj" can mean the shop or the brand on purpose.
     - A date typed into the box (12/09/2026, 2026-09-12, 12 Sep 2026,
       Sep 2026, 09/2026) is read as a date FILTER, not as text, and the
       screen says how it was read. Numeric dates are day-first (Pakistan);
       a month-first reading is only tried when day-first is impossible.
     - Customer names are matched against both the name printed on the
       invoice (the snapshot — it never changes) and the shop's current
       name, so an old invoice is found by either.

   Deliberately NOT done here: fuzzy/typo matching (11-search's palette does
   that; a filter list has to be predictable), a saved-searches feature, and
   searching inside the invoice's hand-edited print text (12-invoice-editor).
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, M = global.Money, D = global.document;

/* separates fields (and separate product lines) inside one index string; a
   search word can never contain it, so a word can never straddle two fields */
var SEP = '\u0001';

var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
              'october', 'november', 'december'];
var MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|' +
               'sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

var SCOPES = [
  ['all',      'Everything'],
  ['number',   'Invoice / order no.'],
  ['customer', 'Customer / phone'],
  ['product',  'Product'],
  ['amount',   'Amount'],
  ['notes',    'Notes & other']
];
var SCOPE_FIELD = { number: 'number', product: 'product', amount: 'amount', notes: 'other' };

var SORTS = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['high',   'Highest total'],
  ['low',    'Lowest total'],
  ['due',    'Highest balance due']
];

var DEFAULTS = { q: '', scope: 'all', period: 'all', from: '', to: '', min: '', max: '',
                 status: 'all', region: 'all', wh: 'all', sort: 'newest', page: 1 };

/* ══════════════════════════════════════════════════════════════════════════
   SMALL HELPERS
   ══════════════════════════════════════════════════════════════════════════ */
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isoOf(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
function isoLocal(d) { return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function daysIn(y, m) { return new Date(y, m, 0).getDate(); }
function today() { return global.todayISO ? global.todayISO() : isoLocal(new Date()); }
function labelDate(iso) { return global.fmtDate ? global.fmtDate(iso) : iso; }
function validISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : ''; }

function norm(s) {
  if (ERP.Search && ERP.Search.normalize) return ERP.Search.normalize(s);
  return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
/* every non-empty part folded, then joined so no search word can span two parts */
function joinN(parts) {
  var out = [];
  parts.forEach(function (p) { var n = norm(p); if (n) out.push(n); });
  return out.join(SEP);
}
function compact(s) { return norm(s).replace(/ /g, ''); }

function toPaisa(v) {
  if (v === undefined || v === null) return null;
  var s = String(v).replace(/[,\s]|pkr|rs\.?/gi, '');
  if (!s) return null;
  var n = Number(s);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   DATES TYPED INTO THE SEARCH BOX
   ══════════════════════════════════════════════════════════════════════════ */
function dayRange(y, m, d, src, dayFirst) {
  y = +y; m = +m; d = +d;
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  var iso = isoOf(y, m, d);
  return { from: iso, to: iso, label: labelDate(iso), src: src, dayFirst: !!dayFirst };
}
function monthRange(y, m, src) {
  y = +y; m = +m;
  if (y < 1990 || y > 2100 || m < 1 || m > 12) return null;
  return { from: isoOf(y, m, 1), to: isoOf(y, m, daysIn(y, m)), label: MON3[m - 1] + ' ' + y, src: src };
}
function monthNo(word) { return MON3.map(function (x) { return x.toLowerCase(); }).indexOf(word.toLowerCase().slice(0, 3)) + 1; }

/* Pull the dates out of the box, leaving the rest as search words. */
function parse(raw) {
  var s = String(raw === null || raw === undefined ? '' : raw), dates = [];
  /* Arabic-Indic (٠-٩) and Persian/Urdu (۰-۹) digits become 0-9 first, so a
     date typed on an Urdu keyboard is read as a date like any other */
  s = s.replace(/[٠-٩۰-۹]/g, function (c) {
    var k = c.charCodeAt(0);
    return String(k >= 0x06F0 ? k - 0x06F0 : k - 0x0660);
  });
  /* `build` declares one parameter per capture group, then `src`; replace()
     also passes the match offset and whole string, which must not leak in */
  function take(re, build) {
    var groups = build.length - 1;
    s = s.replace(re, function (m) {
      var args = Array.prototype.slice.call(arguments, 1, 1 + groups);
      var r = build.apply(null, args.concat([m.trim()]));
      if (!r) return m;                              /* not a real date — keep it as text */
      dates.push(r);
      return ' ';
    });
  }
  var MR = '(' + MONTH_RE + ')';
  /* 2026-09-12 · 2026/09/12 */
  take(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/g, function (y, m, d, src) { return dayRange(y, m, d, src); });
  /* 12/09/2026 · 12-09-26 — day first; month first only when that is the sole valid reading */
  take(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})\b/g, function (a, b, y, src) {
    return dayRange(y, b, a, src, true) || dayRange(y, a, b, src, false);
  });
  /* 12 Sep 2026 · 12th September, 2026 */
  take(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*' + MR + '(?![a-z])\\.?,?[\\s-]*(\\d{4})\\b', 'gi'),
    function (d, mon, y, src) { return dayRange(y, monthNo(mon), d, src); });
  /* Sep 12, 2026 */
  take(new RegExp('\\b' + MR + '(?![a-z])\\.?[\\s-]*(\\d{1,2})(?:st|nd|rd|th)?,?[\\s-]+(\\d{4})\\b', 'gi'),
    function (mon, d, y, src) { return dayRange(y, monthNo(mon), d, src); });
  /* Sep 2026 · September 2026 */
  take(new RegExp('\\b' + MR + '(?![a-z])\\.?,?[\\s-]*(\\d{4})\\b', 'gi'),
    function (mon, y, src) { return monthRange(y, monthNo(mon), src); });
  /* 2026 Sep */
  take(new RegExp('\\b(\\d{4})[\\s-]+' + MR + '(?![a-z])', 'gi'),
    function (y, mon, src) { return monthRange(y, monthNo(mon), src); });
  /* 2026-09 · 09/2026 — only as a word of their own: the tail of a number
     such as INV-2026-12 must stay text */
  take(/(^|[\s,;])(\d{4})-(\d{1,2})(?=$|[\s,;])/g, function (pre, y, m, src) { return monthRange(y, m, src); });
  take(/(^|[\s,;])(\d{1,2})[\/.](\d{4})(?=$|[\s,;])/g, function (pre, m, y, src) { return monthRange(y, m, src); });

  var terms = s.split(/\s+/).map(norm).filter(Boolean);
  return { terms: terms, dates: dates };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE INDEX
   ══════════════════════════════════════════════════════════════════════════ */
var cache = null, stamp = '', version = 0;

function dateText(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  var mo = +m[2], d = +m[3];
  return joinN([iso, d + ' ' + MON3[mo - 1] + ' ' + m[1], MONTHS[mo - 1],
                pad2(d) + ' ' + m[2] + ' ' + m[1], d + ' ' + mo + ' ' + m[1]]);
}

function build() {
  var S = ERP.S, byInv = {}, out = {};
  S.invoiceItems.forEach(function (it) { (byInv[it.invoiceId] = byInv[it.invoiceId] || []).push(it); });
  S.invoices.forEach(function (i) {
    var items = (byInv[i.id] || []).slice().sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    var lines = items.map(function (x) {
      return { n: norm([x.descriptionEnSnapshot, x.descriptionSnapshot, x.brandSnapshot].filter(Boolean).join(' ')),
               name: x.descriptionEnSnapshot || x.descriptionSnapshot || '', qty: x.quantity };
    });
    var total = M.toR(i.grandTotal);
    /* a total with paisa is also findable as typed, "25000.50" (String() drops the zero) */
    var withPaisa = total % 1 ? [total.toFixed(2), Number(total).toLocaleString('en-US', { minimumFractionDigits: 2 })] : [];
    var e = {
      number: joinN([i.invoiceNumber, compact(i.invoiceNumber), i.orderNumber, i.dispatchNumber, i.referenceNo]),
      customer: joinN([i.shopNameSnapshot, i.customerNameSnapshot, i.mobileSnapshot, compact(i.mobileSnapshot),
                       i.regionSnapshot]),
      product: lines.map(function (l) { return l.n; }).filter(Boolean).join(SEP),
      amount: joinN([String(total), Number(total).toLocaleString('en-US')].concat(withPaisa)),
      date: dateText(i.invoiceDate),
      other: joinN([i.notes, i.description, i.salesperson, i.paymentMethod, i.warehouseSnapshot,
                    ERP.STATUS_LABEL[i.status], ERP.STATUS_LABEL[i.paymentStatus]]),
      items: lines
    };
    e.all = [e.number, e.customer, e.product, e.amount, e.date, e.other].filter(Boolean).join(SEP);
    out[i.id] = e;
  });
  return out;
}

function ensure(force) {
  var S = ERP.S, s = [S.invoices.length, S.invoiceItems.length, version].join('.');
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

/* The shop's CURRENT name, found by id at search time (not cached in the
   index) so a rename is picked up straight away; the name printed on the
   invoice is in the index already, and both are searched. */
function currentCustomerText() {
  var src = ERP.sources || {};
  var custs = src.CUSTS ? src.CUSTS() : (global.CUSTOMERS || []);
  var byId = {}, memo = {};
  custs.forEach(function (c) { byId[c.id] = c; });
  return function (id) {
    if (memo[id] !== undefined) return memo[id];
    var c = byId[id], t = '';
    if (c) {
      t = joinN([c.sh, c.ow, c.nameUr, c.ph, compact(c.ph), c.wa, c.legacyCode,
                 global.regionTxt ? global.regionTxt(c.region) : '']);
    }
    return (memo[id] = t);
  };
}

/* a word matches if it is inside the field; a phrase with spaces may also
   match with the spaces removed ("zam zam" ⇄ "zamzam", "0300 1234567" ⇄ the
   phone stored without a dash) */
function hasTerm(hays, t) {
  var t2 = t.indexOf(' ') > -1 ? t.replace(/ /g, '') : '';
  for (var i = 0; i < hays.length; i++) {
    if (hays[i].indexOf(t) > -1 || (t2 && hays[i].indexOf(t2) > -1)) return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
   FILTERING
   ══════════════════════════════════════════════════════════════════════════ */
function presetRange(key) {
  var t = today(), d = new Date(t + 'T00:00:00');
  function back(days) { var x = new Date(d); x.setDate(x.getDate() - days); return isoLocal(x); }
  switch (key) {
    case 'last30':   return [back(30), t];
    case 'last90':   return [back(90), t];
    case 'lastyear': return [back(365), t];
    default:         return ERP.Reports.range(key);
  }
}

/* Everything the matcher and the screen both need to agree on, worked out
   once per search. `problems` are inputs that can never match anything —
   shown to the person rather than quietly returning a wrong list. */
function prepare(state) {
  var p = parse(state.q);
  var scope = (state.scope === 'customer' || SCOPE_FIELD[state.scope]) ? state.scope : 'all';
  var problems = [], ranges = null;
  if (p.dates.length) {
    ranges = p.dates;                                   /* a typed date replaces the date filter */
  } else if (state.period === 'custom') {
    var f = validISO(state.from), t = validISO(state.to);
    if (f && t && f > t) problems.push('The “From” date is after the “To” date, so no invoice can match.');
    if (f || t) ranges = [{ from: f || null, to: t || null }];
  } else if (state.period && state.period !== 'all') {
    var r = presetRange(state.period);
    if (r && (r[0] || r[1])) ranges = [{ from: r[0], to: r[1] }];
  }
  var minP = toPaisa(state.min), maxP = toPaisa(state.max);
  if (minP !== null && maxP !== null && minP > maxP) {
    problems.push('The minimum total is above the maximum, so no invoice can match.');
  }
  return { p: p, scope: scope, ranges: ranges, minP: minP, maxP: maxP, problems: problems };
}

/* A function that says whether one invoice passes every active filter. The
   words and dates are parsed once, here, not once per invoice. */
function matcher(state) {
  var pr = prepare(state), idx = ensure(), terms = pr.p.terms;
  var cur = (pr.scope === 'all' || pr.scope === 'customer') && terms.length ? currentCustomerText() : null;
  return function (inv) {
    if (pr.problems.length) return false;
    if (state.status && state.status !== 'all' && inv.status !== state.status) return false;
    if (state.region && state.region !== 'all' && inv.regionId !== state.region) return false;
    if (state.wh && state.wh !== 'all' && inv.warehouseId !== state.wh) return false;
    if (pr.ranges) {
      var d = inv.invoiceDate, ok = false;
      for (var k = 0; k < pr.ranges.length && !ok; k++) {
        var r = pr.ranges[k];
        ok = (!r.from || d >= r.from) && (!r.to || d <= r.to);
      }
      if (!ok) return false;
    }
    if (pr.minP !== null && inv.grandTotal < pr.minP) return false;
    if (pr.maxP !== null && inv.grandTotal > pr.maxP) return false;
    if (terms.length) {
      var e = idx[inv.id];
      if (!e) { idx = ensure(true); e = idx[inv.id]; if (!e) return false; }
      var hays = pr.scope === 'all' ? [e.all, cur(inv.customerId)]
               : pr.scope === 'customer' ? [e.customer, cur(inv.customerId)]
               : [e[SCOPE_FIELD[pr.scope]]];
      for (var j = 0; j < terms.length; j++) if (!hasTerm(hays, terms[j])) return false;
    }
    return true;
  };
}

function sortList(list, key) {
  var due = {};
  function dueOf(i) {
    if (due[i.id] === undefined) {
      due[i.id] = i.status === 'CANCELLED' || i.status === 'DRAFT' ? -1 : ERP.Invoices.outstanding(i);
    }
    return due[i.id];
  }
  function newer(a, b) {                               /* > 0 when a is newer than b */
    if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate < b.invoiceDate ? -1 : 1;
    var x = a.createdAt || '', y = b.createdAt || '';
    return x === y ? 0 : (x < y ? -1 : 1);
  }
  function newestFirst(a, b) { return newer(b, a); }
  var cmp;
  if (key === 'oldest') cmp = newer;
  else if (key === 'high') cmp = function (a, b) { return (b.grandTotal - a.grandTotal) || newestFirst(a, b); };
  else if (key === 'low') cmp = function (a, b) { return (a.grandTotal - b.grandTotal) || newestFirst(a, b); };
  else if (key === 'due') cmp = function (a, b) { return (dueOf(b) - dueOf(a)) || newestFirst(a, b); };
  else cmp = newestFirst;
  return list.sort(cmp);
}

/* the filtered, sorted list the screen and the CSV export both use */
function results(state) {
  return sortList(ERP.Invoices.all().filter(matcher(state)), state.sort);
}

/* For a search that landed on a product, the lines that matched — so the
   list can show WHY that invoice is there ("Taj Mahal Sella × 20"). Words
   that the invoice number or the shop already explain are not counted. */
function hitsFor(state) {
  var pr = prepare(state), idx = ensure(), terms = pr.p.terms;
  if (!terms.length || (pr.scope !== 'all' && pr.scope !== 'product')) return function () { return null; };
  var cur = currentCustomerText();
  return function (inv) {
    var e = idx[inv.id];
    if (!e) return null;
    var want = terms;
    if (pr.scope === 'all') {
      var others = [e.number, e.customer, cur(inv.customerId)];
      want = terms.filter(function (t) { return !hasTerm(others, t); });
    }
    if (!want.length) return null;
    var hit = e.items.filter(function (x) {
      return x.n && want.some(function (t) { return hasTerm([x.n], t); });
    });
    return hit.length ? { lines: hit.slice(0, 3), more: Math.max(0, hit.length - 3) } : null;
  };
}

/* What to tell the person about how the box was read. */
function describe(state) {
  var pr = prepare(state), notes = [];
  pr.p.dates.forEach(function (d) {
    var span = d.from === d.to ? d.label : 'all of ' + d.label;
    notes.push('“' + d.src + '” is read as ' + span + (d.dayFirst ? ' (day / month / year)' : '') +
      (state.period && state.period !== 'all' ? ' — this replaces the date filter' : '') + '.');
  });
  return { notes: notes, problems: pr.problems, words: pr.p.terms };
}

/* is anything narrowing the list? (drives the Clear button and empty state) */
function active(state) {
  return !!(String(state.q || '').trim() || (state.period && state.period !== 'all') ||
    (state.status && state.status !== 'all') || (state.region && state.region !== 'all') ||
    (state.wh && state.wh !== 'all') || String(state.min || '').trim() || String(state.max || '').trim());
}
function reset(state) {
  var keep = state.sort;
  Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
  state.sort = keep || DEFAULTS.sort;
  return state;
}

/* ══════════════════════════════════════════════════════════════════════════
   STYLE — only what the list's new pieces need
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (!D || D.getElementById('fc-invsearch-css')) return;
  var st = D.createElement('style'); st.id = 'fc-invsearch-css';
  st.textContent =
    '.fcb-filters{margin-top:-4px}' +
    '.fcb-filters .f{min-width:0}' +
    '.fcb-filters .f input[inputmode]{width:112px}' +
    '.fcb-note{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--muted);' +
      'margin:2px 2px 10px}' +
    '.fcb-note.warn{color:var(--bad,#b3261e);font-weight:600}' +
    '.fcb-count{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;' +
      'font-size:13px;color:var(--muted);margin:2px 2px 8px}' +
    '.fcb-count b{color:var(--ink)}' +
    '.fcb-pager{display:flex;align-items:center;gap:8px}' +
    '.fcb-pager .pg{font-size:12.5px;padding:0 6px;white-space:nowrap}' +
    '.fcb-hit{font-size:12px;color:var(--violet);margin-top:2px}' +
    '@media (max-width:760px){body.fc-mobile .fcb-filters .f{flex:1 1 46%}' +
      'body.fc-mobile .fcb-filters .f input{width:100%}}';
  D.head.appendChild(st);
})();

ERP.InvoiceSearch = {
  SCOPES: SCOPES, SORTS: SORTS, DEFAULTS: DEFAULTS,
  parse: parse, matcher: matcher, results: results, hitsFor: hitsFor, describe: describe,
  active: active, reset: reset, index: ensure, toPaisa: toPaisa
};
})(typeof window !== 'undefined' ? window : globalThis);
