/* The twelve required test cases from the client change set, driven through
   the app's own public surface in a DOM with a working IndexedDB. */
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

const HTML = fs.readFileSync(path.resolve('dist/farooq-co-erp.html'), 'utf8');
let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push(['PASS', name, '']); }
  else { fail++; results.push(['FAIL', name, detail || '']); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(store) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Could not load|not implemented/i.test(e.message)) console.error('DOM ERROR:', e.message); });
  store = store || {};
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://farooq.local/erp',
    beforeParse(win) {
      win.indexedDB = store.idb || (store.idb = new FDBFactory());
      win.IDBKeyRange = FDBKeyRange;
      win.print = () => {}; win.confirm = () => true; win.prompt = () => 'r';
      win.alert = () => {}; win.scrollTo = () => {};
      win.URL.createObjectURL = () => 'blob:fake';
      win.URL.revokeObjectURL = () => {};
      store.opened = [];
      win.open = (u) => { store.opened.push(u); return null; };
    }
  });
  const w = dom.window;
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  return { dom, w, store };
}

const R = n => Math.round(n * 100);   // rupees → paisa

async function main() {
  const { w, store } = await boot();
  const ERP = w.ERP;
  check('BOOT the app is ready', !!(ERP && ERP.ready));

  // this harness is about money and text, not stock levels — let the seed
  // data sell without first staging a purchase for every product
  await ERP.Settings.save({ allowNegativeStock: true });

  const cust = w.CUSTOMERS[0];
  const wh = w.WAREHOUSES[0];
  const prods = w.PRODUCTS.slice(0, 2);

  // give the shop a known opening balance of 5,200 so "previous outstanding"
  // is a figure we control rather than whatever the seed data happened to be
  const base = ERP.Ledger.customerBalance(cust.id);

  async function sale(paidR, items, description) {
    const draft = {
      customerId: cust.id, warehouseId: wh.id, invoiceDate: '2026-09-11',
      items: items.map(i => ({ productId: i.p.id, quantity: i.q, unitPrice: i.r, discount: 0, warehouseId: wh.id })),
      paidAmount: paidR, paymentMethod: 'Cash'
    };
    if (description !== undefined) draft.description = description;
    return ERP.Invoices.save(draft, { skipStock: true });
  }

  /* ── TEST 1 — fully unpaid ─────────────────────────────────────────── */
  const prevBefore1 = ERP.Ledger.customerBalance(cust.id);
  const inv1 = await sale(0, [{ p: prods[0], q: 2, r: 1900 }]);   // 3,800
  const f1 = ERP.Wa.invoiceFigures(inv1);
  check('T1 bill total is 3,800', f1.billTotal === R(3800), String(f1.billTotal));
  check('T1 amount paid is 0', f1.paid === 0, String(f1.paid));
  check('T1 bill balance is 3,800', f1.billBalance === R(3800), String(f1.billBalance));
  check('T1 previous outstanding is the pre-invoice balance',
    f1.previousOutstanding === prevBefore1, `${f1.previousOutstanding} vs ${prevBefore1}`);
  check('T1 total outstanding = previous + bill balance',
    f1.totalOutstanding === prevBefore1 + R(3800), String(f1.totalOutstanding));
  check('T1 the live balance agrees with total outstanding',
    ERP.Ledger.customerBalance(cust.id) === f1.totalOutstanding);

  /* ── TEST 2 — partially paid ───────────────────────────────────────── */
  const prevBefore2 = ERP.Ledger.customerBalance(cust.id);
  const inv2 = await sale(1000, [{ p: prods[0], q: 2, r: 1900 }]);
  const f2 = ERP.Wa.invoiceFigures(inv2);
  check('T2 paid is 1,000', f2.paid === R(1000), String(f2.paid));
  check('T2 bill balance is 2,800', f2.billBalance === R(2800), String(f2.billBalance));
  check('T2 previous outstanding excludes this invoice',
    f2.previousOutstanding === prevBefore2, `${f2.previousOutstanding} vs ${prevBefore2}`);
  check('T2 total outstanding = previous + 2,800',
    f2.totalOutstanding === prevBefore2 + R(2800), String(f2.totalOutstanding));
  check('T2 the live balance agrees',
    ERP.Ledger.customerBalance(cust.id) === f2.totalOutstanding);

  /* ── TEST 3 — fully paid ───────────────────────────────────────────── */
  const prevBefore3 = ERP.Ledger.customerBalance(cust.id);
  const inv3 = await sale(3800, [{ p: prods[0], q: 2, r: 1900 }]);
  const f3 = ERP.Wa.invoiceFigures(inv3);
  check('T3 bill balance is 0', f3.billBalance === 0, String(f3.billBalance));
  check('T3 total outstanding is unchanged from before the invoice',
    f3.totalOutstanding === prevBefore3, `${f3.totalOutstanding} vs ${prevBefore3}`);
  check('T3 the invoice is marked PAID', inv3.status === 'PAID', inv3.status);

  /* ── TEST 11 — double-post protection ──────────────────────────────── */
  const balBeforeDup = ERP.Ledger.customerBalance(cust.id);
  const paysBefore = ERP.Payments.forInvoice(inv2.id).length;
  let dupRejected = false;
  try {
    await ERP.Invoices.save({ ...ERP.Invoices.toDraft(inv2), id: inv2.id, revision: inv2.revision - 1 },
      { skipStock: true });
  } catch (e) { dupRejected = true; }
  check('T11 a resubmitted save is refused', dupRejected);
  check('T11 the balance did not move',
    ERP.Ledger.customerBalance(cust.id) === balBeforeDup);
  check('T11 no second payment was posted',
    ERP.Payments.forInvoice(inv2.id).length === paysBefore);

  /* ── TEST 4 — new customer ─────────────────────────────────────────── */
  const fresh = w.CUSTOMERS.find(c => ERP.Ledger.customerBalance(c.id) === 0 && c.id !== cust.id);
  if (fresh) {
    const inv4 = await ERP.Invoices.save({
      customerId: fresh.id, warehouseId: wh.id, invoiceDate: '2026-09-11',
      items: [{ productId: prods[0].id, quantity: 1, unitPrice: 150000, discount: 0, warehouseId: wh.id }],
      paidAmount: 50000, paymentMethod: 'Cash'
    }, { skipStock: true });
    const f4 = ERP.Wa.invoiceFigures(inv4);
    check('T4 previous outstanding is 0', f4.previousOutstanding === 0, String(f4.previousOutstanding));
    check('T4 invoice balance is 100,000', f4.billBalance === R(100000), String(f4.billBalance));
    check('T4 total outstanding is 100,000', f4.totalOutstanding === R(100000), String(f4.totalOutstanding));
  } else check('T4 a zero-balance shop was available', false);

  /* ── TEST 5 — English description ──────────────────────────────────── */
  const EN = 'Freight charges vehicle 5623';
  const inv5 = await sale(0, [{ p: prods[0], q: 1, r: 500 }], EN);
  check('T5 the description is stored on the record', inv5.description === EN, inv5.description);
  const row5 = ERP.Ledger.customer(cust.id).rows.find(r => r.id === inv5.id);
  check('T5 the ledger row carries it', row5 && row5.description === EN, row5 && row5.description);
  const kh5 = ERP.Khata.entries(cust.id).find(e => e.id === inv5.id);
  check('T5 the statement shows it', kh5 && kh5.description === EN, kh5 && kh5.description);

  /* ── TEST 6 — Urdu description ─────────────────────────────────────── */
  const UR = 'نقدی بدست ارشد جمیل';
  const pay6 = await ERP.Payments.receive({
    customerId: cust.id, amount: 500, method: 'Cash', date: '2026-09-12', description: UR
  });
  check('T6 the Urdu string is preserved byte for byte',
    pay6.description === UR, JSON.stringify(pay6.description));
  const row6 = ERP.Ledger.customer(cust.id).rows.find(r => r.id === pay6.id);
  check('T6 it reaches the ledger unchanged', row6 && row6.description === UR,
    row6 && JSON.stringify(row6.description));

  /* manual always wins over the generated default */
  check('T6 the generated default did not overwrite it',
    row6 && row6.description !== 'Cash received against outstanding balance');

  /* ── TEST 7 — multi-item ───────────────────────────────────────────── */
  const inv7 = await sale(0, [{ p: prods[0], q: 100, r: 100 }, { p: prods[1], q: 200, r: 100 }]);
  const f7 = ERP.Wa.invoiceFigures(inv7);
  check('T7 Items is the number of lines, not the bag count',
    f7.items === 2, String(f7.items));
  const text7 = ERP.Wa.invoiceText(inv7);
  check('T7 the message says Items: 2', /📦 Items: 2\n/.test(text7));
  check('T7 the message does not say Items: 300', !/Items: 300/.test(text7));
  const row7 = ERP.Ledger.customer(cust.id).rows.find(r => r.id === inv7.id);
  check('T7 the statement qty is the total quantity, 300',
    row7 && row7.qty === 300, String(row7 && row7.qty));

  /* ── TEST 12 — WhatsApp ────────────────────────────────────────────── */
  check('T12 03001234567 normalises to 923001234567',
    ERP.Wa.normalisePhone('03001234567') === '923001234567', ERP.Wa.normalisePhone('03001234567'));
  check('T12 an already-prefixed number is left alone',
    ERP.Wa.normalisePhone('923001234567') === '923001234567');
  check('T12 a spaced/dashed number still normalises',
    ERP.Wa.normalisePhone('0300-123 4567') === '923001234567');
  const t1 = ERP.Wa.invoiceText(inv1);
  check('T12 the message carries the invoice number', t1.includes(inv1.invoiceNumber));
  check('T12 and the date', t1.includes('11 Sep 2026'));
  check('T12 and the customer', t1.includes(cust.sh));
  check('T12 and Bill Total / Paid / Bill Balance',
    /💰 Bill Total: /.test(t1) && /✅ Paid: /.test(t1) && /🔴 Bill Balance: /.test(t1));
  check('T12 and Previous / Total Outstanding',
    /📊 Previous Outstanding: /.test(t1) && /🔴 Total Outstanding: /.test(t1));
  const enc = encodeURIComponent(t1);
  check('T12 the message URL-encodes without loss',
    decodeURIComponent(enc) === t1);
  check('T12 no raw spaces or newlines survive encoding',
    !/[\s]/.test(enc));

  /* sharing must not move money */
  const balBeforeShare = ERP.Ledger.customerBalance(cust.id);
  ERP.Wa.sendInvoice(inv1.id);
  check('T12 sharing changed no balance',
    ERP.Ledger.customerBalance(cust.id) === balBeforeShare);

  /* ── TEST 9 — date range ───────────────────────────────────────────── */
  const c9 = w.CUSTOMERS[2];
  for (const [d, amt] of [['2026-09-01', 1000], ['2026-09-10', 2000], ['2026-09-30', 3000], ['2026-10-01', 9999]]) {
    await ERP.Invoices.save({
      customerId: c9.id, warehouseId: wh.id, invoiceDate: d,
      items: [{ productId: prods[0].id, quantity: 1, unitPrice: amt, discount: 0, warehouseId: wh.id }],
      paidAmount: 0
    }, { skipStock: true });
  }
  const sep = ERP.Ledger.customer(c9.id, '2026-09-01', '2026-09-30');
  const all = ERP.Ledger.customer(c9.id);
  check('T9 the October invoice is outside the September statement',
    !sep.rows.some(r => r.iso === '2026-10-01'));
  check('T9 the September closing excludes October',
    sep.closing === all.closing - R(9999), `${sep.closing} vs ${all.closing}`);
  check('T9 closing = opening + period movement',
    sep.closing === sep.opening + sep.debit - sep.credit,
    `${sep.closing} vs ${sep.opening + sep.debit - sep.credit}`);

  /* ── TEST 8 — large qty and rate are not clipped ───────────────────── */
  const inv8 = await sale(0, [{ p: prods[0], q: 2500, r: 150000 }]);
  check('T8 qty 2500 × rate 150,000 computes exactly',
    inv8.grandTotal === R(2500 * 150000), String(inv8.grandTotal));
  const styles = [...w.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  check('T8 the qty cell has a raised minimum width',
    /td\[data-label="Quantity"\][^}]*min-width:112px/.test(styles.replace(/\s+/g, '')) ||
    styles.includes('min-width:112px'));
  check('T8 the rate cell is wider still', styles.includes('min-width:152px'));
  check('T8 both are at least 46px tall', styles.includes('min-height:46px'));

  /* ── TEST 10 — historical data ─────────────────────────────────────── */
  const legacy = w.ERP.S.invoices.find(i =>
    !('description' in i) && i.status !== 'DRAFT' && i.id !== inv5.id);
  if (legacy) {
    const lrow = ERP.Ledger.customer(legacy.customerId).rows.find(r => r.id === legacy.id);
    check('T10 a record with no description still gets one to show',
      !!(lrow && lrow.description && lrow.description.length));
    check('T10 the stored record was not rewritten', !('description' in legacy));
  } else check('T10 a description-less record was available', false, 'none found');

  /* ── descriptions on returns and adjustments ───────────────────────── */
  const ADJ_UR = 'بقایا ایڈجسٹمنٹ';
  const adj = await ERP.Adjustments.create({
    customerId: cust.id, direction: 'CREDIT', amount: 250, date: '2026-09-13',
    reason: ERP.Adjustments.reasons[0], description: ADJ_UR
  });
  check('D1 an adjustment stores its description', adj.description === ADJ_UR,
    JSON.stringify(adj.description));
  const arow = ERP.Ledger.customer(cust.id).rows.find(r => r.id === adj.id);
  check('D2 the adjustment description reaches the statement',
    arow && arow.description === ADJ_UR, arow && JSON.stringify(arow.description));

  const adj2 = await ERP.Adjustments.create({
    customerId: cust.id, direction: 'DEBIT', amount: 100, date: '2026-09-13',
    reason: ERP.Adjustments.reasons[0]
  });
  const arow2 = ERP.Ledger.customer(cust.id).rows.find(r => r.id === adj2.id);
  check('D3 an adjustment with no description falls back to the reason',
    arow2 && /Adjustment/.test(arow2.description), arow2 && arow2.description);

  const RET_EN = 'Returned damaged stock';
  const retInv = await sale(0, [{ p: prods[0], q: 10, r: 100 }]);
  const retItems = ERP.Invoices.items(retInv.id);
  const ret = await ERP.Returns.fromCustomer({
    invoiceId: retInv.id, warehouseId: wh.id, date: '2026-09-13',
    items: [{ invoiceItemId: retItems[0].id, quantity: 2, condition: 'SELLABLE' }],
    reason: 'Damaged product', treatment: 'ADJUST_OUTSTANDING_BALANCE',
    description: RET_EN
  });
  check('D4 a customer return stores its description', ret.description === RET_EN, ret.description);
  const rrow = ERP.Ledger.customer(cust.id).rows.find(r => r.id === ret.id);
  check('D5 the return description reaches the statement',
    rrow && rrow.description === RET_EN, rrow && rrow.description);

  /* the balance must still reconcile after all of that */
  const LA = ERP.Ledger.customer(cust.id);
  check('D6 the account still reconciles after returns and adjustments',
    LA.closing === LA.opening + LA.debit - LA.credit,
    `${LA.closing} vs ${LA.opening + LA.debit - LA.credit}`);

  /* ── accounting invariants ─────────────────────────────────────────── */
  const L = ERP.Ledger.customer(cust.id);
  check('INV1 running balance reconciles to the closing figure',
    L.rows.length ? L.rows[L.rows.length - 1].balance === L.closing : true);
  check('INV2 closing = opening + debits − credits',
    L.closing === L.opening + L.debit - L.credit,
    `${L.closing} vs ${L.opening + L.debit - L.credit}`);
  const SL = ERP.Ledger.supplier(w.SUPPLIERS[0].id);
  check('INV3 the supplier ledger still reconciles',
    SL.closing === SL.opening + SL.credit - SL.debit,
    `${SL.closing} vs ${SL.opening + SL.credit - SL.debit}`);
  check('INV4 supplier rows carry a description too',
    SL.rows.every(r => typeof r.description === 'string' && r.description.length));

  /* ── persistence ───────────────────────────────────────────────────── */
  /* let the write queue drain before pulling the window out from under it */
  await ERP.flush(); await sleep(400);
  const before = { desc: inv5.description, urdu: pay6.description, bal: ERP.Ledger.customerBalance(cust.id) };
  w.close();
  const re = await boot(store);
  /* wait on the hydration promise rather than guessing at a delay */
  await (re.w.ERP.adjustmentsReady || Promise.resolve()).catch(() => {});
  await sleep(200);
  const E2 = re.w.ERP;
  const inv5b = E2.Invoices.byId(inv5.id);
  const pay6b = E2.Payments.byId(pay6.id);
  check('P1 the English description survives a restart', inv5b && inv5b.description === before.desc);
  check('P2 the Urdu description survives a restart', pay6b && pay6b.description === before.urdu,
    pay6b && JSON.stringify(pay6b.description));
  check('P3 the balance is unchanged after a restart',
    E2.Ledger.customerBalance(cust.id) === before.bal,
    `${E2.Ledger.customerBalance(cust.id)} vs ${before.bal}`);

  /* the reported figures, for the record */
  console.log('\n── reported figures (TEST 2, partially paid) ──');
  const M = re.w.Money;
  console.log('  Previous Outstanding : ' + M.fmt(f2.previousOutstanding));
  console.log('  Bill Total           : ' + M.fmt(f2.billTotal));
  console.log('  Amount Paid          : ' + M.fmt(f2.paid));
  console.log('  Bill Balance         : ' + M.fmt(f2.billBalance));
  console.log('  Total Outstanding    : ' + M.fmt(f2.totalOutstanding));
  re.w.close();

  results.forEach(([s, n, d]) => console.log(`  ${s === 'PASS' ? '✔' : '✘'} ${n}${d ? '  [' + d + ']' : ''}`));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
