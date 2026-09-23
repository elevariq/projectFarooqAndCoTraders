/* Client change request (2026-09-21): "the search bar of payment and invoice".

   The Payments screen's box promised "Search shop or reference…" but only ever
   looked at "<shop> <method>". 38-payment-search.js is the engine plus the
   screen; this drives the engine directly, then the real controls, then the
   invoice list's new "find the invoice a receipt paid".

   The app's own data may already hold migrated payments, so every assertion
   about a result is scoped to the payments this harness creates. */
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
  const PS = ERP.PaymentSearch, PL = ERP.PaymentList, IS = ERP.InvoiceSearch;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const type = (el, v) => { if (el) { el.focus(); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); } };
  const change = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };

  await ERP.Settings.save({ allowNegativeStock: true });

  check('PS1 the engine is loaded with its API',
    !!PS && ['matcher', 'results', 'describe', 'active', 'reset'].every(k => typeof PS[k] === 'function'));

  /* ── fixtures ── */
  const wh = w.WAREHOUSES[0], prod = w.PRODUCTS[0], sup = w.SUPPLIERS[0];
  const shopsWithRegion = w.CUSTOMERS.filter(c => c.region && c.sh);
  const nm = c => ERP.Search.normalize(c.sh);
  const c1 = shopsWithRegion[0];
  const c2 = shopsWithRegion.find(c => c.region !== c1.region && !nm(c).includes(nm(c1)) && !nm(c1).includes(nm(c)));
  check('PS2 fixtures: two different shops', c1.id !== c2.id);

  const invA = await ERP.Invoices.save({
    customerId: c1.id, warehouseId: wh.id, invoiceDate: '2026-08-10', paidAmount: 0,
    items: [{ productId: prod.id, quantity: 1, unitPrice: 20000, discount: 0, warehouseId: wh.id }]
  });
  const mine = {};
  mine.P1 = await ERP.Payments.receive({ customerId: c1.id, amount: 5000, method: 'Cheque', reference: 'CHQ-84711',
    date: '2026-08-14', note: 'advance for eid', allocations: [{ invoiceId: invA.id, amount: 5000 }] });
  mine.P2 = await ERP.Payments.receive({ customerId: c1.id, amount: 2500.75, method: 'Bank Transfer',
    reference: 'TRX 99120 AB', date: '2026-09-03' });
  mine.P3 = await ERP.Payments.receive({ customerId: c2.id, amount: 1200, method: 'Cash', reference: 'ZQ-CASH-7',
    date: '2026-09-15' });
  mine.P4 = await ERP.Payments.refund({ customerId: c2.id, amount: 800, method: 'Cash', reference: 'RFD-5521',
    date: '2026-09-12', note: 'cash handed back' });
  mine.P5 = await ERP.Payments.pay({ supplierId: sup.id, amount: 15000, method: 'Bank Transfer',
    reference: 'SUPREF-3301', date: '2026-07-20' });
  mine.P6 = await ERP.Payments.receive({ customerId: c1.id, amount: 500, method: 'Cash', reference: 'REV-0007',
    date: '2026-09-05' });
  await ERP.Payments.reverse(mine.P6.id, 'wrong shop');
  const name = {}; Object.keys(mine).forEach(k => { name[mine[k].id] = k; });
  const mineIds = new Set(Object.values(mine).map(p => p.id));

  const st = o => Object.assign({}, PS.DEFAULTS, o);
  /* the harness's own payments a search returns, as a sorted string */
  const hits = o => PS.results(st(o)).list.filter(p => mineIds.has(p.id)).map(p => name[p.id]).sort().join(',');
  const expectSet = (label, o, want) => {
    const got = hits(o);
    check(label, got === want.slice().sort().join(','), `got [${got}] want [${want.join(',')}]`);
  };

  /* ══════════════════════════════════════════════════════════════════════
     THE ENGINE
     ══════════════════════════════════════════════════════════════════════ */
  expectSet('R1 the full cheque / reference number finds that payment', { q: 'CHQ-84711' }, ['P1']);
  expectSet('R2 lower case and without the hyphen finds it too', { q: 'chq84711' }, ['P1']);
  expectSet('R3 a reference typed with spaces, part of it', { q: '99120' }, ['P2']);
  expectSet('R4 "search in" a reference does not look at other fields', { q: 'CHQ-84711', scope: 'reference' }, ['P1']);
  expectSet('R5 a reference is not found when searching only receipt numbers', { q: 'CHQ-84711', scope: 'number' }, []);

  expectSet('N1 the receipt number finds exactly that receipt', { q: mine.P2.receiptNumber }, ['P2']);
  expectSet('N2 without hyphens / lower case', { q: mine.P2.receiptNumber.toLowerCase().replace(/-/g, '') }, ['P2']);
  check('N3 a payment voucher number (PV-…) finds the supplier payment',
    /^PV/.test(mine.P5.receiptNumber) && hits({ q: mine.P5.receiptNumber, scope: 'number' }) === 'P5', mine.P5.receiptNumber);

  /* substring, like the invoice list: 5000 is inside 15000 too */
  expectSet('A1 an amount finds it', { q: '5000', scope: 'amount' }, ['P1', 'P5']);
  expectSet('A2 an amount with paisa, as typed', { q: '2500.75' }, ['P2']);
  expectSet('A3 with a thousands comma', { q: '2,500.75' }, ['P2']);
  expectSet('A4 amount range from-to', { min: '2000', max: '6000' }, ['P1', 'P2']);
  expectSet('A5 a range that leaves out the small ones', { min: '3000', max: '6000' }, ['P1']);
  expectSet('A6 amount "from" alone', { min: '10000' }, ['P5']);

  expectSet('D1 a typed date is a date filter (day/month/year)', { q: '14/08/2026' }, ['P1']);
  expectSet('D2 ISO date', { q: '2026-08-14' }, ['P1']);
  expectSet('D3 written month and year', { q: 'Aug 2026' }, ['P1']);
  expectSet('D4 month as 2026-09 catches every payment that month', { q: '2026-09' }, ['P2', 'P3', 'P4', 'P6']);
  expectSet('D5 day-first: 03/09/2026 is 3 September', { q: '03/09/2026' }, ['P2']);
  const dn = PS.describe(st({ q: '14/08/2026' }));
  check('D6 the screen is told how the date was read', dn.notes.length === 1 && /14 Aug 2026/.test(dn.notes[0]) && /day \/ month \/ year/.test(dn.notes[0]),
    JSON.stringify(dn.notes));
  expectSet('D7 custom range', { period: 'custom', from: '2026-09-01', to: '2026-09-10' }, ['P2', 'P6']);
  expectSet('D8 custom range with only a From', { period: 'custom', from: '2026-09-10' }, ['P3', 'P4']);
  check('D9 From after To is reported and matches nothing',
    PS.describe(st({ period: 'custom', from: '2026-09-10', to: '2026-01-01' })).problems.length === 1 &&
    hits({ period: 'custom', from: '2026-09-10', to: '2026-01-01' }) === '');
  check('D10 a minimum above the maximum is reported and matches nothing',
    PS.describe(st({ min: '900', max: '100' })).problems.length === 1 && hits({ min: '900', max: '100' }) === '');
  /* a payment dated today is in "Today" (the local date, not UTC) */
  const todayIso = ERP.Reports.range('today')[0];        /* the app's own idea of today */
  mine.P7 = await ERP.Payments.receive({ customerId: c1.id, amount: 111, method: 'Cash', reference: 'TODAY-1', date: todayIso });
  name[mine.P7.id] = 'P7'; mineIds.add(mine.P7.id);
  expectSet('D11 the "Today" preset finds a payment dated today', { period: 'today', q: 'TODAY-1' }, ['P7']);
  expectSet('D12 and not one dated last month', { period: 'today', q: 'CHQ-84711' }, []);

  /* shops */
  const words = s => ERP.Search.normalize(s).split(' ').filter(Boolean);
  const c2words = words(c2.sh);
  expectSet('S1 the shop name finds its payments (received and paid)', { q: c2.sh }, ['P3', 'P4']);
  expectSet('S2 the words of a name in reverse order still find it', { q: c2words.slice().reverse().join(' ') }, ['P3', 'P4']);
  expectSet('S3 shop name AND a reference: both must hold', { q: c2.sh + ' RFD-5521' }, ['P4']);
  expectSet('S4 a word that is in no field finds nothing of ours', { q: c2.sh + ' qqzzxxnothing' }, []);
  c2.ph = '0345-7654321';                                   /* the phone is looked up on the shop, not the receipt */
  expectSet('S5 the shop\'s current phone number finds its payments', { q: '03457654321' }, ['P3', 'P4']);
  expectSet('S6 phone as typed with the dash', { q: '0345-7654321' }, ['P3', 'P4']);
  const oldName = c1.sh; c1.sh = 'Zzyzx Renamed Traders';
  expectSet('S7 a shop renamed since is found by its new name', { q: 'zzyzx' }, ['P1', 'P2', 'P6', 'P7']);
  expectSet('S8 and still by the name printed on the receipt', { q: oldName }, ['P1', 'P2', 'P6', 'P7']);
  c1.sh = oldName;
  expectSet('S9 the supplier is found by name', { q: sup.co, scope: 'party' }, ['P5']);
  expectSet('S10 "shop or supplier" scope does not look at references', { q: 'RFD-5521', scope: 'party' }, []);

  /* what it was applied to */
  /* P2 and P7 named no invoice, so the app applied them to the oldest one owed: this */
  expectSet('I1 the invoice number finds every payment applied to it', { q: invA.invoiceNumber }, ['P1', 'P2', 'P7']);
  expectSet('I2 (invoice scope)', { q: invA.invoiceNumber, scope: 'invoice' }, ['P1', 'P2', 'P7']);
  expectSet('I3 an unrelated scope does not', { q: invA.invoiceNumber, scope: 'reference' }, []);

  /* kinds */
  expectSet('K1 received from shops', { dir: 'rec', period: 'custom', from: '2026-08-01', to: '2026-09-16' }, ['P1', 'P2', 'P3', 'P6']);
  expectSet('K2 paid to shops', { dir: 'shops' }, ['P4']);
  expectSet('K3 paid to suppliers', { dir: 'sup' }, ['P5']);
  expectSet('K4 a method', { method: 'Cheque' }, ['P1']);
  expectSet('K6 a region: P1 and P2 belong to that shop\'s region', { region: c1.region, dir: 'rec', q: 'chq84711' }, ['P1']);
  expectSet('K7 a region leaves out suppliers (they have none)', { region: c1.region, dir: 'sup' }, []);
  expectSet('K8 the words "reversed" and "cancelled" find reversed payments', { q: 'reversed' }, ['P6']);
  expectSet('K9 a note is searched', { q: 'advance eid' }, ['P1']);
  expectSet('K10 "search in notes" finds a note but not a reference', { q: 'advance', scope: 'notes' }, ['P1']);
  expectSet('K11 the word "refund" finds payments to shops', { q: 'refund' }, ['P4']);

  /* groups, totals, order */
  const R = PS.results(st({ q: '' }));
  check('G1 a reversed payment is in the reversed group, not the received one',
    R.groups.rev.some(p => p.id === mine.P6.id) && !R.groups.rec.some(p => p.id === mine.P6.id));
  check('G2 reversed money is in no total', R.sums.rec === R.groups.rec.reduce((s, p) => s + p.amount, 0) &&
    !R.groups.rec.some(p => p.status === 'REVERSED'));
  check('G3 a payment to a shop is not in the supplier group',
    R.groups.shops.some(p => p.id === mine.P4.id) && !R.groups.sup.some(p => p.id === mine.P4.id) &&
    R.groups.sup.some(p => p.id === mine.P5.id));
  const newest = PS.results(st({})).list.filter(p => mineIds.has(p.id)).map(p => name[p.id]);
  check('G4 newest first', newest.join(',') === 'P7,P3,P4,P6,P2,P1,P5', newest.join(','));
  const oldest = PS.results(st({ sort: 'oldest' })).list.filter(p => mineIds.has(p.id)).map(p => name[p.id]);
  check('G5 oldest first', oldest.join(',') === 'P5,P1,P2,P6,P4,P3,P7', oldest.join(','));
  const high = PS.results(st({ sort: 'high' })).list.filter(p => mineIds.has(p.id)).map(p => name[p.id]);
  check('G6 highest amount first', high.join(',') === 'P5,P1,P2,P3,P4,P6,P7', high.join(','));
  const low = PS.results(st({ sort: 'low' })).list.filter(p => mineIds.has(p.id)).map(p => name[p.id]);
  check('G7 lowest amount first', low.join(',') === 'P7,P6,P4,P3,P2,P1,P5', low.join(','));
  check('G8 nothing narrowing = not "active"; any control makes it active',
    !PS.active(st({})) && PS.active(st({ q: 'a' })) && PS.active(st({ dir: 'sup' })) && PS.active(st({ method: 'Cash' })) &&
    PS.active(st({ min: '1' })) && PS.active(st({ period: 'week' })) && PS.active(st({ region: 'x' })));

  /* freshness */
  const fresh = await ERP.Payments.receive({ customerId: c2.id, amount: 42, method: 'Cash', reference: 'FRESH-ONE', date: todayIso });
  name[fresh.id] = 'F'; mineIds.add(fresh.id);
  expectSet('F1 a payment made after the index was built is found at once', { q: 'FRESH-ONE' }, ['F']);
  await ERP.Payments.reverse(fresh.id, 'test');
  check('F2 and after reversal it moves to the reversed group',
    PS.results(st({ q: 'FRESH-ONE' })).groups.rev.length === 1 && PS.results(st({ q: 'FRESH-ONE' })).groups.rec.length === 0);

  /* ══════════════════════════════════════════════════════════════════════
     THE SCREEN — driven through its real controls
     ══════════════════════════════════════════════════════════════════════ */
  PS.reset(PL);
  w.go('payments'); await sleep(200);
  const box = () => $('[data-fcpq]');
  const pageText = () => $('#view').textContent;
  check('U1 the search box is there and says what it searches',
    !!box() && /receipt/i.test(box().placeholder) && /reference/i.test(box().placeholder) && /amount/i.test(box().placeholder),
    box() ? box().placeholder : 'no box');
  check('U2 it has the scope, sort, kind, date, method, region and amount controls',
    ['scope', 'sort', 'dir', 'period', 'method', 'region', 'min', 'max'].every(k => !!$(`[data-fcpfil="${k}"]`)));
  check('U3 the three lists are on the page',
    !!$('[data-fcpayopen="payment"]') && !!$('#fcPaidToShops') && $$('.sec-t').some(s => /^Supplier payments/.test(s.textContent.trim())));
  check('U4 no filter yet: no Clear button, and the count line says how many are on file',
    !$('[data-fcpact="clear"]') && new RegExp(`${ERP.S.payments.length} payments? on file`).test($('.fcb-count').textContent));

  /* the bug: a reference could not be found. It can now. */
  type(box(), 'CHQ-84711'); await sleep(260);
  check('U5 typing a reference shows that receipt', pageText().includes('CHQ-84711') && pageText().includes(mine.P1.receiptNumber));
  check('U6 and only the payments that match', !pageText().includes('ZQ-CASH-7') && !pageText().includes('SUPREF-3301') && !pageText().includes('RFD-5521'));
  check('U7 the count line says how many match', /1<\/b> of \d+ payments? match/.test($('.fcb-count').innerHTML), $('.fcb-count').textContent);
  check('U8 the box kept focus and its text through the redraw', D.activeElement === box() && box().value === 'CHQ-84711');
  check('U9 a Clear filters button appeared', !!$('[data-fcpact="clear"]'));
  check('U10 the row says which invoice it was applied to', pageText().includes(invA.invoiceNumber));

  /* every list obeys the box, including the ones the old box never touched */
  type(box(), 'RFD-5521'); await sleep(260);
  check('U11 a payment to a shop is found in "Paid to shops"', $('#fcPaidToShops').textContent.includes('RFD-5521'));
  check('U12 the received and supplier lists say nothing matches instead of showing everything',
    /No received payment matches/.test(pageText()) && /No supplier payment matches/.test(pageText()));

  /* Client request (2026-09-23): "want to change amount" on a Paid-to-shops voucher —
     an "Edit amount" button opens the correction panel (ERP.Payments.editAmount). */
  check('U12a the row offers an Edit amount button (OWNER holds TRANSACTION_CORRECT)',
    !!$('#fcPaidToShops [data-fceditamt="' + mine.P4.id + '"]'));
  const c2BalBeforeEdit = ERP.Ledger.customerBalance(c2.id);
  const p4OldAmount = mine.P4.amount;             /* mine.P4 is the SAME object editAmount mutates in place */
  click($('#fcPaidToShops [data-fceditamt="' + mine.P4.id + '"]')); await sleep(150);
  check('U12b the panel opens naming the voucher and its current amount',
    $('#panel').textContent.includes(mine.P4.receiptNumber) && $('[data-f="amt"]').value === String(M.toR(p4OldAmount)),
    $('[data-f="amt"]') ? $('[data-f="amt"]').value : 'panel did not open');
  $('[data-f="amt"]').value = '650'; $('[data-f="reason"]').value = 'typed the wrong amount';
  click($('[data-save="1"]')); await sleep(300);
  check('U12c saving updates the voucher, the shop\'s balance, and the row on screen',
    ERP.Payments.byId(mine.P4.id).amount === M.toP(650) &&
    ERP.Ledger.customerBalance(c2.id) === c2BalBeforeEdit - p4OldAmount + M.toP(650) &&
    $('#fcPaidToShops').textContent.includes('650'));

  /* a role without TRANSACTION_CORRECT sees no button at all (the same gate as Change shop).
     The accounts module (22-users.js) auto-provisions a first "Owner" account and, once one
     exists, every permission check reads that account's role — not ERP.Settings.currentRole
     any more — so the role is switched by signing in as a different account, not Settings.save. */
  const ownerUserId = (ERP.Session.user() || {}).id;
  const salesUser = await ERP.Users.save({ name: 'Test Sales Clerk', role: 'SALES' });
  ERP.Session.userId = salesUser.id;
  w.go('payments'); await sleep(200);
  type(box(), 'RFD-5521'); await sleep(260);
  check('U12d a Sales-role user sees the voucher but no Edit amount button',
    pageText().includes('RFD-5521') && !$('[data-fceditamt="' + mine.P4.id + '"]'));
  ERP.Session.userId = ownerUserId;
  w.go('payments'); await sleep(200);
  type(box(), 'RFD-5521'); await sleep(260);
  check('U12e back on OWNER the button is offered again', !!$('[data-fceditamt="' + mine.P4.id + '"]'));
  click($('[data-fcpact="clear"]')); await sleep(100);

  type(box(), 'SUPREF-3301'); await sleep(260);
  check('U13 a supplier payment is found by its reference',
    pageText().includes('SUPREF-3301') && /No payment to a shop matches/.test(pageText()));

  /* Client request (2026-09-23, same day): the same "Edit amount" button, on a
     Supplier-payments voucher (mine.P5 has no allocations, so it's correctable). */
  check('U13a the supplier row offers an Edit amount button too',
    !!$('[data-fceditamt="' + mine.P5.id + '"]'));
  const supBalBeforeEdit = ERP.Ledger.supplierBalance(sup.id);
  const p5OldAmount = mine.P5.amount;              /* mine.P5 is the SAME object editAmount mutates in place */
  click($('[data-fceditamt="' + mine.P5.id + '"]')); await sleep(150);
  check('U13b the panel opens naming the voucher, its current amount and the supplier',
    $('#panel').textContent.includes(mine.P5.receiptNumber) && $('[data-f="amt"]').value === String(M.toR(p5OldAmount)) &&
    $('#panel').textContent.includes(sup.co),
    $('[data-f="amt"]') ? $('[data-f="amt"]').value : 'panel did not open');
  $('[data-f="amt"]').value = '16000'; $('[data-f="reason"]').value = 'typed the wrong amount';
  click($('[data-save="1"]')); await sleep(300);
  check('U13c saving updates the voucher, the supplier\'s balance (the opposite way to a shop refund), and the row on screen',
    ERP.Payments.byId(mine.P5.id).amount === M.toP(16000) &&
    ERP.Ledger.supplierBalance(sup.id) === supBalBeforeEdit - (M.toP(16000) - p5OldAmount) &&
    pageText().includes('16,000'));
  click($('[data-fcpact="clear"]')); await sleep(100);

  type(box(), 'REV-0007'); await sleep(260);
  check('U14 a reversed voucher is found, in its own list, with the reason and struck-out amount',
    /Reversed receipts/.test(pageText()) && pageText().includes('wrong shop') && !!$('#view table s'));
  type(box(), 'zzz-nothing-matches-this'); await sleep(260);
  check('U15 nothing matching says so, and offers to clear',
    /0<\/b> of \d+ payments? match/.test($('.fcb-count').innerHTML) && $$('[data-fcpact="clear"]').length >= 1);
  click($('.fcb-count [data-fcpact="clear"]') || $('[data-fcpact="clear"]')); await sleep(150);
  check('U16 Clear filters restores everything', box().value === '' && !$('[data-fcpact="clear"]') && /on file/.test($('.fcb-count').textContent));

  /* the filters */
  change($('[data-fcpfil="dir"]'), 'sup'); await sleep(150);
  check('U17 choosing "Paid to suppliers" leaves only that list',
    !$('#fcPaidToShops') && !$$('.sec-t').some(s => /^Customer payments/.test(s.textContent.trim())) &&
    $$('.sec-t').some(s => /^Supplier payments/.test(s.textContent.trim())));
  change($('[data-fcpfil="dir"]'), 'all'); await sleep(150);
  change($('[data-fcpfil="method"]'), 'Cheque'); await sleep(150);
  check('U18 the method filter narrows every list', pageText().includes('CHQ-84711') && !pageText().includes('RFD-5521'));
  change($('[data-fcpfil="method"]'), 'all'); await sleep(100);
  change($('[data-fcpfil="period"]'), 'custom'); await sleep(150);
  check('U19 "Custom range" shows From and To', !!$('[data-fcpfil="from"]') && !!$('[data-fcpfil="to"]'));
  change($('[data-fcpfil="from"]'), '2026-09-10'); await sleep(100);
  change($('[data-fcpfil="to"]'), '2026-01-01'); await sleep(150);
  check('U20 From after To is said on the screen and nothing is listed',
    /“From” date is after the “To” date/.test(pageText()) && !pageText().includes('CHQ-84711'));
  click($('[data-fcpact="clear"]')); await sleep(150);
  type($('[data-fcpfil="min"]'), '900'); await sleep(200);
  type($('[data-fcpfil="max"]'), '100'); await sleep(260);
  check('U21 a minimum above the maximum is said on the screen', /minimum amount is above the maximum/.test(pageText()));
  check('U22 typing in the amount box kept its focus', D.activeElement === $('[data-fcpfil="max"]'));
  click($('[data-fcpact="clear"]')); await sleep(150);
  type(box(), '14/08/2026'); await sleep(260);
  check('U23 a typed date is explained, and filters', /is read as 14 Aug 2026/.test(pageText()) && pageText().includes('CHQ-84711') &&
    !pageText().includes('ZQ-CASH-7'));
  click($('[data-fcpact="clear"]')); await sleep(100);

  /* KPIs follow the search */
  type(box(), 'RFD-5521'); await sleep(260);
  check('U24 the "Paid out" card counts payments to shops and follows the search',
    /0 to suppliers · 1 to shops in this search/.test($('.ledger').textContent), $('.ledger').textContent);
  click($('[data-fcpact="clear"]')); await sleep(100);

  /* a row's document opens */
  type(box(), 'CHQ-84711'); await sleep(260);
  click($('[data-fcreceipt]')); await sleep(200);
  check('U25 a row\'s Receipt button opens the printable receipt', !!$('[data-fcv="close"]'));
  if ($('[data-fcv="close"]')) click($('[data-fcv="close"]'));
  await sleep(80);
  click($('[data-fcpact="clear"]')); await sleep(100);

  /* lists are long: they show a page and a button for the rest */
  PS.PAGE_ROWS = 2;
  w.go('payments'); await sleep(200);
  const recTable = () => [...$$('table.fcb-list')].find(t => /Applied to/.test(t.tHead.textContent) && /Shop/.test(t.tHead.textContent));
  const nRec = PS.results(st({})).groups.rec.length;
  check('U26 setup: more received payments than the page size', nRec > 2, String(nRec));
  check('U27 the list draws only a page of rows', recTable().tBodies[0].rows.length === 2, String(recTable().tBodies[0].rows.length));
  check('U28 and says how many more there are', /Showing the first 2 of \d+/.test(pageText()) && !!$('[data-fcpact="more"]'));
  click($('[data-fcpact="more"][data-sec="rec"]')); await sleep(150);
  check('U29 "Show more" adds another page', recTable().tBodies[0].rows.length === Math.min(4, nRec), String(recTable().tBodies[0].rows.length));
  type(box(), 'CHQ'); await sleep(260);
  check('U30 a new search starts from the first page again', !$('[data-fcpact="more"]'));
  click($('[data-fcpact="clear"]')); await sleep(100);
  PS.PAGE_ROWS = 100;

  /* CSV covers every match, not just the rows drawn */
  PL.exportCsv();
  const lines = csvCaptured.replace(/^﻿/, '').split('\n');
  check('U31 CSV has a header and one line per payment on file', lines.length === ERP.S.payments.length + 1 &&
    /^"Number","Date","Kind","Party"/.test(lines[0]), `${lines.length} lines vs ${ERP.S.payments.length}`);
  check('U32 a reversed payment is marked so in the CSV', lines.some(l => l.includes('REV-0007') && l.includes('"Reversed"') && l.includes('wrong shop')));
  check('U33 the CSV names the invoice a receipt was applied to', lines.some(l => l.includes('CHQ-84711') && l.includes(invA.invoiceNumber)));
  type(box(), 'RFD-5521'); await sleep(260);
  PL.exportCsv();
  const l2 = csvCaptured.replace(/^﻿/, '').split('\n');
  check('U34 with a search on, the CSV holds just the matches', l2.length === 2 && l2[1].includes('RFD-5521'), String(l2.length));
  click($('[data-fcpact="clear"]')); await sleep(100);

  /* leaving and coming back keeps the search (like the invoice list) */
  type(box(), 'CHQ-84711'); await sleep(260);
  w.go('dashboard'); await sleep(150); w.go('payments'); await sleep(200);
  check('U35 the search is still there after visiting another screen', box().value === 'CHQ-84711' && pageText().includes('CHQ-84711'));
  click($('[data-fcpact="clear"]')); await sleep(100);

  /* the "Receive payment" button is not pre-selected with anyone */
  ERP.setPayFor && ERP.setPayFor(c2.id);
  click($('[data-fcpayopen="payment"]')); await sleep(150);
  check('U36 "Receive payment" from this screen starts with no shop chosen', $('#fcPayArea') && $('#fcPayArea').value === '',
    $('#fcPayArea') ? $('#fcPayArea').value : 'panel did not open');
  const x = $('#panel .x') || $('[data-close]') || $('#scrim'); if (x) click(x);
  await sleep(100);

  /* ══════════════════════════════════════════════════════════════════════
     THE INVOICE LIST — "which invoice did this receipt / cheque pay?"
     ══════════════════════════════════════════════════════════════════════ */
  const invHit = (q, scope) => IS.matcher(Object.assign({}, IS.DEFAULTS, { q, scope: scope || 'all' }))(ERP.S.invoices.find(i => i.id === invA.id));
  check('V1 a cheque reference finds the invoice it paid, from "Everything"', invHit('CHQ-84711'));
  check('V2 the receipt number finds it with the "Receipt / payment ref." choice', invHit(mine.P1.receiptNumber, 'payment'));
  check('V3 but the receipt number is NOT searched in "Everything" (it has the shape of an invoice number)',
    !invHit(mine.P1.receiptNumber, 'all'));
  check('V4 a payment that paid nothing of this invoice does not make it match', !invHit('ZQ-CASH-7') && !invHit('SUPREF-3301'));
  const later = await ERP.Payments.receive({ customerId: c1.id, amount: 100, method: 'Cash', reference: 'LATE-PAY-9',
    date: todayIso, allocations: [{ invoiceId: invA.id, amount: 100 }] });
  check('V5 a receipt applied later is found at once', invHit('LATE-PAY-9'));
  await ERP.Payments.reverse(later.id, 'test');
  check('V6 and stops being found once it is reversed', !invHit('LATE-PAY-9'));
  check('V7 the scope is offered in the invoice list',
    IS.SCOPES.some(s => s[0] === 'payment' && /Receipt/.test(s[1])));

  /* ══════════════════════════════════════════════════════════════════════
     SECOND PASS (2026-09-21) — edge cases found by reviewing the first
     ══════════════════════════════════════════════════════════════════════ */
  const closePanel = async () => { const b = $('#panel .x') || $('[data-close]') || $('#scrim'); if (b) click(b); await sleep(100); };
  w.go('payments'); await sleep(200);
  PS.reset(PL);

  /* the old box had a Print button; so does this one */
  check('X1 the Payments screen has a Print button', !!$('[data-export="print"]'));

  /* a payment recorded while a filter hides it must not look unsaved */
  type($('[data-fcpq]'), 'CHQ-84711'); await sleep(260);
  check('X2 setup: a search is on and there is no warning yet', !$('.fcb-note.warn'));
  const hidden = await ERP.Payments.receive({ customerId: c2.id, amount: 77, method: 'Cash', reference: 'HIDDEN-NEW-1', date: todayIso });
  w.paint(); await sleep(150);
  check('X3 a new payment the search hides is announced by its receipt number',
    $$('.fcb-note.warn').some(n => n.textContent.includes(hidden.receiptNumber) && /hidden/.test(n.textContent)),
    $$('.fcb-note').map(n => n.textContent).join(' / '));
  check('X4 and the warning has its own Clear filters button', !!$('.fcb-note.warn [data-fcpact="clear"]'));
  type($('[data-fcpq]'), 'CHQ-84711 '); await sleep(260);
  check('X5 typing again answers the warning (it goes away)', !$$('.fcb-note.warn').some(n => /hidden/.test(n.textContent)));
  click($('[data-fcpact="clear"]')); await sleep(150);
  const shownNew = await ERP.Payments.receive({ customerId: c2.id, amount: 78, method: 'Cash', reference: 'SHOWN-NEW-2', date: todayIso });
  w.paint(); await sleep(150);
  check('X6 with no filter on, a new payment raises no warning and is listed',
    !$$('.fcb-note.warn').length && $('#view').textContent.includes(shownNew.receiptNumber));
  type($('[data-fcpq]'), 'SHOWN-NEW-2'); await sleep(260);
  const visible = await ERP.Payments.receive({ customerId: c2.id, amount: 79, method: 'Cash', reference: 'SHOWN-NEW-2B', date: todayIso });
  w.paint(); await sleep(150);
  check('X7 a new payment that the search DOES match raises no warning',
    !$$('.fcb-note.warn').some(n => /hidden/.test(n.textContent)) && $('#view').textContent.includes(visible.receiptNumber));
  click($('[data-fcpact="clear"]')); await sleep(100);

  /* a reversal made by another window changes no count — the index must still notice */
  const quiet = await ERP.Payments.receive({ customerId: c2.id, amount: 5, method: 'Cash', reference: 'QUIET-REV', date: todayIso });
  name[quiet.id] = 'Q'; mineIds.add(quiet.id);
  const before = hits({ q: 'QUIET-REV reversed' });
  ERP.S.payments.find(p => p.id === quiet.id).status = 'REVERSED';       /* as a refresh from the server would */
  const afterRev = hits({ q: 'QUIET-REV reversed' });
  check('X8 a reversal that changed no record count is still picked up by the search', before === '' && afterRev === 'Q',
    `before [${before}] after [${afterRev}]`);

  /* ── the Pay supplier button ── */
  const supSel = () => $('#panel [data-f="sup"]');
  const supBanner = () => ($('#fcSupBal') || {}).textContent || '';
  const openPaySup = async () => { click($('[data-fcpayopen="paysup"]')); await sleep(180); };
  check('X9 the Pay supplier button on this screen is the clearing kind', !!$('.sec-t [data-fcpayopen="paysup"]') && !$('[data-paysup]'));
  await openPaySup();
  check('X10 the panel opens with NO supplier chosen (it used to show the first one)',
    !!supSel() && supSel().value === '' && /Choose the supplier/.test(supBanner()), supSel() ? `value=[${supSel().value}] ${supBanner()}` : 'no panel');
  $('#panel [data-f="amt"]').value = '100';
  click($('[data-save="1"]')); await sleep(250);
  check('X11 Save with no supplier is refused and pays nobody',
    !!supSel() && !ERP.S.payments.some(p => p.direction === 'OUT' && p.partyType !== 'CUSTOMER' && p.amount === M.toP(100) && p.paymentDate === todayIso),
    'panel closed or a payment was written');
  change(supSel(), sup.id); await sleep(80);
  check('X12 choosing a supplier shows what is payable to it', /Payable:/.test(supBanner()) && supBanner().includes(M.fmt(ERP.Ledger.supplierBalance(sup.id))), supBanner());
  $('#panel [data-f="amt"]').value = '100';
  click($('[data-save="1"]')); await sleep(400);
  const paid = ERP.S.payments.find(p => p.direction === 'OUT' && p.partyId === sup.id && p.amount === M.toP(100) && p.paymentDate === todayIso);
  check('X13 with a supplier chosen it is paid', !!paid);
  if ($('[data-fcv="close"]')) click($('[data-fcv="close"]'));
  await sleep(100);
  /* the hand-over variables left behind by other screens must not leak in */
  ERP.setPayFor(c1.id);                                    /* "Payment" on an invoice leaves a SHOP id here */
  w.go('payments'); await sleep(150);
  await openPaySup();
  check('X14 a shop id left in PAY_FOR does not become "the first supplier"', supSel() && supSel().value === '', supSel() ? supSel().value : 'no panel');
  await closePanel();
  ERP.setPayFor(sup.id);                                   /* Statement of Account -> "Pay this supplier" */
  w.go('payments'); await sleep(150);
  await openPaySup();
  check('X15 nor does a supplier chosen on another screen', supSel() && supSel().value === '', supSel() ? supSel().value : 'no panel');
  await closePanel();
  /* the routes that SHOULD pre-select still do */
  ERP.setPayFor(sup.id);
  w.openPanel('paysup'); await sleep(150);
  check('X16 Pay this supplier (Statement of Account) still pre-selects that supplier', supSel() && supSel().value === sup.id, supSel() ? supSel().value : 'no panel');
  await closePanel();
  ERP.setPayFor(null);
  w.go('supplierProfile', sup.id); await sleep(200);
  click($(`[data-paysup="${sup.id}"]`)); await sleep(180);
  check('X17 a supplier own page still opens the panel with that supplier', supSel() && supSel().value === sup.id, supSel() ? supSel().value : 'no panel');
  await closePanel();
  w.go('payments'); await sleep(150);
  await openPaySup();
  check('X18 and going from that page to Payments does not keep it', supSel() && supSel().value === '', supSel() ? supSel().value : 'no panel');
  await closePanel();

  /* ── the invoice list says WHY an invoice is there ── */
  w.go('invoices'); await sleep(200);
  ERP.InvoiceList.reset();
  type($('[data-fcq]'), 'CHQ-84711'); await sleep(300);
  const hitText = () => $$('.fcb-hit').map(h => h.textContent).join(' | ');
  check('X19 an invoice found by a cheque reference says which receipt paid it',
    /Paid by/.test(hitText()) && hitText().includes(mine.P1.receiptNumber) && hitText().includes('CHQ-84711'), hitText());
  type($('[data-fcq]'), invA.invoiceNumber); await sleep(300);
  check('X20 searching an invoice number itself shows no "Paid by" note', !/Paid by/.test(hitText()), hitText());
  ERP.InvoiceList.reset();
  ERP.InvoiceList.scope = 'payment'; ERP.InvoiceList.q = mine.P1.receiptNumber; w.paint(); await sleep(200);
  check('X21 the receipt number, in the payment scope, finds the invoice and says so',
    /Paid by/.test(hitText()) && $$('#view table.fcb-list tbody tr').length >= 1, hitText());
  ERP.InvoiceList.reset(); w.paint(); await sleep(100);
  check('X22 and after Clear the invoice list has its rows again', $$('#view table.fcb-list tbody tr').length >= 1);

  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  w.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
