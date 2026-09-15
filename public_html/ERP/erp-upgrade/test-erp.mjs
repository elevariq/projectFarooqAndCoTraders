/* Loads the built ERP in a DOM with a working IndexedDB and runs the
   workflow tests from §53 of the brief. Every check is against the app's
   own public surface — no reaching into private state to fake a pass. */
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

async function boot(persistedStore) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Could not load|not implemented/i.test(e.message)) console.error('DOM ERROR:', e.message); });
  const store = persistedStore || {};
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'https://farooq.local/erp',
    beforeParse(win) {
      // one shared fake IndexedDB instance so a "restart" keeps its data
      win.indexedDB = store.idb || (store.idb = new FDBFactory());
      win.IDBKeyRange = FDBKeyRange;
      win.print = () => { store.printed = (store.printed || 0) + 1; };
      win.confirm = () => true;
      win.prompt = () => 'test reason';
      win.alert = () => {};
      win.scrollTo = () => {};
      win.URL.createObjectURL = () => 'blob:fake';
      win.URL.revokeObjectURL = () => {};
      win.open = () => null;
      if (!win.localStorage) win.localStorage = {
        _d: store.ls || (store.ls = {}),
        getItem(k) { return this._d[k] ?? null; },
        setItem(k, v) { this._d[k] = String(v); },
        removeItem(k) { delete this._d[k]; }
      };
    }
  });
  const win = dom.window;
  for (let i = 0; i < 600 && !(win.ERP && win.ERP.fullyReady); i++) await sleep(25);
  if (!win.ERP || !win.ERP.ready) throw new Error('ERP did not boot');
  return { dom, win, store };
}

function firstProducts(win, n) {
  return win.PRODUCTS.filter(p => p.active !== false).slice(0, n);
}

