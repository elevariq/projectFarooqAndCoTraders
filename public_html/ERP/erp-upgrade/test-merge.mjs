/* Proves the merge: a device that was running the earlier in-house build —
   or the earlier normalised build — opens this one and keeps its records,
   including multi-line invoices. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

const HTML = fs.readFileSync('dist/farooq-co-erp.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
const check = (n, c, d) => { if (c) { pass++; out.push('  ✔ ' + n); } else { fail++; out.push('  ✘ ' + n + (d ? '   → ' + d : '')); } };

/* a snapshot in exactly the shape the in-house build wrote */
function theirSnapshot() {
  return {
    v: 1, schema: 2, savedAt: '2026-09-09T12:00:00.000Z',
    masterDataVersion: '2026-09-09-v1',
    stock: { 'PRD-0002|wh-main': 300, 'PRD-0004|wh-main': 120 },
    dmg: { 'PRD-0002|wh-main': 7 },
    moves: [],
    sales: [{
      id: 'SALE-0001', cust: 'CUS-0001', wid: 'wh-main', date: '05 Sep 2026', iso: '2026-09-05',
      items: [
        { pid: 'PRD-0002', ur: 'چاول تاج محل سیلہ', en: 'Taj Mahal Sella', brand: 'Taj', bag: 'Bag',
          qty: 100, rate: 3000, disc: 0, total: 300000, cost: 2500 },
        { pid: 'PRD-0004', ur: 'آٹا سورج 50 kg', en: 'Sooraj 50 kg', brand: 'Sooraj', bag: '50 KG',
          qty: 50, rate: 7450, disc: 5000, total: 367500, cost: 7000 },
        { pid: 'PRD-0006', ur: 'آٹا میاں حیدر فاین 40 kg', en: 'Mian Haider Fine 40 kg', brand: 'Mian',
          bag: '40 KG', qty: 20, rate: 5356, disc: 0, total: 107120, cost: 5000 }
      ],
      pid: 'PRD-0002', qty: 170, subtotal: 779620, itemDisc: 5000, invoiceDiscount: 0,
      freight: 4000, loading: 0, other: 0, tax: 0,
      amt: 778620, grand: 778620, paid: 200000, method: 'Cash', pay: 'Partial',
      status: 'Partially Paid', draft: false, cancelled: false
    }],
    purchases: [{
      id: 'PO-0001', sup: 'SUP-0001', wid: 'wh-main', date: '01 Sep 2026', iso: '2026-09-01',
      items: [
        { pid: 'PRD-0002', qty: 400, rate: 2500, disc: 0, total: 1000000 },
        { pid: 'PRD-0004', qty: 170, rate: 7000, disc: 0, total: 1190000 }
      ],
      pid: 'PRD-0002', qty: 570, amt: 2190000, pay: 'Unpaid', ref: 'MILL-1'
    }],
    customers: [], products: [], suppliers: [], warehouses: [], regions: [],
    orders: [], dispatch: [], custpay: [], suppay: [], payalloc: [], activity: [],
    docs: [], docseq: {}, audit: [], credits: [], supret: [],
    transfers: [{ id: 'TRF-0001', from: 'wh-main', to: 'wh-college', qty: 30, iso: '2026-09-06' }],
    adjustments: [{ id: 'ADJ-0001', wid: 'wh-main', qty: 4, reason: 'count', iso: '2026-09-07' }],
    seq: {}, biz: {}, users: [], rules: [], log: [], wa: {}, sms: {}, negstock: false
  };
}

function boot(opts) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://farooq.local/erp',
    beforeParse(w) {
      w.indexedDB = opts.idb; w.IDBKeyRange = FDBKeyRange;
      w.print = () => {}; w.confirm = () => true; w.scrollTo = () => {};
      w.URL.createObjectURL = () => 'b'; w.URL.revokeObjectURL = () => {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      if (opts.ls) Object.keys(opts.ls).forEach(k => w.localStorage.setItem(k, opts.ls[k]));
    }
  });
  return { dom, win: dom.window, errors };
}
async function ready(win) {
  for (let i = 0; i < 600 && !(win.ERP && win.ERP.fullyReady); i++) await sleep(25);
  return win.ERP;
}

