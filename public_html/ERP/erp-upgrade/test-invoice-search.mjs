/* Client change request (2026-09-19): "add a search option to find old
   invoices easily by Invoice Number, Customer Name, Date, or Product Name or
   any other."

   The engine (33-invoice-search.js) is checked directly, then the Sales &
   invoices screen is driven through the real controls. The app's own data
   may already contain migrated invoices, so every assertion about a result
   is scoped to the invoices this harness creates. */
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

const HTML = fs.readFileSync(path.resolve('dist/farooq-co-erp.html'), 'utf8');
let pass = 0, fail = 0; const out = [];
function check(name, cond, detail) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let csvCaptured = '';
function boot(store) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://x.local/e',
    beforeParse(w) {
      w.indexedDB = store.idb || (store.idb = new FDBFactory());
      w.IDBKeyRange = FDBKeyRange;
      w.print = () => {}; w.confirm = () => true; w.alert = () => {};
      w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      w.Blob = class { constructor(parts) { csvCaptured = parts.join(''); } };
    }
  });
  return dom.window;
}

async function main() {
  const store = {};
  const w = boot(store);
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.landedReady || Promise.resolve()).catch(() => {});
  await sleep(250);
  const ERP = w.ERP, D = w.document, M = w.Money;
  const IS = ERP.InvoiceSearch;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const type = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); } };
  const change = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };
  const norm = s => ERP.Search.normalize(s);

  await ERP.Settings.save({ allowNegativeStock: true });

  check('IS1 the engine is loaded with its API',
    !!IS && ['matcher', 'results', 'parse', 'describe', 'hitsFor', 'active', 'reset'].every(k => typeof IS[k] === 'function'));

  /* ── fixtures: words that identify one shop / one product and nothing else ── */
  const wh = w.WAREHOUSES[0];
  const custText = c => norm([c.sh, c.ow, c.nameUr, c.ph, c.wa, c.legacyCode,
    w.regionTxt ? w.regionTxt(c.region) : ''].join(' '));
  const prodText = p => norm([p.en, p.ur, p.brand, p.brandEn, p.cat].join(' '));
  const allProdBlob = w.PRODUCTS.map(prodText).join(' ');
  const allCustBlob = w.CUSTOMERS.map(custText).join(' ');
  const noise = norm([...w.WAREHOUSES.map(x => x.name), ...Object.values(ERP.STATUS_LABEL),
    'cash owner admin farooq ahmed migrated'].join(' '));
  const wordsOf = s => norm(s).split(' ').filter(x => x.length >= 5 && /^[a-z]+$/.test(x));

  const shops = [];
  for (const c of w.CUSTOMERS) {
    if (shops.length === 3) break;
    if (!c.sh) continue;
    const others = shops.map(s => s.text).join(' ');
    const word = wordsOf(c.sh).find(x => !allProdBlob.includes(x) && !noise.includes(x) && !others.includes(x));
    if (!word) continue;
    const text = custText(c);
    if (shops.some(s => text.includes(s.word))) continue;
    shops.push({ c, word, text });
  }
  const prods = [];
  for (const p of w.PRODUCTS) {
    if (prods.length === 3) break;
    if (!p.en) continue;
    const others = prods.map(x => x.text).join(' ');
    const word = wordsOf(p.en).find(x => !allCustBlob.includes(x) && !noise.includes(x) && !others.includes(x));
    if (!word) continue;
    const text = prodText(p);
    if (prods.some(x => text.includes(x.word))) continue;
    prods.push({ p, word, text });
  }
  check('IS2 fixtures: three shops and three products with words of their own',
    shops.length === 3 && prods.length === 3, `${shops.length} shops, ${prods.length} products`);
  const [s1, s2, s3] = shops, [pA, pB, pC] = prods;
  /* none of the seeded shops has a phone; the invoice snapshots it when it is made */
  s2.c.ph = '0345-9876543';

  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };

  function line(pr, qty, rate) {
    return { productId: pr.p.id, quantity: qty, unitPrice: rate, discount: 0, warehouseId: wh.id };
  }
  const mine = {}, nameOf = {};
  async function make(tag, extra) {
    const rec = await ERP.Invoices.save(Object.assign({ warehouseId: wh.id, paidAmount: 0 }, extra));
    mine[tag] = rec; nameOf[rec.id] = tag;
    return rec;
  }
  await make('I1', { customerId: s1.c.id, invoiceDate: '2025-03-05', referenceNo: 'PO-XYZ-4411',
    notes: 'گودام کا مال', items: [line(pA, 2, 5000)] });
  await make('I2', { customerId: s2.c.id, invoiceDate: '2025-05-03', notes: 'zzquokka delivery',
    items: [line(pB, 1, 25000)] });
  await make('I3', { customerId: s1.c.id, invoiceDate: daysAgo(5), paidAmount: 12000,
    items: [line(pC, 4, 3000)] });
  await make('I4', { customerId: s3.c.id, invoiceDate: daysAgo(60), items: [line(pA, 1, 777)] });
  await make('I5', { customerId: s3.c.id, invoiceDate: '2024-12-25', items: [line(pB, 1, 555)] });
  await sleep(100);

  const S = over => Object.assign({}, IS.DEFAULTS, over || {});
  const got = state => IS.results(S(state)).filter(i => nameOf[i.id]).map(i => nameOf[i.id]);
  const same = (state, want) => {
    const g = got(state).sort().join(','), x = want.slice().sort().join(',');
    return { ok: g === x, g, x };
  };
  const expectSet = (name, state, want) => {
    const r = same(state, want);
    check(name, r.ok, `got [${r.g}] want [${r.x}]`);
  };

  /* ══════════════════════════════════════════════════════════════════════
     FIND BY INVOICE NUMBER
     ══════════════════════════════════════════════════════════════════════ */
  const no1 = mine.I1.invoiceNumber;
  expectSet('N1 full invoice number finds exactly that invoice', { q: no1 }, ['I1']);
  expectSet('N2 lower case and without the hyphens find it too', { q: no1.toLowerCase().replace(/-/g, '') }, ['I1']);
  expectSet('N3 the tail of the number finds it', { q: no1.split('-').pop() + ' ' + no1.split('-')[1] }, ['I1']);
  expectSet('N4 a reference number is found (scope: invoice / order no.)',
    { q: 'po-xyz-4411', scope: 'number' }, ['I1']);
  expectSet('N5 a shop word does not match inside the number scope', { q: s1.word, scope: 'number' }, []);

  /* ══════════════════════════════════════════════════════════════════════
     FIND BY CUSTOMER
     ══════════════════════════════════════════════════════════════════════ */
  expectSet('C1 a shop name finds every invoice of that shop', { q: s1.word.toUpperCase() }, ['I1', 'I3']);
  expectSet('C2 the shop scope finds the same', { q: s3.word, scope: 'customer' }, ['I4', 'I5']);
  expectSet('C3 a phone number finds the shop, typed with no dashes',
    { q: '03459876543', scope: 'customer' }, ['I2']);
  expectSet('C3b …or typed with the dash', { q: '0345-9876543', scope: 'customer' }, ['I2']);
  expectSet('C4 a product word does not match inside the customer scope', { q: pA.word, scope: 'customer' }, []);

  /* the shop's CURRENT name is searched as well as the name printed on the invoice */
  const oldSh = s2.c.sh; s2.c.sh = 'Zzyzx Renamed Traders';
  ERP.Mirror.refresh();
  expectSet('C5 a shop renamed since is found by its new name', { q: 'zzyzx' }, ['I2']);
  expectSet('C6 …and still by the name printed on the old invoice', { q: s2.word }, ['I2']);
  s2.c.sh = oldSh;

  /* ══════════════════════════════════════════════════════════════════════
     FIND BY PRODUCT
     ══════════════════════════════════════════════════════════════════════ */
  expectSet('P1 a product word finds every invoice carrying it', { q: pA.word }, ['I1', 'I4']);
  expectSet('P2 the product scope finds the same', { q: pB.word, scope: 'product' }, ['I2', 'I5']);
  expectSet('P3 a shop word does not match inside the product scope', { q: s1.word, scope: 'product' }, []);
  expectSet('P4 words from two different fields must both be found (shop + product)',
    { q: s1.word + ' ' + pC.word }, ['I3']);
  expectSet('P5 …in either order', { q: pC.word + ' ' + s1.word }, ['I3']);
  expectSet('P6 a shop and a product it never bought find nothing', { q: s2.word + ' ' + pA.word }, []);

  /* ══════════════════════════════════════════════════════════════════════
     FIND BY DATE — typed into the box
     ══════════════════════════════════════════════════════════════════════ */
  expectSet('D1 05/03/2025 is read day-first: 5 March, not 3 May', { q: '05/03/2025' }, ['I1']);
  expectSet('D2 2025-05-03 (ISO) finds 3 May', { q: '2025-05-03' }, ['I2']);
  expectSet('D3 "5 Mar 2025" finds it', { q: '5 Mar 2025' }, ['I1']);
  expectSet('D4 "5th March, 2025" finds it', { q: '5th March, 2025' }, ['I1']);
  expectSet('D5 "Mar 5 2025" finds it', { q: 'Mar 5 2025' }, ['I1']);
  expectSet('D6 a month and year finds the whole month', { q: 'March 2025' }, ['I1']);
  expectSet('D7 …as does 05/2025', { q: '05/2025' }, ['I2']);
  expectSet('D8 …and 2025-12', { q: '2025-12' }, []);
  expectSet('D9 …and 2024-12', { q: '2024-12' }, ['I5']);
  expectSet('D10 a date plus a shop word narrows to that shop\'s invoice on that day',
    { q: '05/03/2025 ' + s1.word }, ['I1']);
  expectSet('D11 a typed date replaces the date preset', { q: '05/03/2025', period: 'today' }, ['I1']);
  expectSet('D12 a month name alone still works as text', { q: 'march' }, ['I1']);
  expectSet('D13 a date that does not exist stays as text and matches nothing', { q: '31/02/2025' }, []);
  check('D14 an impossible date is not reported as a date', IS.describe(S({ q: '31/02/2025' })).notes.length === 0);
  const note = IS.describe(S({ q: '05/03/2025' })).notes[0] || '';
  check('D15 the screen is told how the date was read', /05\/03\/2025/.test(note) && /05 Mar 2025/.test(note) &&
    /day \/ month \/ year/.test(note), note);
  expectSet('D16 the tail of an invoice number is not mistaken for a month',
    { q: 'INV-' + no1.split('-')[1] + '-12' }, []);   /* stays text; nothing has that number */
  check('D17 …and produces no date note', IS.describe(S({ q: 'INV-2026-12' })).notes.length === 0);
  expectSet('D18 a date typed in Urdu digits finds the invoice', { q: '٠٥/٠٣/٢٠٢٥' }, ['I1']);
  check('D19 …and is read as a date, announced like any other',
    /05 Mar 2025/.test(IS.describe(S({ q: '۰۵/۰۳/۲۰۲۵' })).notes[0] || ''));

  /* ══════════════════════════════════════════════════════════════════════
     DATE FILTERS
     ══════════════════════════════════════════════════════════════════════ */
  expectSet('F1 Last 30 days', { period: 'last30' }, ['I3']);
  expectSet('F2 Last 3 months', { period: 'last90' }, ['I3', 'I4']);
  const yearAgo = daysAgo(365);
  expectSet('F3 Last 12 months',
    { period: 'lastyear' }, ['I1', 'I2', 'I3', 'I4', 'I5'].filter(k => mine[k].invoiceDate >= yearAgo));
  expectSet('F4 a custom range', { period: 'custom', from: '2025-04-01', to: '2025-12-31' }, ['I2']);
  expectSet('F5 a custom range with only a start', { period: 'custom', from: '2025-04-01' },
    ['I2', 'I3', 'I4']);
  expectSet('F6 a custom range with only an end', { period: 'custom', to: '2025-04-01' }, ['I1', 'I5']);
  expectSet('F7 a custom range with neither end set shows everything',
    { period: 'custom' }, ['I1', 'I2', 'I3', 'I4', 'I5']);
  expectSet('F8 a range combines with a search', { period: 'custom', from: '2025-01-01', q: pA.word }, ['I1', 'I4']);
  expectSet('F9 From after To matches nothing', { period: 'custom', from: '2025-12-31', to: '2025-04-01' }, []);
  check('F10 …and says why', IS.describe(S({ period: 'custom', from: '2025-12-31', to: '2025-04-01' }))
    .problems.some(m => /From.*after.*To/.test(m)));

  /* ══════════════════════════════════════════════════════════════════════
     AMOUNTS, STATUS, NOTES
     ══════════════════════════════════════════════════════════════════════ */
  expectSet('A1 an amount finds its invoice', { q: '25000', scope: 'amount' }, ['I2']);
  expectSet('A2 …typed with a thousands comma', { q: '25,000', scope: 'amount' }, ['I2']);
  expectSet('A3 an odd amount', { q: '777', scope: 'amount' }, ['I4']);
  expectSet('A4 a minimum and maximum total', { min: '10000', max: '12000' }, ['I1', 'I3']);
  expectSet('A5 a minimum alone', { min: '20,000' }, ['I2']);
  expectSet('A6 a maximum alone', { max: '1000' }, ['I4', 'I5']);
  expectSet('A7 a minimum above the maximum matches nothing', { min: '500', max: '100' }, []);
  check('A8 …and says why', IS.describe(S({ min: '500', max: '100' })).problems.some(m => /minimum/.test(m)));
  expectSet('A9 text in a total box is ignored, not treated as zero', { min: 'abc', max: '   ' },
    ['I1', 'I2', 'I3', 'I4', 'I5']);
  expectSet('S1 the status filter', { status: 'PAID' }, ['I3']);
  expectSet('S2 notes are searched', { q: 'zzquokka' }, ['I2']);
  expectSet('S3 …in the notes scope', { q: 'zzquokka', scope: 'notes' }, ['I2']);
  expectSet('S4 Urdu notes are found with the Arabic form of the same letter', { q: 'گودام كا' }, ['I1']);
  expectSet('S5 …but a notes word does not match inside the product scope', { q: 'zzquokka', scope: 'product' }, []);

  /* ══════════════════════════════════════════════════════════════════════
     ORDER
     ══════════════════════════════════════════════════════════════════════ */
  const order = key => got({ sort: key }).join(',');
  check('O1 newest first (the default)', order('newest') === 'I3,I4,I2,I1,I5', order('newest'));
  check('O2 oldest first', order('oldest') === 'I5,I1,I2,I4,I3', order('oldest'));
  check('O3 highest total first', order('high') === 'I2,I3,I1,I4,I5', order('high'));
  check('O4 lowest total first', order('low') === 'I5,I4,I1,I3,I2', order('low'));
  check('O5 highest balance due first (a paid invoice owes nothing)', order('due').startsWith('I2,I1') &&
    order('due').endsWith('I3'), order('due'));

  /* ══════════════════════════════════════════════════════════════════════
     THE INDEX STAYS CURRENT, AND IS NOT REBUILT PER KEYSTROKE
     ══════════════════════════════════════════════════════════════════════ */
  expectSet('X1 before the change: nothing is "cancelled"', { q: 'cancelled', scope: 'notes' }, []);
  await ERP.Invoices.cancel(mine.I5.id, 'test');
  await sleep(50);
  expectSet('X2 a cancelled invoice is found by its new status straight away',
    { q: 'cancelled', scope: 'notes' }, ['I5']);
  expectSet('X3 the status filter finds it too', { status: 'CANCELLED' }, ['I5']);
  expectSet('X4 an old cancelled invoice is still found by its number', { q: mine.I5.invoiceNumber }, ['I5']);
  expectSet('X5 …and by its date', { q: '25/12/2024' }, ['I5']);

  expectSet('X6 a word nobody has used yet finds nothing', { q: 'zzlatecomer' }, []);
  await make('I6', { customerId: s2.c.id, invoiceDate: daysAgo(1), notes: 'zzlatecomer', items: [line(pC, 1, 10)] });
  await sleep(50);
  expectSet('X7 …and finds the invoice saved a moment later', { q: 'zzlatecomer' }, ['I6']);

  let itemScans = 0;
  const origItems = ERP.Invoices.items;
  ERP.Invoices.items = function () { itemScans++; return origItems.apply(this, arguments); };
  IS.results(S({ q: pA.word + ' ' + s1.word }));
  IS.results(S({ q: 'zzquokka', scope: 'notes' }));
  ERP.Invoices.items = origItems;
  check('X8 searching never scans the line items invoice by invoice', itemScans === 0, String(itemScans));

  /* ══════════════════════════════════════════════════════════════════════
     THE SCREEN
     ══════════════════════════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════════════════════════
     DATE PRESETS ARE LOCAL CALENDAR DATES
     Reports.range used toISOString() (UTC), which moved every date built from
     a local-midnight Date back a day east of Greenwich: in Pakistan "Yesterday"
     was two days ago, "This week" started on a Sunday and "Last month" ran
     Jul 31–Aug 30. The bounds below are computed here from local components.
     ══════════════════════════════════════════════════════════════════════ */
  const now = new Date(), Y = now.getFullYear(), Mo = now.getMonth(), Dd = now.getDate();
  const at = (y, m, d) => isoOf(new Date(y, m, d));
  const bounds = {
    today: [at(Y, Mo, Dd), at(Y, Mo, Dd)],
    yesterday: [at(Y, Mo, Dd - 1), at(Y, Mo, Dd - 1)],
    week: [at(Y, Mo, Dd - ((now.getDay() || 7) - 1)), at(Y, Mo, Dd)],
    month: [at(Y, Mo, 1), at(Y, Mo, Dd)],
    lastmonth: [at(Y, Mo - 1, 1), at(Y, Mo, 0)],
    year: [`${Y}-01-01`, at(Y, Mo, Dd)]
  };
  const presetDates = { R1: bounds.today[0], R2: bounds.yesterday[0], R3: bounds.week[0], R4: bounds.month[0],
    R5: bounds.lastmonth[0], R6: bounds.lastmonth[1], R7: `${Y}-01-01`, R8: `${Y - 1}-12-31` };
  for (const [tag, d] of Object.entries(presetDates)) {
    await make(tag, { customerId: s3.c.id, invoiceDate: d, items: [line(pC, 1, 1)] });
  }
  for (const [key, [from, to]] of Object.entries(bounds)) {
    /* every invoice this harness has made so far, judged by its own date */
    expectSet(`R-${key} "${key}" covers exactly ${from}${from === to ? '' : ' … ' + to}`, { period: key },
      Object.keys(mine).filter(t => mine[t].invoiceDate >= from && mine[t].invoiceDate <= to));
  }
  const pr = ERP.Reports.range('lastmonth');
  check('R-range Reports.range("lastmonth") is the whole calendar month', pr[0] === bounds.lastmonth[0] &&
    pr[1] === bounds.lastmonth[1], JSON.stringify(pr));
  check('R-range …and "yesterday" is exactly one day back',
    ERP.Reports.range('yesterday')[0] === bounds.yesterday[0], ERP.Reports.range('yesterday')[0]);

  /* a total with paisa is findable as typed */
  await make('I9', { customerId: s2.c.id, invoiceDate: daysAgo(3), items: [line(pC, 1, 250.5)] });
  expectSet('A10 a total with paisa is found as "250.50"', { q: '250.50', scope: 'amount' }, ['I9']);
  expectSet('A11 …and as "250.5"', { q: '250.5', scope: 'amount' }, ['I9']);

  IS.reset(ERP.InvoiceList);
  w.go('invoices'); await sleep(120);
  const rowsText = () => $$('table.fcb-list tbody tr').map(r => r.textContent).join('\n');
  const rowCount = () => $$('table.fcb-list tbody tr').length;
  const settle = async () => { await sleep(380); };

  check('U1 the screen has the search box, "search in", sort and date controls',
    !!$('[data-fcq]') && !!$('[data-fcfil="scope"]') && !!$('[data-fcfil="sort"]') && !!$('[data-fcfil="period"]'));
  check('U2 the total-from / total-to boxes are there', !!$('[data-fcfil="min"]') && !!$('[data-fcfil="max"]'));

  type($('[data-fcq]'), no1); await settle();
  check('U3 typing an invoice number shows that invoice', rowsText().includes(no1) && rowCount() === 1, String(rowCount()));
  check('U4 the count line says how many matched', /1\s*of\s*\d+\s*invoices match/.test($('.fcb-count').textContent),
    $('.fcb-count') && $('.fcb-count').textContent);
  check('U5 a Clear filters button appears while filtering', !!$('[data-fcbact="invclear"]'));

  type($('[data-fcq]'), pA.word); await settle();
  const hit = $$('.fcb-hit').map(x => x.textContent).join(' | ');
  check('U6 a product search shows which product lines matched',
    norm(hit).includes(pA.word) && /×/.test(hit), hit);
  check('U7 …and the matching invoices are listed', rowsText().includes(mine.I1.invoiceNumber) &&
    rowsText().includes(mine.I4.invoiceNumber));

  type($('[data-fcq]'), s1.word); await settle();
  check('U8 a shop search does not show product lines as if they were the reason', $$('.fcb-hit').length === 0);

  type($('[data-fcq]'), '05/03/2025'); await settle();
  check('U9 a typed date shows how it was read', /read as 05 Mar 2025/.test($('.fcb-note') ? $('.fcb-note').textContent : ''),
    $('.fcb-note') && $('.fcb-note').textContent);
  check('U10 …and lists that day\'s invoice', rowsText().includes(mine.I1.invoiceNumber) &&
    !rowsText().includes(mine.I2.invoiceNumber));

  type($('[data-fcq]'), 'zzno-such-invoice-anywhere'); await settle();
  check('U11 no match shows a helpful empty state with Clear filters',
    rowCount() === 0 && /Nothing on file fits/.test($('#view').textContent) && !!$('[data-fcbact="invclear"]'));
  click($('.empty [data-fcbact="invclear"]')); await sleep(150);
  check('U12 Clear filters empties the box and shows the list again',
    $('[data-fcq]').value === '' && rowCount() > 0 && !$('[data-fcbact="invclear"]'));

  check('U13 the From/To boxes are hidden until "Custom range" is chosen', !$('[data-fcfil="from"]'));
  change($('[data-fcfil="period"]'), 'custom'); await settle();
  check('U14 choosing Custom range shows them', !!$('[data-fcfil="from"]') && !!$('[data-fcfil="to"]'));
  change($('[data-fcfil="from"]'), '2025-04-01'); await settle();
  change($('[data-fcfil="to"]'), '2025-12-31'); await settle();
  check('U15 the range narrows the list', rowsText().includes(mine.I2.invoiceNumber) &&
    !rowsText().includes(mine.I1.invoiceNumber) && !rowsText().includes(mine.I3.invoiceNumber));
  change($('[data-fcfil="from"]'), '2026-01-01'); await settle();
  check('U16 From after To shows a warning and an empty list',
    /From.*after.*To/.test($('#view').textContent) && rowCount() === 0);
  IS.reset(ERP.InvoiceList); w.paint(); await sleep(100);

  change($('[data-fcfil="min"]'), '20000'); await settle();
  check('U17 a minimum total narrows the list', rowsText().includes(mine.I2.invoiceNumber) &&
    !rowsText().includes(mine.I4.invoiceNumber));
  IS.reset(ERP.InvoiceList); w.paint(); await sleep(100);

  change($('[data-fcfil="sort"]'), 'oldest'); await settle();
  const firstDates = $$('table.fcb-list tbody tr').map(r => r.querySelector('td[data-label="Date"]').textContent);
  const asTime = t => new Date(t).getTime();
  check('U18 sorting oldest first orders the rows by date',
    firstDates.every((d, i) => i === 0 || asTime(firstDates[i - 1]) <= asTime(d)));
  change($('[data-fcfil="sort"]'), 'newest'); await settle();

  /* the CSV export covers what is filtered, not just what is on this page */
  type($('[data-fcq]'), pA.word); await settle();
  csvCaptured = '';
  click($('[data-fcbact="exportcsv"]')); await sleep(50);
  check('U19 the CSV export follows the search',
    csvCaptured.includes(mine.I1.invoiceNumber) && csvCaptured.includes(mine.I4.invoiceNumber) &&
    !csvCaptured.includes(mine.I2.invoiceNumber));
  IS.reset(ERP.InvoiceList); w.paint(); await sleep(100);

  /* ══════════════════════════════════════════════════════════════════════
     PAGING — an old book of invoices is not drawn as one giant table
     ══════════════════════════════════════════════════════════════════════ */
  for (let i = 0; i < 55; i++) {
    await ERP.Invoices.save({ customerId: s1.c.id, warehouseId: wh.id, invoiceDate: daysAgo(2), paidAmount: 0,
      notes: 'zzbulkfill', items: [line(pC, 1, 100 + i)] });
  }
  await sleep(100);
  IS.reset(ERP.InvoiceList); w.paint(); await sleep(120);
  const total = ERP.InvoiceList.results().length;
  const pages = Math.ceil(total / 50);
  check('G1 more than a page of invoices exist', total > 50, String(total));
  check('G2 only one page of rows is drawn', rowCount() === 50, String(rowCount()));
  check('G3 the pager says where you are', new RegExp('Page 1 of ' + pages).test($('.fcb-pager').textContent),
    $('.fcb-pager') && $('.fcb-pager').textContent);
  check('G4 Prev and First are disabled on page 1',
    $('[data-fcpage="prev"]').disabled && $('[data-fcpage="first"]').disabled);
  check('G5 the count line shows the range', new RegExp('showing 1–50').test($('.fcb-count').textContent));
  click($('[data-fcpage="next"]')); await sleep(80);
  check('G6 Next shows the next page', /Page 2 of/.test($('.fcb-pager').textContent) &&
    rowCount() === Math.min(50, total - 50), String(rowCount()));
  click($('[data-fcpage="last"]')); await sleep(80);
  check('G7 Last jumps to the end', new RegExp('Page ' + pages + ' of ' + pages).test($('.fcb-pager').textContent) &&
    $('[data-fcpage="next"]').disabled);
  type($('[data-fcq]'), 'zzquokka'); await settle();
  check('G8 a new search starts again from page 1 (and a short result has no pager)',
    ERP.InvoiceList.page === 1 && rowCount() === 1 && !$('.fcb-pager'));
  IS.reset(ERP.InvoiceList); w.paint(); await sleep(100);
  click($('[data-fcpage="last"]')); await sleep(80);
  type($('[data-fcq]'), 'zzbulkfill'); await settle();
  check('G9 narrowing to fewer pages never strands you past the end',
    ERP.InvoiceList.page >= 1 && ERP.InvoiceList.page <= ERP.InvoiceList.pages && rowCount() > 0, String(rowCount()));
  const bulkTotal = ERP.InvoiceList.results().length;
  check('G10 the totals cover every match, not just the page',
    bulkTotal === 55 && new RegExp('\\b55\\b').test($('.fcb-count').textContent), $('.fcb-count').textContent);
  IS.reset(ERP.InvoiceList);

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  w.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