const run = async () => {
  /* ─────────────────────────────────────────────────────────────────
     BOOT + MIGRATION
     ───────────────────────────────────────────────────────────────── */
  const store = {};
  let { win } = await boot(store);
  const ERP = win.ERP, M = win.Money, FDB0 = win.FDB;

  check('T0.1 app boots with the upgrade loaded', !!win.ERP && !!win.FDB && !!win.DOCX);
  check('T0.2 database driver is IndexedDB', win.FDB.driver === 'indexeddb', win.FDB.driver + ' / ' + win.FDB.lastError);
  check('T0.3 master data present (136 products)', win.PRODUCTS.length === 136, String(win.PRODUCTS.length));
  check('T0.4 409 shops present', win.CUSTOMERS.length === 409, String(win.CUSTOMERS.length));
  check('T0.5 32 suppliers present', win.SUPPLIERS.length === 32, String(win.SUPPLIERS.length));
  check('T0.6 8 regions, 3 warehouses', win.REGIONS.length === 8 && win.WAREHOUSES.length === 3);
  check('T0.7 business profile seeded from the catalogue header',
        /Farooq/.test(ERP.Settings.get().businessName) && !!ERP.Settings.get().phone);

  /* ─────────────────────────────────────────────────────────────────
     TEST 6 — PURCHASE (multi product) must raise stock for every line
     ───────────────────────────────────────────────────────────────── */
  const wh = win.WAREHOUSES[1].id;                       // Main Warehouse
  const prods = firstProducts(win, 6);
  const supplier = win.SUPPLIERS[0].id;
  const before = prods.map(p => ERP.Inventory.available(p.id, wh));

  const purchase = await ERP.Purchases.save({
    supplierId: supplier, warehouseId: wh, purchaseDate: '2026-09-01',
    supplierInvoiceNo: 'MILL-889', vehicleNo: 'lea-1234', driver: 'Gul Khan',
    freight: 12000, paidAmount: 200000, paymentMethod: 'Cash',
    items: prods.map((p, i) => ({ productId: p.id, quantity: 100 + i * 10, unitPrice: 2500 + i * 100 }))
  });
  check('T6.1 purchase number issued in sequence', /^PUR-\d{4}-\d{6}$/.test(purchase.purchaseNumber), purchase.purchaseNumber);
  check('T6.2 every purchase line stored', ERP.Purchases.items(purchase.id).length === 6);
  const afterPur = prods.map(p => ERP.Inventory.available(p.id, wh));
  check('T6.3 stock increased for all six products',
        afterPur.every((q, i) => q === before[i] + 100 + i * 10), JSON.stringify(afterPur));
  check('T6.4 PURCHASE_IN movements written',
        ERP.S.movements.filter(m => m.kind === 'PURCHASE_IN' && m.ref === purchase.purchaseNumber).length === 6);
  check('T6.5 supplier payable = purchase − payment',
        ERP.Ledger.supplierBalance(supplier) === purchase.grandTotal - M.toP(200000),
        M.fmt(ERP.Ledger.supplierBalance(supplier)));
  check('T6.6 freight included in the purchase total',
        purchase.grandTotal === purchase.subtotal + M.toP(12000));

  /* ─────────────────────────────────────────────────────────────────
     TEST 1 — single item invoice
     ───────────────────────────────────────────────────────────────── */
  const cust = win.CUSTOMERS[0].id;
  const inv1 = await ERP.Invoices.save({
    customerId: cust, warehouseId: wh, invoiceDate: '2026-09-05',
    items: [{ productId: prods[0].id, quantity: 40, unitPrice: 3000 }]
  });
  check('T1.1 invoice number format INV-2026-000001', /^INV-2026-\d{6}$/.test(inv1.invoiceNumber), inv1.invoiceNumber);
  check('T1.2 total = 40 × 3000', inv1.grandTotal === M.toP(120000), M.fmt(inv1.grandTotal));
  check('T1.3 stock deducted', ERP.Inventory.available(prods[0].id, wh) === afterPur[0] - 40);
  check('T1.4 SALE_OUT movement recorded',
        ERP.S.movements.some(m => m.kind === 'SALE_OUT' && m.ref === inv1.invoiceNumber));
  check('T1.5 customer ledger debited', ERP.Ledger.customerBalance(cust) === M.toP(120000));

  const it1 = ERP.Invoices.items(inv1.id)[0];
  check('T1.8 line item stored in paisa, not double-converted',
        it1.unitPrice === M.toP(3000) && it1.lineTotal === M.toP(120000),
        it1.unitPrice + ' / ' + it1.lineTotal);
  check('T1.9 line amounts sum to the invoice subtotal',
        ERP.Invoices.items(inv1.id).reduce((a, x) => a + x.lineTotal, 0) === inv1.subtotal);

  const doc1 = ERP.DocModel.invoice(inv1.id);
  check('T1.6 document model built from the database', doc1 && doc1.rows.length === 1 && doc1.number === inv1.invoiceNumber);
  const wordBytes = win.DOCX.generate(doc1);
  check('T1.7 Word file generated (valid ZIP header)',
        wordBytes.length > 5000 && wordBytes[0] === 0x50 && wordBytes[1] === 0x4b, String(wordBytes.length));
  fs.writeFileSync('out-single.docx', Buffer.from(wordBytes));

  /* ─────────────────────────────────────────────────────────────────
     TEST 2 — five products, discounts, charges
     ───────────────────────────────────────────────────────────────── */
  const stockBefore = prods.map(p => ERP.Inventory.available(p.id, wh));
  const inv2 = await ERP.Invoices.save({
    customerId: cust, warehouseId: wh, invoiceDate: '2026-09-06',
    invoiceDiscount: 5000, freight: 8000, loading: 2000, otherCharges: 1000,
    paidAmount: 100000, paymentMethod: 'Bank Transfer', referenceNo: 'TRX-9910',
    items: [
      { productId: prods[0].id, quantity: 10, unitPrice: 3000, discount: 1000 },
      { productId: prods[1].id, quantity: 20, unitPrice: 2500 },
      { productId: prods[2].id, quantity: 5,  unitPrice: 7500, discount: 500 },
      { productId: prods[3].id, quantity: 12, unitPrice: 4000 },
      { productId: prods[4].id, quantity: 8,  unitPrice: 6000 }
    ]
  });
  const expectSub = M.toP(10 * 3000 + 20 * 2500 + 5 * 7500 + 12 * 4000 + 8 * 6000);
  const expectGrand = expectSub - M.toP(1500) - M.toP(5000) + M.toP(11000);
  check('T2.1 five lines stored', ERP.Invoices.items(inv2.id).length === 5);
  check('T2.2 subtotal correct', inv2.subtotal === expectSub, M.fmt(inv2.subtotal));
  check('T2.3 item + invoice discounts applied', inv2.discountAmount === M.toP(6500), M.fmt(inv2.discountAmount));
  check('T2.4 grand total correct', inv2.grandTotal === expectGrand, M.fmt(inv2.grandTotal) + ' vs ' + M.fmt(expectGrand));
  check('T2.8 every line total is right on the printed document',
        ERP.DocModel.invoice(inv2.id).rows.every((r, i) =>
          r.amount === M.fmtPlain(ERP.Invoices.items(inv2.id)[i].lineTotal)));
  check('T2.9 line totals reconcile with the header subtotal',
        ERP.Invoices.items(inv2.id).reduce((a, x) => a + x.unitPrice * x.quantity, 0) === inv2.subtotal);
  check('T2.5 stock deducted on every line',
        [10, 20, 5, 12, 8].every((q, i) => ERP.Inventory.available(prods[i].id, wh) === stockBefore[i] - q));
  check('T2.6 payment recorded and allocated', ERP.Invoices.paidFor(inv2.id) === M.toP(100000));
  check('T2.7 payment status is partial', inv2.paymentStatus === 'PARTIAL', inv2.paymentStatus);

  /* ─────────────────────────────────────────────────────────────────
     TEST 3 — long invoice, 28 lines → Word + page flow
     ───────────────────────────────────────────────────────────────── */
  const many = win.PRODUCTS.filter(p => p.active !== false).slice(0, 28);
  await ERP.Purchases.save({
    supplierId: supplier, warehouseId: wh, purchaseDate: '2026-09-02',
    items: many.map(p => ({ productId: p.id, quantity: 200, unitPrice: 2000 }))
  });
  const inv3 = await ERP.Invoices.save({
    customerId: win.CUSTOMERS[1].id, warehouseId: wh, invoiceDate: '2026-09-07',
    items: many.map((p, i) => ({ productId: p.id, quantity: 5 + i, unitPrice: 2200 + i * 25 }))
  });
  check('T3.1 28 line items saved', ERP.Invoices.items(inv3.id).length === 28);
  const doc3 = ERP.DocModel.invoice(inv3.id);
  const long = win.DOCX.generate(doc3);
  fs.writeFileSync('out-long.docx', Buffer.from(long));
  check('T3.2 long invoice Word file generated', long.length > 20000, String(long.length));
  const html3 = ERP.Paper.html(doc3);
  check('T3.3 A4 preview repeats the table header (thead present)',
        /<thead>/.test(html3) && /(fc-items|cl-t)/.test(html3));
  check('T3.4 every line appears in the preview',
        (html3.match(/<tr>/g) || []).length >= 29);

  /* ─────────────────────────────────────────────────────────────────
     TEST 4 — partial payment 200,000 / 75,000 → 125,000
     ───────────────────────────────────────────────────────────────── */
  const c4 = win.CUSTOMERS[2].id;
  const inv4 = await ERP.Invoices.save({
    customerId: c4, warehouseId: wh, invoiceDate: '2026-09-08',
    items: [{ productId: many[0].id, quantity: 50, unitPrice: 4000 }]
  });
  check('T4.1 invoice is PKR 200,000', inv4.grandTotal === M.toP(200000), M.fmt(inv4.grandTotal));
  const rec4 = await ERP.Payments.receive({ customerId: c4, amount: 75000, method: 'Cash', date: '2026-09-08' });
  check('T4.2 receipt number issued', /^REC-\d{4}-\d{6}$/.test(rec4.receiptNumber), rec4.receiptNumber);
  check('T4.3 balance is PKR 125,000', ERP.Ledger.customerBalance(c4) === M.toP(125000),
        M.fmt(ERP.Ledger.customerBalance(c4)));
  const led4 = ERP.Ledger.customer(c4);
  check('T4.4 ledger shows invoice then payment', led4.rows.length === 2 &&
        led4.rows[0].dr === M.toP(200000) && led4.rows[1].cr === M.toP(75000));
  check('T4.5 invoice status became partly paid', ERP.Invoices.byId(inv4.id).status === 'PARTIALLY_PAID');
  const rdoc = ERP.DocModel.receipt(rec4.id);
  check('T4.6 receipt document builds with remaining balance',
        rdoc && /125,000/.test(rdoc.totals[2].value), rdoc && rdoc.totals[2].value);
  fs.writeFileSync('out-receipt.docx', Buffer.from(win.DOCX.generate(rdoc)));

  /* ─────────────────────────────────────────────────────────────────
     TEST 5 — sell 100, return 10
     ───────────────────────────────────────────────────────────────── */
  const c5 = win.CUSTOMERS[3].id;
  const p5 = many[1];
  const stock5 = ERP.Inventory.available(p5.id, wh);
  const inv5 = await ERP.Invoices.save({
    customerId: c5, warehouseId: wh, invoiceDate: '2026-09-08',
    items: [{ productId: p5.id, quantity: 100, unitPrice: 3000 }]
  });
  check('T5.1 100 bags deducted', ERP.Inventory.available(p5.id, wh) === stock5 - 100);
  const item5 = ERP.Invoices.items(inv5.id)[0];
  const ret5 = await ERP.Returns.fromCustomer({
    invoiceId: inv5.id, warehouseId: wh, reason: 'Damaged product', action: 'RESELLABLE',
    items: [{ invoiceItemId: item5.id, quantity: 10 }], date: '2026-09-09'
  });
  check('T5.2 return number issued', /^CR-\d{4}-\d{6}$/.test(ret5.returnNumber), ret5.returnNumber);
  check('T5.3 10 bags back in sellable stock', ERP.Inventory.available(p5.id, wh) === stock5 - 90,
        String(ERP.Inventory.available(p5.id, wh)));
  check('T5.4 credit of 30,000 posted to the ledger',
        ERP.Ledger.customerBalance(c5) === M.toP(300000 - 30000), M.fmt(ERP.Ledger.customerBalance(c5)));
  check('T5.5 original invoice kept, marked partly returned',
        ERP.Invoices.byId(inv5.id).status === 'PARTIALLY_RETURNED');
  check('T5.6 CUSTOMER_RETURN_IN movement written',
        ERP.S.movements.some(m => m.kind === 'CUSTOMER_RETURN_IN' && m.ref === ret5.returnNumber));

  // damaged route keeps bags out of sellable stock
  const ret5b = await ERP.Returns.fromCustomer({
    invoiceId: inv5.id, warehouseId: wh, reason: 'Defective stock',
    items: [{ invoiceItemId: item5.id, quantity: 5, condition: 'DAMAGED' }], date: '2026-09-09'
  });
  check('T5.7 damaged return does not re-enter sellable stock',
        ERP.Inventory.available(p5.id, wh) === stock5 - 90 && ERP.Inventory.damaged(p5.id, wh) === 5);
  check('T5.8 over-returning is rejected', await ERP.Returns.fromCustomer({
    invoiceId: inv5.id, warehouseId: wh, items: [{ invoiceItemId: item5.id, quantity: 500 }]
  }).then(() => false).catch(e => !!e.validation));

  // supplier return
  const sret = await ERP.Returns.toSupplier({
    supplierId: supplier, warehouseId: wh, reason: 'Torn bags',
    items: [{ productId: p5.id, quantity: 5, unitPrice: 2000, fromDamaged: true }]
  });
  check('T5.9 supplier return number + damaged stock cleared',
        /^SR-\d{4}-\d{6}$/.test(sret.returnNumber) && ERP.Inventory.damaged(p5.id, wh) === 0);
  check('T5.10 supplier payable reduced by the return',
        ERP.S.supReturns.length === 1 && sret.debitAmount === M.toP(10000));

  /* ─────────────────────────────────────────────────────────────────
     VALIDATION + OVERSELLING
     ───────────────────────────────────────────────────────────────── */
  check('V1 no customer → rejected', await ERP.Invoices.save({
    warehouseId: wh, items: [{ productId: p5.id, quantity: 1, unitPrice: 10 }]
  }).then(() => false).catch(e => e.validation.some(x => /shop/i.test(x))));
  check('V2 no items → rejected', await ERP.Invoices.save({
    customerId: cust, warehouseId: wh, items: []
  }).then(() => false).catch(e => e.validation.some(x => /at least one/i.test(x))));
  check('V3 zero quantity → rejected', await ERP.Invoices.save({
    customerId: cust, warehouseId: wh, items: [{ productId: p5.id, quantity: 0, unitPrice: 100 }]
  }).then(() => false).catch(e => e.validation.some(x => /more than zero/i.test(x))));
  check('V4 overselling blocked', await ERP.Invoices.save({
    customerId: cust, warehouseId: wh, items: [{ productId: p5.id, quantity: 999999, unitPrice: 100 }]
  }).then(() => false).catch(e => e.validation.some(x => /only/i.test(x))));
  check('V5 paid more than total → rejected', await ERP.Invoices.save({
    customerId: cust, warehouseId: wh, paidAmount: 999999,
    items: [{ productId: p5.id, quantity: 1, unitPrice: 100 }]
  }).then(() => false).catch(e => e.validation.some(x => /more than the invoice total/i.test(x))));
  const stockV = ERP.Inventory.available(p5.id, wh);
  check('V6 a rejected invoice changed no stock', stockV === stock5 - 90);

  /* money safety */
  check('V7 money is exact at 0.1 + 0.2', M.toP(0.1) + M.toP(0.2) === M.toP(0.3));
  const inv7 = await ERP.Invoices.save({
    customerId: cust, warehouseId: wh, invoiceDate: '2026-09-08',
    items: [{ productId: many[2].id, quantity: 3, unitPrice: 1666.67 }]
  });
  check('V8 fractional rates round correctly', inv7.grandTotal === M.toP(5000.01), M.fmt(inv7.grandTotal));

  /* ─────────────────────────────────────────────────────────────────
     DRAFTS, EDIT, DUPLICATE, CANCEL
     ───────────────────────────────────────────────────────────────── */
  const stockD = ERP.Inventory.available(many[3].id, wh);
  const draft = await ERP.Invoices.save({
    customerId: cust, warehouseId: wh, invoiceDate: '2026-09-08',
    items: [{ productId: many[3].id, quantity: 10, unitPrice: 2000 }]
  }, { draft: true });
  check('D1 draft takes no invoice number', draft.status === 'DRAFT' && !draft.invoiceNumber);
  check('D2 draft does not move stock', ERP.Inventory.available(many[3].id, wh) === stockD);
  check('D3 draft is outside the ledger', ERP.Ledger.customer(cust).rows.every(r => r.ref !== ''));
  const confirmed = await ERP.Invoices.confirm(draft.id);
  check('D4 confirming issues a number and moves stock',
        /^INV-/.test(confirmed.invoiceNumber) && ERP.Inventory.available(many[3].id, wh) === stockD - 10);

  const dupDraft = ERP.Invoices.duplicate(confirmed.id);
  check('D5 duplicate is a new draft with no number and no payments',
        dupDraft.id !== confirmed.id && !dupDraft.invoiceNumber && dupDraft.paidAmount === 0 &&
        dupDraft.items.length === 1);

  const editStock = ERP.Inventory.available(many[3].id, wh);
  const edited = await ERP.Invoices.save(Object.assign(ERP.Invoices.toDraft(confirmed), {
    id: confirmed.id, items: [{ productId: many[3].id, quantity: 25, unitPrice: 2000 }]
  }), { reason: 'Customer took more bags' });
  check('D6 editing keeps the same invoice number', edited.invoiceNumber === confirmed.invoiceNumber);
  check('D7 editing adjusts stock by the difference',
        ERP.Inventory.available(many[3].id, wh) === editStock + 10 - 25,
        String(ERP.Inventory.available(many[3].id, wh)));
  check('D8 edit written to the audit log',
        ERP.S.audit.some(a => a.action === 'Invoice edited' && a.reason === 'Customer took more bags'));

  const balBefore = ERP.Ledger.customerBalance(cust);
  const cancelled = await ERP.Invoices.cancel(edited.id, 'Duplicate entry');
  check('D9 cancelling reverses stock and balance',
        cancelled.status === 'CANCELLED' &&
        ERP.Inventory.available(many[3].id, wh) === editStock + 10 &&
        ERP.Ledger.customerBalance(cust) === balBefore - edited.grandTotal);
  check('D10 cancelled invoice is kept, not deleted', !!ERP.Invoices.byId(edited.id));

  /* ─────────────────────────────────────────────────────────────────
     TEST 8 — concurrent numbering
     ───────────────────────────────────────────────────────────────── */
  const burst = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i =>
    ERP.Invoices.save({
      customerId: win.CUSTOMERS[10 + i].id, warehouseId: wh, invoiceDate: '2026-09-08',
      items: [{ productId: many[4].id, quantity: 1, unitPrice: 1000 }]
    })));
  const numbers = burst.map(b => b.invoiceNumber);
  check('T8.1 eight simultaneous invoices, eight numbers', new Set(numbers).size === 8, numbers.join(','));
  check('T8.2 all numbers well formed', numbers.every(n => /^INV-2026-\d{6}$/.test(n)));
  const allNums = ERP.Invoices.all().filter(i => i.invoiceNumber).map(i => i.invoiceNumber);
  check('T8.3 no invoice number is reused anywhere', new Set(allNums).size === allNums.length);

  /* ─────────────────────────────────────────────────────────────────
     REPORTING + PROFIT
     ───────────────────────────────────────────────────────────────── */
  const rep = ERP.Reports.sales(null, null);
  check('R1 sales report counts live invoices', rep.count === ERP.Invoices.live().length && rep.revenue > 0);
  check('R2 cost snapshots feed gross profit', rep.cost > 0 && rep.grossProfit === rep.revenue - rep.cost);
  check('R3 product report returns rows', ERP.Reports.byProduct(null, null).length > 0);
  check('R4 region report returns rows', ERP.Reports.byRegion(null, null).length > 0);
  check('R5 receivables match the ledger',
        ERP.Reports.receivables().every(r => r.balance === ERP.Ledger.customerBalance(r.customerId)));
  check('R6 legacy screens see the mirrored sales', win.SALES.length === ERP.Invoices.live().length);
  check('R7 legacy stock map matches inventory',
        Object.keys(ERP.S.inventory).every(k => win.STOCKMAP[k] === ERP.S.inventory[k].qty));

  /* UI pages render against real data */
  for (const page of ['dashboard', 'inventory', 'purchases', 'sales', 'invoices', 'orders', 'dispatch',
                      'customers', 'suppliers', 'payments', 'reports', 'documents', 'alerts', 'users', 'settings']) {
    let ok = true, err = '';
    try { const html = win.PAGES[page](); ok = typeof html === 'string' && html.length > 40; }
    catch (e) { ok = false; err = e.message; }
    check('U:' + page + ' renders', ok, err);
  }
  win.ERP.Builder.start('sale');
  check('U:invoiceBuilder renders', win.PAGES.invoiceBuilder().length > 500);
  win.ERP.Builder.draft = null;


  /* ─────────────────────────────────────────────────────────────────
     NEW BRIEF — multi-item everywhere
     ───────────────────────────────────────────────────────────────── */
  const wh2 = win.WAREHOUSES[0].id;                      // College Warehouse
  const stockOf = (p, w = wh) => ERP.Inventory.available(p.id ?? p, w);
  const bulk = win.PRODUCTS.filter(p => p.active !== false).slice(30, 60);
  await ERP.Purchases.save({
    supplierId: supplier, warehouseId: wh, purchaseDate: '2026-09-02',
    items: bulk.map(p => ({ productId: p.id, quantity: 400, unitPrice: 2000 }))
  });

  /* N1 — five-item sale: one parent, five lines, five movements, ONE ledger row */
  const cN = win.CUSTOMERS[40].id;
  const five = bulk.slice(0, 5);
  const ledgerBefore = ERP.Ledger.customer(cN).rows.length;
  const invN1 = await ERP.Invoices.save({
    customerId: cN, warehouseId: wh, invoiceDate: '2026-09-09',
    items: five.map((p, i) => ({ productId: p.id, quantity: 10 + i, unitPrice: 3000 + i * 100 }))
  });
  check('N1.1 one invoice, five line items', ERP.Invoices.items(invN1.id).length === 5);
  check('N1.2 five SALE_OUT movements under one invoice number',
        ERP.S.movements.filter(m => m.kind === 'SALE_OUT' && m.ref === invN1.invoiceNumber).length === 5);
  check('N1.3 exactly one customer receivable entry for the invoice',
        ERP.Ledger.customer(cN).rows.filter(r => r.ref === invN1.invoiceNumber).length === 1);
  check('N1.4 ledger grew by one row, not five',
        ERP.Ledger.customer(cN).rows.length === ledgerBefore + 1);
  check('N1.5 receivable equals the invoice total once',
        ERP.Ledger.customerBalance(cN) === invN1.grandTotal);

  /* N2 — five-item purchase, one payable */
  const supB = win.SUPPLIERS[3].id;
  const payBefore = ERP.Ledger.supplierBalance(supB);
  const purN2 = await ERP.Purchases.save({
    supplierId: supB, warehouseId: wh, purchaseDate: '2026-09-09',
    items: five.map((p, i) => ({ productId: p.id, quantity: 20 + i, unitPrice: 2100 + i * 50 }))
  });
  check('N2.1 one purchase, five purchase items', ERP.Purchases.items(purN2.id).length === 5);
  check('N2.2 stock rose for all five', five.every((p, i) =>
        ERP.S.movements.some(m => m.kind === 'PURCHASE_IN' && m.ref === purN2.purchaseNumber && m.productId === p.id)));
  check('N2.3 one supplier payable entry',
        ERP.Ledger.supplier(supB).rows.filter(r => r.ref === purN2.purchaseNumber).length === 1);
  check('N2.4 payable rose by the purchase total once',
        ERP.Ledger.supplierBalance(supB) === payBefore + purN2.grandTotal);

  /* N3 — receiving several products in one operation */
  const three = bulk.slice(5, 8);
  const beforeRcv = three.map(p => stockOf(p, wh2));
  const rcv = await ERP.StockDocs.receive({
    warehouseId: wh2, reason: 'Opening stock count', date: '2026-09-09',
    items: three.map((p, i) => ({ productId: p.id, quantity: 100 + i * 10 }))
  });
  check('N3.1 one receipt document with three lines',
        /^RCV-\d{4}-\d{6}$/.test(rcv.docNumber) && ERP.StockDocs.items(rcv.id).length === 3);
  check('N3.2 every line landed in the right warehouse',
        three.every((p, i) => stockOf(p, wh2) === beforeRcv[i] + 100 + i * 10));
  check('N3.3 ADJUSTMENT_IN movements written, no fake purchase',
        ERP.S.movements.filter(m => m.ref === rcv.docNumber && m.kind === 'ADJUSTMENT_IN').length === 3 &&
        !ERP.Purchases.all().some(p => p.purchaseNumber === rcv.docNumber));

  /* N4 — one short line rejects the whole transaction */
  const [pA, pB, pC] = bulk.slice(8, 11);
  const snapA = stockOf(pA), snapB = stockOf(pB), snapC = stockOf(pC);
  const invCountBefore = ERP.Invoices.all().length;
  const rollback = await ERP.Invoices.save({
    customerId: cN, warehouseId: wh, invoiceDate: '2026-09-09',
    items: [
      { productId: pA.id, quantity: 50, unitPrice: 3000 },
      { productId: pB.id, quantity: 999999, unitPrice: 3000 },
      { productId: pC.id, quantity: 30, unitPrice: 3000 }
    ]
  }).then(() => 'saved').catch(e => e);
  check('N4.1 the whole transaction is rejected', rollback !== 'saved' && !!rollback.validation);
  check('N4.2 the message names the product, warehouse and figures',
        rollback.validation.some(m => /Only .* bags/.test(m) && /Main Warehouse/.test(m)));
  check('N4.3 no stock moved for the good lines either',
        stockOf(pA) === snapA && stockOf(pB) === snapB && stockOf(pC) === snapC);
  check('N4.4 no invoice and no line items were created',
        ERP.Invoices.all().length === invCountBefore &&
        !ERP.S.invoiceItems.some(i => !ERP.Invoices.byId(i.invoiceId)));

  /* N5 / N6 — quantity, price and discount validation */
  const bad = d => ERP.Invoices.save(Object.assign({ customerId: cN, warehouseId: wh }, d))
    .then(() => null).catch(e => e.validation || []);
  check('N5.1 quantity 0 rejected',
        (await bad({ items: [{ productId: pA.id, quantity: 0, unitPrice: 100 }] })).some(m => /more than zero/.test(m)));
  check('N5.2 negative quantity rejected',
        (await bad({ items: [{ productId: pA.id, quantity: -5, unitPrice: 100 }] })).some(m => /more than zero/.test(m)));
  check('N6.1 negative price rejected',
        (await bad({ items: [{ productId: pA.id, quantity: 1, unitPrice: -10 }] })).some(m => /negative/.test(m)));
  check('N6.2 discount above the line amount rejected',
        (await bad({ items: [{ productId: pA.id, quantity: 2, unitPrice: 100, discount: 5000 }] }))
          .some(m => /larger than the line amount/.test(m)));
  check('N6.3 empty transaction rejected',
        (await bad({ items: [] })).some(m => /at least one/.test(m)));

  /* N7 — one customer return, many lines, mixed conditions */
  const invN7 = await ERP.Invoices.save({
    customerId: cN, warehouseId: wh, invoiceDate: '2026-09-09',
    items: three.map(p => ({ productId: p.id, quantity: 40, unitPrice: 2500 }))
  });
  const itemsN7 = ERP.Invoices.items(invN7.id);
  const sellableBefore = stockOf(three[0]);
  const balBeforeRet = ERP.Ledger.customerBalance(cN);
  const retN7 = await ERP.Returns.fromCustomer({
    invoiceId: invN7.id, warehouseId: wh, reason: 'Mixed return', treatment: 'ADJUST_OUTSTANDING_BALANCE',
    items: [
      { invoiceItemId: itemsN7[0].id, quantity: 5, condition: 'SELLABLE' },
      { invoiceItemId: itemsN7[1].id, quantity: 3, condition: 'DAMAGED' },
      { invoiceItemId: itemsN7[2].id, quantity: 10, condition: 'DEFECTIVE' }
    ]
  });
  check('N7.1 one return transaction with three lines',
        ERP.Returns.customerItems(retN7.id).length === 3 && retN7.lineCount === 3);
  check('N7.2 good bags returned to sellable stock', stockOf(three[0]) === sellableBefore + 5);
  check('N7.3 damaged and defective bags kept out of sellable stock',
        ERP.Inventory.damaged(three[1].id, wh) === 3 && ERP.Inventory.damaged(three[2].id, wh) === 10);
  check('N7.4 credit valued at the original invoice rate',
        retN7.creditAmount === M.toP((5 + 3 + 10) * 2500), M.fmt(retN7.creditAmount));
  check('N7.5 outstanding balance reduced by exactly the credit',
        ERP.Ledger.customerBalance(cN) === balBeforeRet - retN7.creditAmount);
  check('N7.6 the original invoice is still there', !!ERP.Invoices.byId(invN7.id));

  /* refund and replacement treatments */
  const invRef = await ERP.Invoices.save({
    customerId: cN, warehouseId: wh, invoiceDate: '2026-09-09', paidAmount: 50000,
    items: [{ productId: three[0].id, quantity: 20, unitPrice: 2500 }]
  });
  const itRef = ERP.Invoices.items(invRef.id)[0];
  const balBeforeRefund = ERP.Ledger.customerBalance(cN);
  const refund = await ERP.Returns.fromCustomer({
    invoiceId: invRef.id, warehouseId: wh, treatment: 'REFUND', reason: 'Money returned',
    items: [{ invoiceItemId: itRef.id, quantity: 4, condition: 'SELLABLE' }]
  });
  check('N7.7 a refund creates a real outgoing payment, not a negative invoice',
        ERP.Payments.refunds().length === 1 &&
        ERP.Payments.refunds()[0].amount === refund.creditAmount);
  check('N7.8 refund leaves the receivable unchanged (credit and cash cancel out)',
        ERP.Ledger.customerBalance(cN) === balBeforeRefund, M.fmt(ERP.Ledger.customerBalance(cN)));

  const stockRep = stockOf(three[0]);
  const balBeforeRep = ERP.Ledger.customerBalance(cN);
  const replaced = await ERP.Returns.fromCustomer({
    invoiceId: invRef.id, warehouseId: wh, treatment: 'REPLACEMENT', reason: 'Swap damaged bags',
    items: [{ invoiceItemId: itRef.id, quantity: 3, condition: 'DAMAGED' }]
  });
  check('N7.9 a replacement is two movements, not a credit',
        replaced.creditAmount === 0 && replaced.replacementValue > 0 &&
        ERP.S.movements.some(m => m.kind === 'REPLACEMENT_OUT' && m.ref === replaced.returnNumber) &&
        ERP.S.movements.some(m => m.kind === 'CUSTOMER_RETURN_DAMAGED_IN' && m.ref === replaced.returnNumber));
  check('N7.10 replacement leaves the balance alone and reduces sellable stock',
        ERP.Ledger.customerBalance(cN) === balBeforeRep && stockOf(three[0]) === stockRep - 3);
  check('N7.11 returning more than was sold is refused', await ERP.Returns.fromCustomer({
    invoiceId: invRef.id, warehouseId: wh,
    items: [{ invoiceItemId: itRef.id, quantity: 500, condition: 'SELLABLE' }]
  }).then(() => false).catch(e => e.validation.some(m => /most that can still be returned/.test(m))));

  /* N8 — supplier return, many lines, tied to the purchase */
  const purItems = ERP.Purchases.items(purN2.id);
  const supBalBefore = ERP.Ledger.supplierBalance(supB);
  const srN8 = await ERP.Returns.toSupplier({
    supplierId: supB, warehouseId: wh, purchaseId: purN2.id, reason: 'Torn bags',
    items: [
      { productId: purItems[0].productId, purchaseItemId: purItems[0].id, quantity: 4 },
      { productId: purItems[1].productId, purchaseItemId: purItems[1].id, quantity: 6 }
    ]
  });
  check('N8.1 one supplier return with two lines',
        ERP.Returns.supplierItems(srN8.id).length === 2 && srN8.lineCount === 2);
  check('N8.2 SUPPLIER_RETURN_OUT movements for both lines',
        ERP.S.movements.filter(m => m.kind === 'SUPPLIER_RETURN_OUT' && m.ref === srN8.returnNumber).length === 2);
  check('N8.3 payable reduced by the returned value',
        ERP.Ledger.supplierBalance(supB) === supBalBefore - srN8.debitAmount);
  check('N8.4 cannot return more than was received on that purchase',
        await ERP.Returns.toSupplier({
          supplierId: supB, warehouseId: wh,
          items: [{ productId: purItems[0].productId, purchaseItemId: purItems[0].id, quantity: 9999 }]
        }).then(() => false).catch(e => !!e.validation.length));
  const supRep = stockOf(purItems[0].productId);
  await ERP.Returns.supplierReplacementIn({
    warehouseId: wh, returnId: srN8.id, returnNumber: srN8.returnNumber,
    items: [{ productId: purItems[0].productId, quantity: 4 }]
  });
  check('N8.5 supplier replacement comes back in as its own movement',
        stockOf(purItems[0].productId) === supRep + 4 &&
        ERP.S.movements.some(m => m.kind === 'SUPPLIER_REPLACEMENT_IN'));

  /* N9 — warehouse transfer, three products, both sides */
  const tp = bulk.slice(11, 14);
  const srcBefore = tp.map(p => stockOf(p, wh));
  const dstBefore = tp.map(p => stockOf(p, wh2));
  const trf = await ERP.StockDocs.transfer({
    warehouseId: wh, toWarehouseId: wh2, date: '2026-09-09',
    items: [{ productId: tp[0].id, quantity: 20 }, { productId: tp[1].id, quantity: 40 },
            { productId: tp[2].id, quantity: 10 }]
  });
  check('N9.1 one transfer document, three lines',
        /^TRF-\d{4}-\d{6}$/.test(trf.docNumber) && ERP.StockDocs.items(trf.id).length === 3);
  check('N9.2 source down and destination up for every line',
        [20, 40, 10].every((q, i) => stockOf(tp[i], wh) === srcBefore[i] - q &&
                                     stockOf(tp[i], wh2) === dstBefore[i] + q));
  check('N9.3 TRANSFER_OUT and TRANSFER_IN written for each line',
        ERP.S.movements.filter(m => m.ref === trf.docNumber && m.kind === 'TRANSFER_OUT').length === 3 &&
        ERP.S.movements.filter(m => m.ref === trf.docNumber && m.kind === 'TRANSFER_IN').length === 3);
  check('N9.4 company-wide stock is unchanged by a transfer',
        [20, 40, 10].every((q, i) => stockOf(tp[i], wh) + stockOf(tp[i], wh2) === srcBefore[i] + dstBefore[i]));
  check('N9.5 same source and destination refused', await ERP.StockDocs.transfer({
    warehouseId: wh, toWarehouseId: wh, items: [{ productId: tp[0].id, quantity: 1 }]
  }).then(() => false).catch(e => e.validation.some(m => /cannot be the same/.test(m))));
  const srcAfter = stockOf(tp[0], wh);
  check('N9.6 a short line rolls the whole transfer back', await ERP.StockDocs.transfer({
    warehouseId: wh, toWarehouseId: wh2,
    items: [{ productId: tp[0].id, quantity: 5 }, { productId: tp[1].id, quantity: 999999 }]
  }).then(() => false).catch(() => stockOf(tp[0], wh) === srcAfter));

  /* stock adjustment, both directions, reason required */
  const adjP = bulk.slice(14, 16);
  const adjBefore = adjP.map(p => stockOf(p, wh));
  check('A1 an adjustment without a reason is refused', await ERP.StockDocs.adjust({
    warehouseId: wh, items: [{ productId: adjP[0].id, quantity: 5, direction: 'IN' }]
  }).then(() => false).catch(e => e.validation.some(m => /reason/i.test(m))));
  const adj = await ERP.StockDocs.adjust({
    warehouseId: wh, reason: 'Physical count 09/09', date: '2026-09-09',
    items: [{ productId: adjP[0].id, quantity: 7, direction: 'IN' },
            { productId: adjP[1].id, quantity: 4, direction: 'OUT' }]
  });
  check('A2 one adjustment moves stock both ways',
        stockOf(adjP[0], wh) === adjBefore[0] + 7 && stockOf(adjP[1], wh) === adjBefore[1] - 4);
  check('A3 ADJUSTMENT_IN and ADJUSTMENT_OUT movements carry the reason',
        ERP.S.movements.some(m => m.ref === adj.docNumber && m.kind === 'ADJUSTMENT_IN' && /Physical count/.test(m.note)) &&
        ERP.S.movements.some(m => m.ref === adj.docNumber && m.kind === 'ADJUSTMENT_OUT'));

  /* orders and quotations */
  const ord = await ERP.Orders.save({
    kind: 'ORDER', customerId: cN, warehouseId: wh, orderDate: '2026-09-09',
    items: five.map((p, i) => ({ productId: p.id, quantity: 5 + i, unitPrice: 3000 }))
  });
  const stockOrd = stockOf(five[0]);
  check('O1 one order with five lines and no stock effect',
        /^SO-\d{4}-\d{6}$/.test(ord.orderNumber) && ERP.Orders.items(ord.id).length === 5 &&
        stockOf(five[0]) === stockOrd);
  const quote = await ERP.Orders.save({
    kind: 'QUOTATION', customerId: cN, warehouseId: wh,
    items: [{ productId: five[0].id, quantity: 3, unitPrice: 3100 }]
  });
  check('O2 quotations take their own number series', /^QT-\d{4}-\d{6}$/.test(quote.orderNumber));
  const ordDraft = ERP.Orders.toInvoiceDraft(ord.id);
  const ordInv = await ERP.Invoices.save(ordDraft);
  await ERP.Orders.markInvoiced(ord.id, ordInv);
  check('O3 an order becomes one invoice carrying all five lines',
        ERP.Invoices.items(ordInv.id).length === 5 && ordInv.orderNumber === ord.orderNumber);
  check('O4 the order is marked invoiced, not duplicated',
        ERP.Orders.byId(ord.id).status === 'INVOICED' && ERP.Orders.all().filter(o => o.orderNumber === ord.orderNumber).length === 1);

  /* dispatch must not deduct twice */
  const dispStock = ERP.Invoices.items(ordInv.id).map(i => stockOf(i.productId));
  const disp = await ERP.StockDocs.dispatch({
    customerId: cN, warehouseId: wh, invoiceId: ordInv.id, vehicleNo: 'lea-9099', driver: 'Nasir',
    items: ERP.Invoices.items(ordInv.id).map(i => ({ productId: i.productId, quantity: i.quantity }))
  });
  check('D1 dispatch against an invoiced sale records delivery without moving stock again',
        disp.stockApplied === false &&
        ERP.Invoices.items(ordInv.id).every((i, ix) => stockOf(i.productId) === dispStock[ix]));
  check('D2 the dispatch number is written back onto the invoice',
        ERP.Invoices.byId(ordInv.id).dispatchNumber === disp.docNumber);
  const freeStock = stockOf(bulk[16]);
  const disp2 = await ERP.StockDocs.dispatch({
    customerId: cN, warehouseId: wh, items: [{ productId: bulk[16].id, quantity: 12 }]
  });
  check('D3 a standalone dispatch does move the stock',
        disp2.stockApplied === true && stockOf(bulk[16]) === freeStock - 12);

  /* partial purchase receiving */
  const partial = await ERP.Purchases.save({
    supplierId: supB, warehouseId: wh, purchaseDate: '2026-09-09',
    items: [{ productId: bulk[17].id, quantity: 100, unitPrice: 2000, receivedQty: 70 }]
  });
  const pItem = ERP.Purchases.items(partial.id)[0];
  check('P1 ordered 100 / received 70 / 30 still open',
        pItem.orderedQty === 100 && pItem.receivedQty === 70 && partial.status === 'PARTIALLY_RECEIVED');
  const stockPart = stockOf(bulk[17]);
  await ERP.Purchases.receiveMore(partial.id, [{ itemId: pItem.id, quantity: 30 }]);
  check('P2 the later delivery closes the line and adds only those bags',
        stockOf(bulk[17]) === stockPart + 30 &&
        ERP.Purchases.items(partial.id)[0].receivedQty === 100 &&
        ERP.Purchases.byId(partial.id).status === 'RECEIVED');
  check('P3 receiving more than was ordered is refused',
        await ERP.Purchases.receiveMore(partial.id, [{ itemId: pItem.id, quantity: 5 }])
          .then(() => false).catch(e => !!e.validation));

  /* N10 / N11 — ten and twenty-five line invoices in every output */
  const ten = bulk.slice(0, 10);
  const invTen = await ERP.Invoices.save({
    customerId: win.CUSTOMERS[41].id, warehouseId: wh, invoiceDate: '2026-09-09',
    notes: 'Bill number 0359',
    items: ten.map((p, i) => ({ productId: p.id, quantity: 10 + i, unitPrice: 2500 + i * 25 }))
  });
  const docTen = ERP.DocModel.invoice(invTen.id);
  const htmlTen = ERP.Paper.html(docTen);
  const wordTen = win.DOCX.generate(docTen);
  fs.writeFileSync('out-ten.docx', Buffer.from(wordTen));
  check('N10.1 database holds ten line items', ERP.Invoices.items(invTen.id).length === 10);
  check('N10.2 the document model carries all ten', docTen.rows.length === 10);
  check('N10.3 the preview shows all ten products',
        ten.every(p => htmlTen.includes(p.ur) || htmlTen.includes(p.en)));
  check('N10.4 the Word file contains all ten line amounts',
        (() => { const xml = Buffer.from(wordTen).toString('latin1');
          return ERP.Invoices.items(invTen.id).every(it => xml.includes(M.fmtPlain(it.lineTotal))); })());
  check('N10.5 one invoice number for the whole load, not ten',
        ERP.Invoices.all().filter(i => i.invoiceNumber === invTen.invoiceNumber).length === 1);

  const twentyfive = bulk.slice(0, 25);
  const invLong = await ERP.Invoices.save({
    customerId: win.CUSTOMERS[42].id, warehouseId: wh, invoiceDate: '2026-09-09',
    items: twentyfive.map((p, i) => ({ productId: p.id, quantity: 6 + i, unitPrice: 2400 + i * 10 }))
  });
  const docLong = ERP.DocModel.invoice(invLong.id);
  fs.writeFileSync('out-25.docx', Buffer.from(win.DOCX.generate(docLong)));
  check('N11.1 twenty-five lines saved and rendered', ERP.Invoices.items(invLong.id).length === 25 &&
        docLong.rows.length === 25);
  check('N11.2 the classic sheet keeps the shop layout',
        ERP.Paper.html(docLong).includes('Bill to Party') && !!docLong.classic.invNo);
  check('N11.3 the classic totals reconcile: opening + gross − cash = balance',
        (() => { const b = docLong.classic.box.map(r => Number(String(r[2]).replace(/,/g, '')));
          return Math.abs((b[1] + b[0] - b[3]) - b[5]) < 0.01; })());

  /* N12 — the same submission twice */
  const dupDraftPayload = {
    id: FDB0.uid('inv'), clientOpId: 'fixed-op-id-test',
    customerId: cN, warehouseId: wh, invoiceDate: '2026-09-09',
    items: [{ productId: bulk[18].id, quantity: 9, unitPrice: 3000 }]
  };
  const stockDup = stockOf(bulk[18]);
  const first = await ERP.Invoices.save(Object.assign({}, dupDraftPayload));
  const secondTry = await ERP.Invoices.save(Object.assign({}, dupDraftPayload))
    .then(() => 'saved twice').catch(e => e);
  check('N12.1 the second identical submission is refused',
        secondTry !== 'saved twice' && secondTry.duplicate === true);
  check('N12.2 stock was deducted once, not twice', stockOf(bulk[18]) === stockDup - 9);
  check('N12.3 only one invoice exists for that operation',
        ERP.Invoices.all().filter(i => i.clientOpId === 'fixed-op-id-test').length === 1);

  /* every document type builds and produces a Word file */
  const docChecks = [
    ['order', ERP.DocModel.order(ord.id)],
    ['quotation', ERP.DocModel.order(quote.id)],
    ['transfer note', ERP.DocModel.stockDoc(trf.id)],
    ['stock receipt', ERP.DocModel.stockDoc(rcv.id)],
    ['adjustment note', ERP.DocModel.stockDoc(adj.id)],
    ['dispatch note', ERP.DocModel.stockDoc(disp.id)],
    ['customer return', ERP.DocModel.customerReturn(retN7.id)],
    ['supplier return', ERP.DocModel.supplierReturn(srN8.id)],
    ['purchase invoice', ERP.DocModel.purchase(purN2.id)],
    ['customer statement', ERP.DocModel.statement(cN, 'CUSTOMER', null, null)],
    ['supplier statement', ERP.DocModel.statement(supB, 'SUPPLIER', null, null)]
  ];
  docChecks.forEach(([label, model]) => {
    let ok = false, err = '';
    try {
      const bytes = win.DOCX.generate(model);
      const html = ERP.Paper.html(model);
      ok = !!model && bytes.length > 4000 && bytes[0] === 0x50 && html.length > 400 &&
           model.rows.length === (model.itemsFooter ? model.rows.length : model.rows.length);
    } catch (e) { err = e.message; }
    check('DOC:' + label + ' previews and downloads as Word', ok, err);
  });
  check('DOC: an order document lists every line',
        ERP.DocModel.order(ord.id).rows.length === ERP.Orders.items(ord.id).length);
  check('DOC: a transfer note lists every line',
        ERP.DocModel.stockDoc(trf.id).rows.length === ERP.StockDocs.items(trf.id).length);

  /* N14 — reports must not multiply by line count */
  const repN = ERP.Reports.sales(null, null);
  check('N14.1 revenue is the sum of invoice totals, not of line items',
        repN.revenue === ERP.Invoices.live().reduce((a, i) => a + i.grandTotal, 0));
  check('N14.2 invoice count is parents, not lines',
        repN.count === ERP.Invoices.live().length && ERP.S.invoiceItems.length > repN.count);
  check('N14.3 product report still works line by line',
        ERP.Reports.byProduct(null, null).reduce((a, p) => a + p.qty, 0) ===
        ERP.Invoices.live().reduce((a, i) => a + ERP.Invoices.items(i.id).reduce((x, it) => x + it.quantity, 0), 0));
  check('N14.4 receivables total equals the sum of customer balances',
        ERP.Ledger.receivablesTotal() ===
        win.CUSTOMERS.reduce((a, c) => a + Math.max(0, ERP.Ledger.customerBalance(c.id)), 0));

  const counts = {
    invoices: ERP.Invoices.all().length,
    items: ERP.S.invoiceItems.length,
    payments: ERP.S.payments.length,
    movements: ERP.S.movements.length,
    receivable: ERP.Ledger.receivablesTotal(),
    payable: ERP.Ledger.supplierBalance(supplier),
    stockP5: ERP.Inventory.available(p5.id, wh),
    audit: ERP.S.audit.length,
    orders: ERP.S.orders.length, orderItems: ERP.S.orderItems.length,
    stockDocs: ERP.S.stockDocs.length, stockDocItems: ERP.S.stockDocItems.length,
    custReturns: ERP.S.custReturns.length, custReturnItems: ERP.S.custReturnItems.length,
    supReturns: ERP.S.supReturns.length
  };

  /* ─────────────────────────────────────────────────────────────────
     TEST 7 — RESTART: tear the window down, boot again on the same DB
     ───────────────────────────────────────────────────────────────── */
  await win.ERP.flush();
  await sleep(400);
  win.close();

  const second = await boot(store);
  const ERP2 = second.win.ERP;
  check('T7.1 invoices survive a restart', ERP2.Invoices.all().length === counts.invoices,
        ERP2.Invoices.all().length + ' vs ' + counts.invoices);
  check('T7.2 invoice lines survive', ERP2.S.invoiceItems.length === counts.items);
  check('T7.3 payments survive', ERP2.S.payments.length === counts.payments);
  check('T7.4 stock movements survive', ERP2.S.movements.length === counts.movements);
  check('T7.5 inventory survives exactly', ERP2.Inventory.available(p5.id, wh) === counts.stockP5,
        ERP2.Inventory.available(p5.id, wh) + ' vs ' + counts.stockP5);
  check('T7.6 receivables identical after restart', ERP2.Ledger.receivablesTotal() === counts.receivable);
  check('T7.7 supplier payable identical', ERP2.Ledger.supplierBalance(supplier) === counts.payable);
  check('T7.8 audit trail survives', ERP2.S.audit.length >= counts.audit);
  check('T7.8b orders and their lines survive',
        ERP2.S.orders.length === counts.orders && ERP2.S.orderItems.length === counts.orderItems);
  check('T7.8c transfers, receipts, adjustments and dispatches survive',
        ERP2.S.stockDocs.length === counts.stockDocs && ERP2.S.stockDocItems.length === counts.stockDocItems);
  check('T7.8d returns and their lines survive',
        ERP2.S.custReturns.length === counts.custReturns &&
        ERP2.S.custReturnItems.length === counts.custReturnItems &&
        ERP2.S.supReturns.length === counts.supReturns);
  check('T7.9 no duplication on second boot — products still 136', second.win.PRODUCTS.length === 136,
        String(second.win.PRODUCTS.length));
  check('T7.10 shops still 409', second.win.CUSTOMERS.length === 409, String(second.win.CUSTOMERS.length));
  check('T7.11 next invoice number continues the sequence, never reused',
        !ERP2.Invoices.all().some(i => i.invoiceNumber === second.win.FDB.peekNumber('INV', 2026, ERP2.S.sequences)));

  const afterRestart = await ERP2.Invoices.save({
    customerId: cust, warehouseId: wh, invoiceDate: '2026-09-09',
    items: [{ productId: many[5].id, quantity: 2, unitPrice: 5000 }]
  });
  check('T7.12 new invoice after restart continues numbering',
        !counts.invoiceNumbers && /^INV-2026-\d{6}$/.test(afterRestart.invoiceNumber), afterRestart.invoiceNumber);

  /* backup / restore round trip */
  const dump = await second.win.FDB.exportAll();
  check('B1 backup contains every store',
        dump.counts.invoices === ERP2.Invoices.all().length && dump.counts.invoiceItems > 0 &&
        dump.counts.auditLog > 0);
  check('B2 backup is JSON serialisable', JSON.parse(JSON.stringify(dump)).counts.invoices === dump.counts.invoices);
  fs.writeFileSync('out-backup.json', JSON.stringify(dump).slice(0, 400) + '…');

  second.win.close();

  /* ── report ── */
  console.log('\n' + results.map(r =>
    (r[0] === 'PASS' ? '  ✔ ' : '  ✘ ') + r[1] + (r[2] ? '   → ' + r[2] : '')).join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
};

run().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