/* write a snapshot into a database shaped like the in-house build's */
function seedTheirDatabase(idb, snapshot) {
  return new Promise((res, rej) => {
    const rq = idb.open('farooqco_erp', 1);
    rq.onupgradeneeded = e => {
      const db = e.target.result;
      db.createObjectStore('state');
      db.createObjectStore('sequences');
      db.createObjectStore('backups', { keyPath: 'id' });
    };
    rq.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(snapshot, 'current');
      tx.oncomplete = () => { db.close(); res(true); };
      tx.onerror = () => rej(tx.error);
    };
    rq.onerror = () => rej(rq.error);
  });
}

const run = async () => {
  /* ── A. their localStorage record, opened by this build ── */
  {
    const idb = new FDBFactory();
    const { win } = boot({ idb, ls: { farooqco_erp_v1: JSON.stringify(theirSnapshot()) } });
    const ERP = await ready(win);
    check('A1 this build opens on the other build\'s record', !!ERP && ERP.Invoices.all().length === 1);
    const inv = ERP.Invoices.all()[0];
    const items = ERP.Invoices.items(inv.id);
    check('A2 the three-line sale keeps all three lines', items.length === 3, String(items.length));
    check('A3 line quantities and rates are preserved',
          items[0].quantity === 100 && items[0].unitPrice === win.Money.toP(3000) &&
          items[1].discount === win.Money.toP(5000));
    check('A4 the invoice total matches what the other build stored',
          inv.grandTotal === win.Money.toP(778620), win.Money.fmt(inv.grandTotal));
    check('A5 it is given a proper invoice number', /^INV-\d{4}-\d{6}$/.test(inv.invoiceNumber));
    check('A6 the cost recorded at sale time comes across for profit',
          items[0].costSnapshot === win.Money.toP(2500));
    const pur = ERP.Purchases.all()[0];
    check('A7 the two-line purchase keeps both lines',
          !!pur && ERP.Purchases.items(pur.id).length === 2);
    check('A8 stock on hand is carried over exactly',
          ERP.Inventory.available('PRD-0002', 'wh-main') === 300 &&
          ERP.Inventory.available('PRD-0004', 'wh-main') === 120);
    check('A9 damaged stock stays out of sellable stock',
          ERP.Inventory.damaged('PRD-0002', 'wh-main') === 7);
    check('A10 the payment already taken is kept and allocated',
          ERP.Invoices.paidFor(inv.id) === win.Money.toP(200000));
    check('A11 the customer balance is invoice minus payment',
          ERP.Ledger.customerBalance('CUS-0001') === win.Money.toP(778620 - 200000),
          win.Money.fmt(ERP.Ledger.customerBalance('CUS-0001')));
    check('A12 the supplier payable comes across',
          ERP.Ledger.supplierBalance('SUP-0001') === win.Money.toP(2190000));
    check('A13 transfers and adjustments are kept as documents',
          ERP.StockDocs.byType('TRANSFER').length === 1 && ERP.StockDocs.byType('ADJUST').length === 1);
    check('A14 the invoice prints with all three lines',
          ERP.DocModel.invoice(inv.id).rows.length === 3);
    check('A15 the other build\'s own database is untouched',
          !(await new Promise(r => { const q = win.indexedDB.databases ? win.indexedDB.databases() : Promise.resolve([]);
            q.then(l => r((l || []).some(d => d.name === 'farooqco_erp'))).catch(() => r(false)); })));
    win.close();
  }

  /* ── B. their IndexedDB snapshot, newer than localStorage ── */
  {
    const idb = new FDBFactory();
    const newer = theirSnapshot();
    newer.savedAt = '2026-09-09T18:00:00.000Z';
    newer.sales[0].items.push({ pid: 'PRD-0006', en: 'Extra line', qty: 5, rate: 1000, disc: 0, total: 5000 });
    await seedTheirDatabase(idb, newer);
    const stale = theirSnapshot();
    stale.savedAt = '2026-09-01T00:00:00.000Z';
    const { win } = boot({ idb, ls: { farooqco_erp_v1: JSON.stringify(stale) } });
    const ERP = await ready(win);
    const inv = ERP.Invoices.all()[0];
    check('B1 the newer database snapshot wins over a stale browser record',
          !!inv && ERP.Invoices.items(inv.id).length === 4,
          inv ? String(ERP.Invoices.items(inv.id).length) : 'no invoice');
    check('B2 the old database is left in place, not deleted or rewritten', await new Promise(res => {
      const rq = idb.open('farooqco_erp');
      rq.onsuccess = e => {
        const db = e.target.result;
        const ok = Array.prototype.slice.call(db.objectStoreNames).indexOf('state') > -1;
        const t = db.transaction('state', 'readonly').objectStore('state').get('current');
        t.onsuccess = () => { const kept = !!t.result && t.result.savedAt === newer.savedAt; db.close(); res(ok && kept); };
        t.onerror = () => { db.close(); res(false); };
      };
      rq.onerror = () => res(false);
    }));
    win.close();
  }

  /* ── C. a device already on the earlier normalised build ── */
  {
    const idb = new FDBFactory();
    const first = boot({ idb: new FDBFactory() });   /* build a real record first */
    const ERP1 = await ready(first.win);
    const wh = first.win.WAREHOUSES[1].id;
    const prods = first.win.PRODUCTS.filter(p => p.active !== false).slice(0, 3);
    await ERP1.Purchases.save({
      supplierId: first.win.SUPPLIERS[0].id, warehouseId: wh,
      items: prods.map(p => ({ productId: p.id, quantity: 100, unitPrice: 2000 }))
    });
    const madeInv = await ERP1.Invoices.save({
      customerId: first.win.CUSTOMERS[0].id, warehouseId: wh,
      items: prods.map((p, i) => ({ productId: p.id, quantity: 5 + i, unitPrice: 3000 }))
    });
    const dump = await first.win.FDB.exportAll();
    first.win.close();

    /* replay those records into a database with the old name */
    await new Promise((res, rej) => {
      const names = Object.keys(dump.data);
      const rq = idb.open('farooqco_erp', 1);
      rq.onupgradeneeded = e => {
        const db = e.target.result;
        names.forEach(n => {
          const keyPath = n === 'meta' || n === 'sequences' || n === 'legacy' ? 'k'
            : n === 'documents' ? 'no' : n === 'syncQueue' || n === 'operations' ? 'opId' : 'id';
          if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath });
        });
      };
      rq.onsuccess = e => {
        const db = e.target.result;
        const tx = db.transaction(names, 'readwrite');
        names.forEach(n => (dump.data[n] || []).forEach(r => tx.objectStore(n).put(r)));
        tx.oncomplete = () => { db.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      rq.onerror = () => rej(rq.error);
    });

    const { win } = boot({ idb });
    const ERP = await ready(win);
    check('C1 records from the earlier build are adopted whole',
          ERP.Invoices.all().length === dump.counts.invoices &&
          ERP.S.invoiceItems.length === dump.counts.invoiceItems,
          `${ERP.Invoices.all().length}/${dump.counts.invoices}`);
    check('C2 the adopted invoice keeps its number and its lines',
          !!ERP.Invoices.byNumber(madeInv.invoiceNumber) &&
          ERP.Invoices.items(ERP.Invoices.byNumber(madeInv.invoiceNumber).id).length === 3);
    check('C3 stock and balances survive the move',
          ERP.Inventory.available(prods[0].id, wh) === 95 &&
          ERP.Ledger.customerBalance(win.CUSTOMERS[0].id) === madeInv.grandTotal);
    check('C4 numbering continues rather than restarting',
          win.FDB.peekNumber('INV', new Date().getFullYear(), ERP.S.sequences) !== madeInv.invoiceNumber);
    win.close();
  }

  console.log('\n' + out.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
};
run().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
