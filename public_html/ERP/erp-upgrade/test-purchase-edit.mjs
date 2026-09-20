/* Edit a purchase (2026-09-20).
   Business need: a purchase entered with a wrong bag count, rate, charge or
   supplier has to be correctable, the way a sales invoice already is. A
   purchase is three things at once — the bags that came into stock, the
   supplier's bill, and any money paid with it — so an edit has to re-state all
   three together and never leave them disagreeing.

   Purchases.save already had an "edit" branch that no screen could reach. It
   was wrong in ways nobody had seen: it paid the supplier again on every edit,
   gave every line a new id (orphaning supplier returns and landed costs), lost
   who/when it was created, and could push stock below zero. This test proves
   each of those is closed.

   Covers: the service (toDraft round trip, quantity/rate/charge/line changes,
   payments, stable line ids, supplier returns, landed costs, the stock guard,
   supplier change, double submit, persistence across a restart) and the
   screens (Edit on the list and in the viewer, the edit form, the locked
   supplier, the role gate). */
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
  const w = boot(store);
  await ready(w);
  const ERP = w.ERP, D = w.document, M = w.Money;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const typeIn = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); } };

  const wh = w.WAREHOUSES[0], wh2 = w.WAREHOUSES[1];
  const sup = w.SUPPLIERS[0], sup2 = w.SUPPLIERS[1];
  const P = w.PRODUCTS;                       // each scenario uses its own products so stock never overlaps
  const stock = (p, wid) => ERP.Inventory.available(p.id, wid || wh.id);
  const owed = s => ERP.Ledger.supplierBalance(s.id);
  const rejected = async p => { try { await p; return null; } catch (e) { return e; } };
  const msgs = e => (e && e.validation || []).join(' | ');
  const edit = (id, fn) => {
    const pu = ERP.Purchases.byId(id), d = ERP.Purchases.toDraft(pu);
    d.id = pu.id; fn(d, pu); return ERP.Purchases.save(d);
  };
  const snap = () => JSON.stringify({
    inv: Object.keys(ERP.S.inventory).sort().map(k => [k, ERP.S.inventory[k].qty]),
    mv: ERP.S.movements.length, pay: ERP.S.payments.length, alloc: ERP.S.allocations.length,
    pur: ERP.S.purchases.map(p => [p.id, p.revision, p.grandTotal]), items: ERP.S.purchaseItems.length,
    aud: ERP.S.audit.length
  });

  check('S0 the data has two suppliers, two warehouses and products', !!(sup && sup2 && wh && wh2 && P.length > 40));
  check('S1 the API exists', ['toDraft', 'editErrors', 'paidFor', 'supplierLockReason', 'canEdit', 'returnedQty']
    .every(k => typeof ERP.Purchases[k] === 'function'));

  /* ══════════════════════════════════════════════════════════════════════
     A. A CLEAN ROUND TRIP — open, change nothing, save: nothing moves
     ══════════════════════════════════════════════════════════════════════ */
  const pA = P[10], pB = P[11];
  const a0 = await ERP.Purchases.save({
    supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-01', supplierInvoiceNo: 'MILL-1', vehicleNo: 'lea-11',
    driver: 'Aslam', deliveryRef: 'D-9', notes: 'first load', description: 'Wheat flour, two grades',
    freight: 1500, loading: 500, invoiceDiscount: 700, paidAmount: 20000, paymentMethod: 'Bank Transfer',
    items: [{ productId: pA.id, quantity: 100, unitPrice: 2000, discount: 300 },
            { productId: pB.id, quantity: 50, unitPrice: 3000 }] });
  const a0Items = ERP.Purchases.items(a0.id).map(i => i.id);
  const a0Stock = [stock(pA), stock(pB)], a0Owed = owed(sup);
  const a0Doc = ERP.Purchases.byId(a0.id);

  const dA = ERP.Purchases.toDraft(a0Doc);
  check('A1 toDraft gives back what was entered — charges, overall discount, paid, method',
    dA.freight === 1500 && dA.loading === 500 && dA.invoiceDiscount === 700 && dA.paidAmount === 20000 &&
    dA.paymentMethod === 'Bank Transfer' && dA.supplierInvoiceNo === 'MILL-1' && dA.vehicleNo === 'LEA-11' &&
    dA.description === 'Wheat flour, two grades', JSON.stringify(dA));
  check('A2 …and the lines: quantity, rate, line discount, all blank "received" (the whole load came)',
    dA.items.length === 2 && dA.items[0].quantity === 100 && dA.items[0].unitPrice === 2000 &&
    dA.items[0].discount === 300 && dA.items[0].receivedQty === '' && dA.items[1].quantity === 50);
  check('A3 each line carries the id of the saved line', dA.items.map(i => i.purchaseItemId).join() === a0Items.join());

  const nPay = ERP.S.payments.length, nAlloc = ERP.S.allocations.length;
  const a1 = await edit(a0.id, () => {});
  const a1Doc = ERP.Purchases.byId(a0.id);
  check('A4 saving it unchanged keeps the number, totals and status',
    a1Doc.purchaseNumber === a0.purchaseNumber && a1Doc.grandTotal === a0.grandTotal && a1Doc.paidAmount === a0.paidAmount &&
    a1Doc.status === 'RECEIVED' && a1Doc.paymentStatus === a0.paymentStatus);
  check('A5 stock and the supplier\'s balance are exactly as before',
    stock(pA) === a0Stock[0] && stock(pB) === a0Stock[1] && owed(sup) === a0Owed);
  check('A6 no second payment was written — the supplier was not paid twice',
    ERP.S.payments.length === nPay && ERP.S.allocations.length === nAlloc && ERP.Purchases.paidFor(a0.id) === M.toP(20000));
  check('A7 every line kept its id', ERP.Purchases.items(a0.id).map(i => i.id).join() === a0Items.join());
  check('A8 who made it, when, and its description survived; the revision moved on',
    a1Doc.createdAt === a0.createdAt && a1Doc.createdBy === a0.createdBy &&
    a1Doc.description === 'Wheat flour, two grades' && a1Doc.revision === a0.revision + 1);
  check('A9 the audit log says "Purchase edited", with the figures before and after',
    ERP.S.audit.some(x => x.action === 'Purchase edited' && x.ref === a0.purchaseNumber &&
      x.oldValues && x.oldValues.grandTotal === a0.grandTotal && x.newValues.grandTotal === a1Doc.grandTotal));
  check('A10 the old edit route\'s reversal + re-receipt is on the stock ledger, netting to zero',
    ERP.S.movements.filter(m => m.ref === a0.purchaseNumber && m.kind === 'PURCHASE_REVERSAL_OUT').length === 2 &&
    ERP.S.movements.filter(m => m.ref === a0.purchaseNumber && m.kind === 'PURCHASE_IN').length === 4);

  /* ══════════════════════════════════════════════════════════════════════
     B. CHANGING WHAT WAS ENTERED — bags, rate, charges, dates, notes
     ══════════════════════════════════════════════════════════════════════ */
  const grand0 = a1Doc.grandTotal;
  await edit(a0.id, d => {
    d.items[0].quantity = 120; d.items[0].unitPrice = 2100;      // more bags, dearer
    d.freight = 2500; d.purchaseDate = '2026-09-02'; d.notes = 'corrected'; d.vehicleNo = 'lea-22';
  });
  const b1 = ERP.Purchases.byId(a0.id);
  /* gross 402,000 − line discount 300 − overall discount 700 + freight 2,500 + loading 500 = 404,000 */
  check('B1 the total is recomputed from the new figures',
    b1.subtotal === 402000 * 100 && b1.freightAmount === 250000 && b1.discountAmount === 100000 &&
    b1.grandTotal === 404000 * 100 && b1.grandTotal !== grand0, JSON.stringify([b1.subtotal, b1.grandTotal]));
  check('B2 the 20 extra bags are in stock; the other line is unchanged',
    stock(pA) === a0Stock[0] + 20 && stock(pB) === a0Stock[1]);
  check('B3 the supplier\'s account moved by exactly the change in the bill',
    owed(sup) === a0Owed + (b1.grandTotal - grand0), owed(sup) + ' vs ' + (a0Owed + (b1.grandTotal - grand0)));
  check('B4 date, notes and vehicle changed; the payment already made is unchanged',
    b1.purchaseDate === '2026-09-02' && b1.notes === 'corrected' && b1.vehicleNo === 'LEA-22' &&
    ERP.Purchases.paidFor(a0.id) === M.toP(20000));
  check('B5 the supplier ledger row for this purchase carries the new date and amount',
    ERP.Ledger.supplier(sup.id).rows.some(r => r.kind === 'PURCHASE' && r.id === a0.id && r.cr === b1.grandTotal && r.iso === '2026-09-02'));
  check('B6 the average cost of the product follows the new rate',
    ERP.Inventory.row(pA.id, wh.id).avgCostP > 0 && ERP.Purchases.items(a0.id)[0].unitPrice === M.toP(2100));

  /* ══════════════════════════════════════════════════════════════════════
     C. MONEY — only ever added by an edit
     ══════════════════════════════════════════════════════════════════════ */
  const c1 = await rejected(edit(a0.id, d => { d.paidAmount = 5000; }));
  check('C1 lowering what was paid is refused, and says which voucher to reverse',
    c1 && /already been paid/.test(msgs(c1)) && /reverse/i.test(msgs(c1)) &&
    new RegExp(ERP.Purchases.paymentsFor(a0.id)[0].receiptNumber).test(msgs(c1)), msgs(c1));
  const c2 = await rejected(edit(a0.id, d => { d.paidAmount = 99999999; }));
  check('C2 paying more than the bill is refused', c2 && /more than the purchase total/.test(msgs(c2)), msgs(c2));

  const payCount = ERP.S.payments.length;
  await edit(a0.id, d => { d.paidAmount = 35000; d.paymentMethod = 'Cash'; });
  const cPays = ERP.Purchases.paymentsFor(a0.id);
  check('C3 raising it to 35,000 adds ONE voucher for the 15,000 difference',
    ERP.S.payments.length === payCount + 1 && cPays.length === 2 &&
    ERP.Purchases.paidFor(a0.id) === M.toP(35000) &&
    cPays.some(p => p.amount === M.toP(15000) && p.method === 'Cash') && cPays.some(p => p.amount === M.toP(20000)),
    cPays.map(p => p.amount).join());
  check('C4 the bill now shows 35,000 paid and the status follows',
    ERP.Purchases.byId(a0.id).paidAmount === M.toP(35000) &&
    ERP.Purchases.byId(a0.id).paymentStatus === 'PARTIAL');
  const ownedC = owed(sup);
  await edit(a0.id, () => {});
  check('C5 saving again writes no further voucher and moves no balance',
    ERP.S.payments.length === payCount + 1 && owed(sup) === ownedC);
  const c6 = await edit(a0.id, d => { d.paidAmount = ERP.Purchases.byId(a0.id).grandTotal / 100; });
  check('C6 paying it off in full makes it PAID',
    ERP.Purchases.byId(a0.id).paymentStatus === 'PAID' && ERP.Purchases.paidFor(a0.id) === ERP.Purchases.byId(a0.id).grandTotal);
  /* a payment reversed elsewhere must not leave a stale "paid" figure behind */
  const pays7 = ERP.Purchases.paymentsFor(a0.id), lastPay = pays7[pays7.length - 1];   // the voucher C6 added
  if (lastPay) await ERP.Payments.reverse(lastPay.id, 'test');
  const dAfterRev = ERP.Purchases.toDraft(ERP.Purchases.byId(a0.id));
  check('C7 after a voucher is reversed, the edit form shows what is REALLY paid (from the vouchers, not the header)',
    dAfterRev.paidAmount === ERP.Purchases.paidFor(a0.id) / 100 && ERP.Purchases.paidFor(a0.id) === M.toP(35000));
  await edit(a0.id, () => {});
  check('C8 …and saving heals the header to match', ERP.Purchases.byId(a0.id).paidAmount === M.toP(35000));

  /* ══════════════════════════════════════════════════════════════════════
     D. ADDING AND REMOVING LINES
     ══════════════════════════════════════════════════════════════════════ */
  const pC = P[12];
  const dOld = ERP.Purchases.items(a0.id);
  await edit(a0.id, d => {
    d.items.splice(1, 1);                                        // drop pB
    d.items.push({ productId: pC.id, quantity: 10, unitPrice: 4000, receivedQty: '' });
  });
  const dNew = ERP.Purchases.items(a0.id);
  check('D1 a dropped line is gone and its bags left the warehouse; the new line\'s bags arrived',
    dNew.length === 2 && !dNew.some(i => i.productId === pB.id) && stock(pB) === a0Stock[1] - 50 && stock(pC) >= 10);
  check('D2 the kept line kept its id; the new line got a new one',
    dNew[0].id === dOld[0].id && dNew[1].id !== dOld[1].id && dNew[1].productId === pC.id);
  check('D3 the old line record is really deleted', !ERP.S.purchaseItems.some(i => i.id === dOld[1].id));
  check('D4 line count and quantity on the header follow', ERP.Purchases.byId(a0.id).lineCount === 2 &&
    ERP.Purchases.byId(a0.id).totalQty === 130);

  /* the average cost of a product must stop counting a purchase that no longer contains it */
  const pD = P[13];
  const dPur1 = await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-03',
    items: [{ productId: pD.id, quantity: 100, unitPrice: 1000 }] });
  const dPur2 = await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-04',
    items: [{ productId: pD.id, quantity: 100, unitPrice: 3000 }] });
  const avgBoth = ERP.Inventory.row(pD.id, wh.id).avgCostP;
  await edit(dPur2.id, d => { d.items = [{ productId: pC.id, quantity: 5, unitPrice: 4000 }]; });   // pD leaves purchase 2
  const avgNow = ERP.Inventory.row(pD.id, wh.id).avgCostP;
  check('D5 the average cost of a product taken off a purchase drops back to what is left',
    avgBoth > 1000 && avgNow === M.toP(1000), avgBoth + ' → ' + avgNow);

  /* ══════════════════════════════════════════════════════════════════════
     E. PART DELIVERIES
     ══════════════════════════════════════════════════════════════════════ */
  const pE = P[14];
  const e0 = await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-05',
    items: [{ productId: pE.id, quantity: 100, unitPrice: 1000, receivedQty: 60 }] });
  const eStock0 = stock(pE);
  const eDraft = ERP.Purchases.toDraft(ERP.Purchases.byId(e0.id));
  check('E1 a part delivery opens with the received figure spelled out (60 of 100)',
    eDraft.items[0].quantity === 100 && eDraft.items[0].receivedQty === 60);
  await edit(e0.id, d => { d.items[0].unitPrice = 1200; });
  check('E2 editing only the rate keeps it a part delivery — still 60 bags in, 40 open',
    stock(pE) === eStock0 && ERP.Purchases.byId(e0.id).status === 'PARTIALLY_RECEIVED' &&
    ERP.Purchases.items(e0.id)[0].receivedQty === 60);
  await ERP.Purchases.receiveMore(e0.id, [{ itemId: ERP.Purchases.items(e0.id)[0].id, quantity: 40 }]);
  const eDone = ERP.Purchases.toDraft(ERP.Purchases.byId(e0.id));
  check('E3 after the rest arrives the form shows it as fully received (blank)', eDone.items[0].receivedQty === '' &&
    ERP.Purchases.byId(e0.id).status === 'RECEIVED');
  await edit(e0.id, d => { d.items[0].quantity = 110; });
  check('E4 correcting the ordered quantity on a fully received load brings the extra bags in',
    stock(pE) === eStock0 + 50 && ERP.Purchases.byId(e0.id).receivedQty === 110);

  /* ══════════════════════════════════════════════════════════════════════
     F. THE STOCK GUARD — bags that were sold cannot be un-received
     ══════════════════════════════════════════════════════════════════════ */
  const pF = P[15], cust = w.CUSTOMERS[0];
  const f0 = await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-06',
    items: [{ productId: pF.id, quantity: 100, unitPrice: 1000 }] });
  const fBase = stock(pF) - 100;                                  // whatever was there before
  await ERP.Settings.save({ allowNegativeStock: false });
  await ERP.Invoices.save({ customerId: cust.id, warehouseId: wh.id, invoiceDate: '2026-09-07', paidAmount: 0,
    items: [{ productId: pF.id, quantity: stock(pF) - 20, unitPrice: 1500, warehouseId: wh.id }] });      // leaves exactly 20
  check('F0 (setup) 20 bags of it are left on the shelf', stock(pF) === 20);
  const sF = snap();
  const f1 = await rejected(edit(f0.id, d => { d.items[0].quantity = 30; }));
  check('F1 cutting the load to 30 is refused — 70 fewer bags than before, only 20 are on the shelf',
    f1 && /Only 20 bags/.test(msgs(f1)) && /already been sold/.test(msgs(f1)), msgs(f1));
  check('F2 …and nothing at all was written', snap() === sF);
  await edit(f0.id, d => { d.items[0].quantity = 85; });
  check('F3 cutting it by 15 (fits in the 20 left) is allowed', stock(pF) === 5);
  await edit(f0.id, d => { d.notes = 'only the note'; d.items[0].unitPrice = 1100; });
  check('F4 changing only the note and rate works while the bags are mostly sold — an untouched quantity never fails',
    stock(pF) === 5 && ERP.Purchases.byId(f0.id).notes === 'only the note');
  await ERP.Settings.save({ allowNegativeStock: true });
  await edit(f0.id, d => { d.items[0].quantity = 10; });
  check('F5 with "allow negative stock" on the same cut goes through', stock(pF) === 5 - 75);
  await ERP.Settings.save({ allowNegativeStock: false });

  /* ══════════════════════════════════════════════════════════════════════
     G. SUPPLIER RETURNS — the line they hang on cannot go away
     ══════════════════════════════════════════════════════════════════════ */
  const pG = P[16], pG2 = P[17];
  const g0 = await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-08',
    items: [{ productId: pG.id, quantity: 100, unitPrice: 1000 }, { productId: pG2.id, quantity: 20, unitPrice: 500 }] });
  const gItem = ERP.Purchases.items(g0.id)[0];
  const sr = await ERP.Returns.toSupplier({ supplierId: sup.id, warehouseId: wh.id, purchaseId: g0.id,
    items: [{ productId: pG.id, quantity: 10, purchaseItemId: gItem.id }] });
  check('G0 (setup) 10 bags went back to the supplier against that line',
    ERP.Purchases.returnedQty(gItem.id) === 10 && ERP.Returns.supplierReturnableQty(gItem.id) === 90);
  await edit(g0.id, d => { d.items[0].quantity = 150; d.items[0].unitPrice = 1100; });
  const gAfter = ERP.Purchases.items(g0.id)[0];
  check('G1 raising the quantity on a returned line works, and the line is the same record',
    gAfter.id === gItem.id && gAfter.quantity === 150);
  check('G2 the 10 returned bags are still recorded against it — 140 may still be returned',
    gAfter.returnedQty === 10 && ERP.Returns.supplierReturnableQty(gItem.id) === 140);
  const sG = snap();
  const g3 = await rejected(edit(g0.id, d => { d.items[0].quantity = 8; }));
  check('G3 showing fewer bags received than were returned is refused',
    g3 && /already returned/.test(msgs(g3)) && /10/.test(msgs(g3)), msgs(g3));
  const g4 = await rejected(edit(g0.id, d => { d.items.splice(0, 1); }));
  check('G4 removing that line is refused, saying why', g4 && /cannot be removed/.test(msgs(g4)) && /returned/.test(msgs(g4)), msgs(g4));
  const g5 = await rejected(edit(g0.id, d => { d.items[0].productId = P[18].id; }));
  check('G5 turning it into a different product is refused', g5 && /cannot be changed/.test(msgs(g5)), msgs(g5));
  const g6 = await rejected(edit(g0.id, d => { d.supplierId = sup2.id; }));
  check('G6 moving the purchase to another supplier is refused — the return belongs to this one',
    g6 && /return to the supplier/.test(msgs(g6)) && new RegExp(sr.returnNumber).test(msgs(g6)), msgs(g6));
  check('G7 none of the refusals wrote anything', snap() === sG);
  await edit(g0.id, d => { d.items.splice(1, 1); });
  check('G8 a line WITHOUT returns can still be removed from the same purchase',
    ERP.Purchases.items(g0.id).length === 1 && ERP.Purchases.items(g0.id)[0].id === gItem.id);

  /* ══════════════════════════════════════════════════════════════════════
     H. LANDED COSTS — the share stays with its line
     ══════════════════════════════════════════════════════════════════════ */
  const pH = P[19], pH2 = P[20];
  const h0 = await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-09',
    items: [{ productId: pH.id, quantity: 100, unitPrice: 1000 }, { productId: pH2.id, quantity: 100, unitPrice: 1000 }] });
  const hItems = ERP.Purchases.items(h0.id);
  const lc = await ERP.Landed.create({ purchaseId: h0.id, date: '2026-09-09',
    expenses: [{ category: 'Transportation', amount: 4000 }] });
  const extra0 = ERP.Landed.extraForItem(hItems[0].id);
  check('H0 (setup) a transport cost was spread over both lines', extra0 > 0 && ERP.Landed.extraForItem(hItems[1].id) > 0);
  await edit(h0.id, d => { d.items[0].quantity = 200; });
  const hAfter = ERP.Purchases.items(h0.id);
  check('H1 the landed-cost share is still attached to its line after the edit (same line, same share)',
    hAfter[0].id === hItems[0].id && ERP.Landed.extraForItem(hAfter[0].id) === extra0 &&
    hAfter[0].operationalShare === extra0, hAfter[0].operationalShare + ' vs ' + extra0);
  check('H2 the line\'s landed unit cost is re-worked for the new quantity (share ÷ 200, not ÷ 100)',
    hAfter[0].landedUnitCost === hAfter[0].goodsUnitCost + Math.round(extra0 / 200) + Math.round((hAfter[0].chargeShare || 0) / 200),
    hAfter[0].landedUnitCost + ' / ' + hAfter[0].goodsUnitCost);
  const h3 = await rejected(edit(h0.id, d => { d.items.splice(1, 1); }));
  check('H3 removing a line that carries landed costs is refused — cancel that entry first',
    h3 && /landed costs/.test(msgs(h3)) && /Cancel the landed-cost entry/.test(msgs(h3)), msgs(h3));
  await ERP.Landed.cancel(lc.id, 'test');
  await edit(h0.id, d => { d.items.splice(1, 1); });
  check('H4 once that entry is cancelled the line can go', ERP.Purchases.items(h0.id).length === 1);

  /* ══════════════════════════════════════════════════════════════════════
     I. CHANGING THE SUPPLIER — only while nothing is attached to it
     ══════════════════════════════════════════════════════════════════════ */
  const pI = P[21];
  const i0 = await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-10',
    items: [{ productId: pI.id, quantity: 10, unitPrice: 1000 }] });
  const iOwed1 = owed(sup), iOwed2 = owed(sup2), iGrand = ERP.Purchases.byId(i0.id).grandTotal;
  check('I0 (setup) nothing is attached to it', ERP.Purchases.supplierLockReason(i0.id) === '');
  await edit(i0.id, d => { d.supplierId = sup2.id; });
  check('I1 with nothing attached the supplier can be changed; the bill moves from one account to the other',
    ERP.Purchases.byId(i0.id).supplierId === sup2.id && ERP.Purchases.byId(i0.id).supplierNameSnapshot === sup2.co &&
    owed(sup) === iOwed1 - iGrand && owed(sup2) === iOwed2 + iGrand, [owed(sup), iOwed1 - iGrand, owed(sup2), iOwed2 + iGrand].join());
  await edit(i0.id, d => { d.paidAmount = 1000; });
  check('I2 once money is paid against it the supplier is locked', /paid against this purchase/.test(ERP.Purchases.supplierLockReason(i0.id)));
  const i3 = await rejected(edit(i0.id, d => { d.supplierId = sup.id; }));
  check('I3 changing it then is refused', i3 && /supplier cannot be changed/.test(msgs(i3)), msgs(i3));

  /* ══════════════════════════════════════════════════════════════════════
     J. DOUBLE SUBMISSION, VALIDATION, WAREHOUSE MOVE
     ══════════════════════════════════════════════════════════════════════ */
  const pJ = P[22];
  const j0 = await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-11',
    items: [{ productId: pJ.id, quantity: 10, unitPrice: 1000 }] });
  const jPu = ERP.Purchases.byId(j0.id), jd = ERP.Purchases.toDraft(jPu); jd.id = jPu.id; jd.items[0].quantity = 12;
  await ERP.Purchases.save(jd);
  const sJ = snap();
  const j1 = await rejected(ERP.Purchases.save(jd));                  // the very same form submitted again
  check('J1 a second click on Save with the same form is ignored, not applied twice',
    j1 && j1.duplicate === true && snap() === sJ);
  const j2 = await rejected(edit(j0.id, d => { d.items[0].quantity = 0; }));
  check('J2 ordinary validation still applies to an edit (quantity must be above zero)', j2 && /quantity must be more than zero/.test(msgs(j2)));
  const j3 = await rejected(edit(j0.id, d => { d.supplierId = ''; }));
  check('J3 …and a supplier is still required', j3 && /Choose a supplier/.test(msgs(j3)));
  const stockJ1 = stock(pJ), stockJ2 = stock(pJ, wh2.id);
  await edit(j0.id, d => { d.warehouseId = wh2.id; d.items.forEach(i => { i.warehouseId = wh2.id; }); });
  check('J4 moving the purchase to another warehouse takes the bags out of one and into the other',
    stock(pJ) === stockJ1 - 12 && stock(pJ, wh2.id) === stockJ2 + 12);

  /* ══════════════════════════════════════════════════════════════════════
     K. PERSISTENCE — everything survives a restart
     ══════════════════════════════════════════════════════════════════════ */
  const expect = {
    a: ERP.Purchases.byId(a0.id), items: ERP.Purchases.items(a0.id).map(i => i.id + ':' + i.quantity),
    paid: ERP.Purchases.paidFor(a0.id), stockA: stock(pA), stockC: stock(pC), owed: owed(sup), owed2: owed(sup2),
    g: ERP.Purchases.items(g0.id)[0].id, ret: ERP.Purchases.returnedQty(gItem.id)
  };
  await ERP.flush(); await sleep(300);
  w.close();
  const w2 = boot(store); await ready(w2);
  const E2 = w2.ERP;
  const pu2 = E2.Purchases.byId(a0.id);
  check('K1 the edited purchase is what it was after the restart (totals, revision, creator, description)',
    pu2.grandTotal === expect.a.grandTotal && pu2.revision === expect.a.revision && pu2.createdAt === expect.a.createdAt &&
    pu2.description === 'Wheat flour, two grades' && pu2.purchaseDate === '2026-09-02');
  check('K2 its lines, payments, stock and both suppliers\' balances are identical',
    E2.Purchases.items(a0.id).map(i => i.id + ':' + i.quantity).join() === expect.items.join() &&
    E2.Purchases.paidFor(a0.id) === expect.paid && E2.Inventory.available(pA.id, wh.id) === expect.stockA &&
    E2.Inventory.available(pC.id, wh.id) === expect.stockC && E2.Ledger.supplierBalance(sup.id) === expect.owed &&
    E2.Ledger.supplierBalance(sup2.id) === expect.owed2);
  check('K3 the supplier return is still tied to the same line', E2.Purchases.items(g0.id)[0].id === expect.g &&
    E2.Purchases.returnedQty(gItem.id) === expect.ret);
  w2.close();

  /* ══════════════════════════════════════════════════════════════════════
     UI — a fresh page
     ══════════════════════════════════════════════════════════════════════ */
  const w3 = boot(store); await ready(w3);
  const E3 = w3.ERP, D3 = w3.document;
  const $3 = q => D3.querySelector(q), $$3 = q => [...D3.querySelectorAll(q)];
  const click3 = el => el && el.dispatchEvent(new w3.Event('click', { bubbles: true }));
  const type3 = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w3.Event('input', { bubbles: true })); } };
  const change3 = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w3.Event('change', { bubbles: true })); } };
  const supW3 = w3.SUPPLIERS[0];
  const pU1 = E3.Purchases.byId(a0.id), pU2 = E3.Purchases.byId(i0.id);
  const editBtn = id => $3('[data-fcpur="edit"][data-id="' + id + '"]');

  w3.go('purchases'); await sleep(250);
  check('U1 every purchase row on the Purchases screen has an Edit button',
    !!editBtn(pU1.id) && !!editBtn(pU2.id) && $$3('[data-fcpur="edit"]').length === E3.S.purchases.length,
    $$3('[data-fcpur="edit"]').length + ' of ' + E3.S.purchases.length);
  check('U2 the button sits in a column now called Actions, next to the Invoice button',
    /Actions/.test($3('table thead').textContent) && !!editBtn(pU1.id).parentElement.querySelector('[data-doc]'));

  click3(editBtn(pU1.id)); await sleep(300);
  check('U3 Edit opens the same entry screen the purchase was made on, marked "Editing PUR-…"',
    !!$3('#fcbuilder') && new RegExp('Editing ' + pU1.purchaseNumber).test($3('#fcbHead').closest('.card').textContent) &&
    E3.Builder.mode === 'purchase' && E3.Builder.editingId === pU1.id);
  check('U4 it is filled in — supplier, warehouse, date, invoice no, both lines and their bags',
    $3('[data-fcb="supplierId"]').value === pU1.supplierId && $3('[data-fcb="warehouseId"]').value === pU1.warehouseId &&
    $3('[data-fcb="purchaseDate"]').value === pU1.purchaseDate && $3('[data-fcb="supplierInvoiceNo"]').value === 'MILL-1' &&
    $$3('[data-fcline="qty"]').length === 2 && $$3('[data-fcline="qty"]')[0].value === '120',
    $$3('[data-fcline="qty"]').map(i => i.value).join());
  check('U5 Amount Paid shows what has been paid so far, with a hint on how to change it',
    $3('[data-fcb="paidAmount"]').value === String(ERP.Purchases ? E3.Purchases.paidFor(pU1.id) / 100 : '') &&
    /reverse the voucher/i.test($3('.fc-amtpaid').textContent));
  check('U6 the supplier picker is locked (money was paid against this purchase) and says why',
    $3('[data-fcb="supplierId"]').disabled && /paid against this purchase/.test($3('#fcbHead').textContent));

  const qty0 = $$3('[data-fcline="qty"]')[0], stockBefore = E3.Inventory.available(pA.id, wh.id);
  type3(qty0, '125'); await sleep(50);
  check('U7 typing a new quantity updates the totals on screen', $3('#fcbSum').textContent.indexOf(w3.Money.fmt(
    E3.Calc.invoice(E3.Builder.draft).grandTotal)) > -1);
  click3($3('[data-fcbact="save"]')); await sleep(600);
  check('U8 Save applies it: 5 more bags in stock, the purchase updated, back on the list with the document open',
    E3.Purchases.items(pU1.id)[0].quantity === 125 && E3.Inventory.available(pA.id, wh.id) === stockBefore + 5 &&
    E3.Purchases.byId(pU1.id).revision === pU1.revision + 1 && !!$3('#fcviewer.on') && /PURCHASE INVOICE/.test($3('#fcviewer').textContent),
    String(E3.Inventory.available(pA.id, wh.id) - stockBefore));

  check('U9 the purchase document has an Edit button of its own', !!$3('#fcviewer [data-fcv="edit"]'));
  click3($3('#fcviewer [data-fcv="edit"]')); await sleep(300);
  check('U10 …and it opens the same edit screen',
    !$3('#fcviewer.on') && E3.Builder.editingId === pU1.id && !!$3('#fcbuilder'));
  click3($3('[data-fcbact="cancel"]')); await sleep(100);

  /* a form with a problem shows it and writes nothing */
  w3.go('purchases'); await sleep(200);
  click3(editBtn(pU2.id)); await sleep(300);
  const sUi = JSON.stringify([E3.S.movements.length, E3.S.payments.length, E3.Purchases.byId(pU2.id).revision]);
  type3($$3('[data-fcline="qty"]')[0], '0');
  click3($3('[data-fcbact="save"]')); await sleep(400);
  check('U11 an invalid edit shows the problem on the form and saves nothing',
    /cannot be saved yet/.test($3('#fcbErr').textContent) && /quantity must be more than zero/.test($3('#fcbErr').textContent) &&
    JSON.stringify([E3.S.movements.length, E3.S.payments.length, E3.Purchases.byId(pU2.id).revision]) === sUi);
  click3($3('[data-fcbact="cancel"]')); await sleep(100);

  /* an unpaid purchase with nothing attached has an open supplier picker */
  const pU3 = E3.Purchases.byId(j0.id);
  w3.go('purchases'); await sleep(200);
  click3(editBtn(pU3.id)); await sleep(300);
  check('U12 with nothing attached the supplier picker is open',
    !$3('[data-fcb="supplierId"]').disabled && $3('[data-fcb="supplierId"]').options.length > 2);
  click3($3('[data-fcbact="cancel"]')); await sleep(100);

  /* a brand-new purchase is unaffected: no lock, no hint, "Next: PUR-…" */
  click3($3('[data-fcbact="newpurchase"]') || $3('[data-panel="purchase"]')); await sleep(300);
  if (!$3('#fcbuilder')) { E3.Builder.start('purchase'); await sleep(300); }
  check('U13 a new purchase looks as before — no "Editing", supplier open, no edit hint',
    /Next:/.test($3('#fcbHead').closest('.card').textContent) && !$3('[data-fcb="supplierId"]').disabled &&
    !/reverse the voucher/i.test($3('.fc-amtpaid').textContent));
  click3($3('[data-fcbact="cancel"]')); await sleep(100);

  /* roles: whoever cannot enter or correct a purchase does not get Edit */
  await E3.Settings.save({ currentRole: 'INVENTORY' }); w3.go('purchases'); await sleep(250);
  check('U14 the Warehouse role sees no Edit button on the list or in the document',
    $$3('[data-fcpur="edit"]').length === 0 && (() => { E3.Viewer.open(E3.DocModel.purchase(pU1.id));
      const has = !!$3('#fcviewer [data-fcv="edit"]'); E3.Viewer.close(); return !has; })());
  await E3.Settings.save({ currentRole: 'ACCOUNTANT' }); w3.go('purchases'); await sleep(250);
  check('U15 an Accountant (can correct transactions) does', $$3('[data-fcpur="edit"]').length === E3.S.purchases.length);
  await E3.Settings.save({ currentRole: 'OWNER' });
  w3.go('purchases'); await sleep(150);
  check('U16 the Invoice button and the New-purchase button still work as before',
    $$3('[data-doc]').length >= E3.S.purchases.length && !!$3('[data-fcbact="newpurchase"]'));
  w3.close();

  out.push(`\n${pass} passed, ${fail} failed`);
  console.log(out.join('\n'));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
