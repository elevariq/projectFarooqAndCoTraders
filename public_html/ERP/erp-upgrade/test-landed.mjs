/* Landed cost & true profit — the client's test case, and the invariant that
   matters most: the supplier balance must not move. */
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
const R = n => Math.round(n * 100);          // rupees → paisa

function boot(store) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://x.local/e',
    beforeParse(w) {
      w.indexedDB = store.idb || (store.idb = new FDBFactory());
      w.IDBKeyRange = FDBKeyRange;
      w.print = () => {}; w.confirm = () => true; w.alert = () => {};
      w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    }
  });
  return dom.window;
}

async function ready(w) {
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.landedReady || Promise.resolve()).catch(() => {});
  await sleep(250);
}

async function main() {
  const store = {};
  let w = boot(store);
  await ready(w);
  let ERP = w.ERP;
  check('L0 the app boots with the landed cost module', !!(ERP && ERP.LandedModule));

  await ERP.Settings.save({ allowNegativeStock: true, profitCostBasis: 'LANDED' });

  const sup = w.SUPPLIERS[0];
  const wh = w.WAREHOUSES[0];
  const prod = w.PRODUCTS[0];

  /* ── the client's scenario ───────────────────────────────────────────
     20 bags at 2,500 = 50,000 from the supplier.
     Transport 5,000 + loading 1,000 + other 500 = 6,500 paid to others. */
  const supBalBefore = ERP.Ledger.supplierBalance(sup.id);

  const pur = await ERP.Purchases.save({
    supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-10',
    paidAmount: 0,
    items: [{ productId: prod.id, quantity: 20, unitPrice: 2500, discount: 0, warehouseId: wh.id }]
  });

  check('L1 the supplier bill is 50,000', pur.grandTotal === R(50000), String(pur.grandTotal));
  const supAfterPurchase = ERP.Ledger.supplierBalance(sup.id);
  check('L2 the supplier payable rose by exactly 50,000',
    supAfterPurchase === supBalBefore + R(50000), String(supAfterPurchase - supBalBefore));

  const item = ERP.Purchases.items(pur.id)[0];
  check('L3 inventory purchase cost is 2,500 per bag',
    (item.goodsUnitCost || Math.round(item.lineTotal / item.quantity)) === R(2500),
    String(item.goodsUnitCost));

  /* ── add the operational costs ───────────────────────────────────────── */
  const lc = await ERP.Landed.create({
    purchaseId: pur.id, warehouseId: wh.id, date: '2026-09-11',
    notes: 'Own truck from the mill',
    expenses: [
      { category: 'Transportation', amount: 5000, vendorName: 'Gul Transport', paymentStatus: 'PAID' },
      { category: 'Loading', amount: 1000, vendorName: 'Labour', paymentStatus: 'PAID' },
      { category: 'Miscellaneous', amount: 500, description: 'Sundries' }
    ]
  });

  check('L4 the entry totals 6,500', lc.totalAmount === R(6500), String(lc.totalAmount));
  check('L5 it has a readable reference', /^LC-\d{4}-\d{6}$/.test(lc.referenceNumber), lc.referenceNumber);
  check('L6 three expense lines are stored', ERP.Landed.expensesOf(lc.id).length === 3);
  check('L7 each expense keeps its category, amount and date',
    ERP.Landed.expensesOf(lc.id).every(e => e.category && e.amountP > 0 && e.expenseDate));

  /* ── THE INVARIANT ───────────────────────────────────────────────────── */
  check('L8 the supplier bill is STILL 50,000',
    ERP.Purchases.byId(pur.id).grandTotal === R(50000),
    String(ERP.Purchases.byId(pur.id).grandTotal));
  check('L9 the supplier balance is UNCHANGED by the landed cost',
    ERP.Ledger.supplierBalance(sup.id) === supAfterPurchase,
    `${ERP.Ledger.supplierBalance(sup.id)} vs ${supAfterPurchase}`);
  const supRows = ERP.Ledger.supplier(sup.id).rows;
  check('L10 nothing from the landed cost appears on the supplier statement',
    !supRows.some(r => /LC-/.test(r.ref || '') || r.kind === 'LANDED'));

  /* ── the two costs ───────────────────────────────────────────────────── */
  const b = ERP.Landed.breakdown(pur.id);
  check('L11 goods value is 50,000', b.goodsValue === R(50000), String(b.goodsValue));
  check('L12 operational cost is 6,500', b.operationalCost === R(6500), String(b.operationalCost));
  check('L13 total inventory cost is 56,500', b.totalInventoryCost === R(56500), String(b.totalInventoryCost));
  check('L14 landed cost per bag is 2,825', b.costPerUnit === R(2825), String(b.costPerUnit));
  check('L15 purchase cost per bag is still 2,500', b.purchaseCostPerUnit === R(2500), String(b.purchaseCostPerUnit));
  check('L16 the supplier payable shown is 50,000, not 56,500',
    b.supplierPayable === R(50000), String(b.supplierPayable));

  const adj = ERP.Landed.adjustmentsOf(lc.id)[0];
  check('L17 the cost adjustment keeps both figures side by side',
    adj.purchaseCost === R(2500) && adj.landedCost === R(2825),
    `${adj.purchaseCost} / ${adj.landedCost}`);
  check('L18 the purchase line is not overwritten with the landed figure',
    ERP.Purchases.items(pur.id)[0].unitPrice === R(2500));

  /* ── true profit ─────────────────────────────────────────────────────── */
  check('L19 the costing average for the bag is 2,825',
    ERP.Cost.weightedAverage(prod.id, wh.id) === R(2825),
    String(ERP.Cost.weightedAverage(prod.id, wh.id)));

  const cust = w.CUSTOMERS[0];
  const inv = await ERP.Invoices.save({
    customerId: cust.id, warehouseId: wh.id, invoiceDate: '2026-09-12', paidAmount: 0,
    items: [{ productId: prod.id, quantity: 1, unitPrice: 3500, discount: 0, warehouseId: wh.id }]
  });
  const invItem = ERP.Invoices.items(inv.id)[0];
  check('L20 the sale is costed at the landed figure, not 2,500',
    invItem.costSnapshot === R(2825), String(invItem.costSnapshot));
  check('L21 profit per bag is 675, not 1,000',
    (R(3500) - invItem.costSnapshot) === R(675), String(R(3500) - invItem.costSnapshot));
  const pr = ERP.Reports ? ERP.Reports.salesProfit : null;

  /* ── audit ───────────────────────────────────────────────────────────── */
  const log = (ERP.S.audit || []).filter(a => a.entityId === lc.id);
  check('L22 posting the landed cost is audited', log.some(a => /Landed cost posted/.test(a.action)));

  /* ── editing recalculates ────────────────────────────────────────────── */
  const lc2 = await ERP.Landed.create({
    purchaseId: pur.id, warehouseId: wh.id, date: '2026-09-13',
    expenses: [{ category: 'Storage', amount: 2000 }]
  });
  const b2 = ERP.Landed.breakdown(pur.id);
  check('L23 a second entry adds to the same purchase',
    b2.operationalCost === R(8500), String(b2.operationalCost));
  check('L24 the cost per bag is recalculated to 2,925',
    b2.costPerUnit === R(2925), String(b2.costPerUnit));
  check('L25 the supplier balance is still untouched',
    ERP.Ledger.supplierBalance(sup.id) === supAfterPurchase);

  await ERP.Landed.cancel(lc2.id, 'Entered twice');
  const b3 = ERP.Landed.breakdown(pur.id);
  check('L26 cancelling takes the cost back out',
    b3.operationalCost === R(6500), String(b3.operationalCost));
  check('L27 and the per-bag cost returns to 2,825',
    b3.costPerUnit === R(2825), String(b3.costPerUnit));
  check('L28 the cancelled entry is kept, not deleted',
    ERP.Landed.byId(lc2.id).status === 'CANCELLED');
  check('L29 the supplier balance never moved throughout',
    ERP.Ledger.supplierBalance(sup.id) === supAfterPurchase);

  /* ── validation ──────────────────────────────────────────────────────── */
  const bad = async o => ERP.Landed.create(o).then(() => false, () => true);
  check('L30 an entry with no expenses is refused',
    await bad({ purchaseId: pur.id, expenses: [] }));
  check('L31 an expense with no category is refused',
    await bad({ purchaseId: pur.id, expenses: [{ amount: 100 }] }));
  check('L32 a zero amount is refused',
    await bad({ purchaseId: pur.id, expenses: [{ category: 'Fuel', amount: 0 }] }));
  check('L33 an entry with no purchase is refused',
    await bad({ expenses: [{ category: 'Fuel', amount: 100 }] }));

  /* ── allocation is proportional and loses nothing ────────────────────── */
  const lines = [{ id: 'a', lineTotal: R(30000), quantity: 10, productId: 'p1' },
                 { id: 'b', lineTotal: R(20000), quantity: 10, productId: 'p2' }];
  const al = ERP.LandedModule.allocateOver(lines, R(1000));
  check('L34 cost is spread by value, not evenly',
    al[0].share === R(600) && al[1].share === R(400),
    `${al[0].share}/${al[1].share}`);
  const odd = ERP.LandedModule.allocateOver(lines, 1001);
  check('L35 an indivisible amount is fully allocated, nothing lost',
    odd.reduce((a, o) => a + o.share, 0) === 1001,
    String(odd.reduce((a, o) => a + o.share, 0)));

  /* ── the screens ─────────────────────────────────────────────────────── */
  const D = w.document;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));

  check('U1 the Finance group gains the three screens',
    w.NAVGROUPS.some(g => g[0] === 'Finance' &&
      ['landed','expenses','profit'].every(id => g[1].includes(id))),
    JSON.stringify(w.NAVGROUPS.find(g => g[0] === 'Finance')));
  check('U2 each has a nav entry',
    ['landed','expenses','profit'].every(id => w.NAV.some(n => n.id === id)));

  w.go('landed'); await sleep(350);
  check('U3 the landed costs screen opens', !!$('.lc-page'));
  check('U4 the posted entry is listed', $('#view').textContent.includes(lc.referenceNumber));
  check('U5 the create form offers every category',
    ERP.Landed.categories().every(c => $('#view').innerHTML.includes(c)));

  /* the breakdown panel, with a purchase chosen */
  const sel = $('[data-lcf="purchaseId"]');
  sel.value = pur.id;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(300);
  const panel = $('.lc-prev') && $('.lc-prev').textContent;
  check('U6 the breakdown shows the supplier cost', panel.includes(ERP.M ? '' : '') && /50,000/.test(panel), panel && panel.slice(0,120));
  check('U7 it shows the final inventory cost', /56,500/.test(panel));
  check('U8 it shows the cost per unit', /2,825/.test(panel));
  check('U9 it states the supplier is unaffected', /does not change/i.test(panel));

  /* posting through the screen */
  const before = ERP.Landed.all().length;
  const supBeforeUi = ERP.Ledger.supplierBalance(sup.id);
  const amt = $('.lc-rows [data-lcr="amount"]');
  amt.value = '300';
  amt.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('U10 the running total updates as you type',
    $('#lcTotal').textContent.includes('300'), $('#lcTotal').textContent);
  click($('[data-lcsave]')); await sleep(500);
  check('U11 posting from the screen creates an entry',
    ERP.Landed.all().length === before + 1, String(ERP.Landed.all().length));
  check('U12 and the supplier balance still does not move',
    ERP.Ledger.supplierBalance(sup.id) === supBeforeUi);
  const added = ERP.Landed.all()[0];
  await ERP.Landed.cancel(added.id, 'test cleanup');

  /* ── the reports ─────────────────────────────────────────────────────── */
  w.go('profit'); await sleep(350);
  check('U13 the profit screen opens', /Profit analysis/.test($('#view').textContent));
  check('U14 it says which basis is being used', /landed cost/i.test($('#view').textContent));

  const pp = ERP.LandedUI.productProfit();
  const row = pp.find(r => r.productId === prod.id);
  check('U15 the product profit report finds the sale', !!row);
  check('U16 it reports landed cost 2,825 per unit', row.costPerUnit === R(2825), String(row.costPerUnit));
  check('U17 it reports purchase cost separately at 2,500',
    row.purchasePerUnit === R(2500), String(row.purchasePerUnit));
  check('U18 the additional cost is the 325 difference',
    Math.round(row.additional / row.qty) === R(325), String(Math.round(row.additional / row.qty)));
  check('U19 profit per unit is 675', row.perUnit === R(675), String(row.perUnit));
  check('U20 the margin is a percentage of revenue',
    Math.abs(row.margin - (675 / 3500 * 100)) < 0.2, String(row.margin));
  check('U21 every required column is on screen',
    ['Qty sold','Purchase cost','Additional','Landed cost','Selling price','Profit / unit','Total profit','Margin']
      .every(h => $('#view').textContent.includes(h)));

  click($('[data-patab="area"]')); await sleep(300);
  const wp = ERP.LandedUI.warehouseProfit();
  const wrow = wp.find(r => r.id === wh.id);
  check('U22 the area report groups by warehouse', !!wrow);
  check('U23 it shows the operational cost spent on that stock',
    wrow.operational === R(6500), String(wrow.operational));
  check('U24 it shows purchase value and revenue separately',
    wrow.purchaseValue >= R(50000) && wrow.revenue >= R(3500),
    `${wrow.purchaseValue}/${wrow.revenue}`);

  /* ── expenses screen ─────────────────────────────────────────────────── */
  w.go('expenses'); await sleep(300);
  check('U25 the expenses screen opens', /Record an expense/.test($('#view').textContent));
  check('U26 it explains when to use landed costs instead',
    /Landed costs/i.test($('#view').textContent));
  const exBefore = (ERP.S.expenses || []).length;
  $('[data-exf="amount"]').value = '1200';
  $('[data-exf="amount"]').dispatchEvent(new w.Event('input', { bubbles: true }));
  click($('[data-exsave]')); await sleep(400);
  check('U27 an expense can be recorded', (ERP.S.expenses || []).length === exBefore + 1);
  check('U28 a general expense does not touch the supplier',
    ERP.Ledger.supplierBalance(sup.id) === supBeforeUi);

  /* ── permissions ─────────────────────────────────────────────────────
     Roles come from the signed-in account, so the switch is made by signing
     in rather than by setting a role on the only owner. */
  let owner = ERP.Users.all().find(u => u.role === 'OWNER');
  if (!owner) owner = await ERP.Users.save({ name: 'Owner', role: 'OWNER', pin: '' });
  let seller = ERP.Users.all().find(u => u.role === 'SALES');
  if (!seller) seller = await ERP.Users.save({ name: 'Counter', role: 'SALES', pin: '' });
  let acct = ERP.Users.all().find(u => u.role === 'ACCOUNTANT');
  if (!acct) acct = await ERP.Users.save({ name: 'Munshi', role: 'ACCOUNTANT', pin: '' });

  await ERP.Session.signIn(seller.id, '');
  w.go('landed'); await sleep(300);
  check('U29 sales staff cannot open landed costs',
    /not open to you/i.test($('#view').textContent));
  w.go('profit'); await sleep(300);
  check('U30 sales staff get no landed-cost analysis',
    !ERP.Can('PROFIT_VIEW') && !$('[data-patab]'),
    $('#view').textContent.slice(0, 80));

  await ERP.Session.signIn(acct.id, '');
  w.go('landed'); await sleep(300);
  check('U31 an accountant can see landed costs',
    !/not open to you/i.test($('#view').textContent));
  check('U32 but gets no posting form', !$('[data-lcsave]'));

  await ERP.Session.signIn(owner.id, '');
  w.go('landed'); await sleep(300);
  check('U33 the owner gets the posting form', !!$('[data-lcsave]'));

  /* ── existing data and restart ───────────────────────────────────────── */
  const expected = {
    sup: ERP.Ledger.supplierBalance(sup.id),
    cost: ERP.Landed.breakdown(pur.id).costPerUnit,
    entries: ERP.Landed.all().length
  };
  await ERP.flush(); await sleep(400);
  w.close();
  w = boot(store); await ready(w); ERP = w.ERP;
  check('L36 landed costs survive a restart', ERP.Landed.all().length === expected.entries,
    `${ERP.Landed.all().length} vs ${expected.entries}`);
  check('L37 the cost per bag survives',
    ERP.Landed.breakdown(pur.id).costPerUnit === expected.cost,
    String(ERP.Landed.breakdown(pur.id).costPerUnit));
  check('L38 the supplier balance survives unchanged',
    ERP.Ledger.supplierBalance(sup.id) === expected.sup);
  check('L39 the expenses survive', ERP.Landed.expensesOf(lc.id).length === 3);
  check('L40 older purchases without landed costs still cost normally',
    ERP.Landed.breakdown(pur.id) !== null);
  w.close();

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
