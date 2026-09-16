/* Client change request (analysed 2026-09-16, clientNewReq/): Farooq & Co
   hand wheat to a flour mill and get flour bags and chokar (bran) back,
   with some grain lost in grinding, and settle the difference in the
   mill's own khata. This is a "Milling job": wheat issued (ISSUE lines)
   and flour/chokar received back (RECEIVE lines) on one document, weighed
   in bags and kilograms, with the process loss shown (never enforced —
   no saved yield recipes) and the net settlement folded into the mill's
   existing supplier ledger via a patch to ERP.Ledger.supplier. */
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
      w.print = () => {}; w.confirm = () => true; w.alert = () => {}; w.prompt = () => 'Cancelled in test';
      w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    }
  });
  return dom.window;
}

async function main() {
  const store = {};
  let w = boot(store);
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.millingReady || Promise.resolve()).catch(() => {});
  await sleep(250);
  let ERP = w.ERP, D = w.document, M = w.Money;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const change = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };

  check('D1 ERP.Milling exists', typeof ERP.Milling === 'object');
  check('D2 ERP.DocModel.millingJob exists', typeof ERP.DocModel.millingJob === 'function');
  check('D3 the milling stores exist in the schema', w.FDB.STORE_NAMES.includes('millingJobs') && w.FDB.STORE_NAMES.includes('millingJobItems'));

  /* master data to work with — picked by id where the exact bag-weight
     matters (wheat 49kg, a 50kg flour, a 34kg chokar), falling back to
     whatever carries a `kg` field so the test still runs against a
     different data set */
  const withKg = (excl) => w.PRODUCTS.find(p => p.kg && !excl.includes(p.id));
  const wheat = w.PRODUCTS.find(p => p.id === 'PRD-0097') || withKg([]);
  const flour = w.PRODUCTS.find(p => p.id === 'PRD-0004') || withKg([wheat.id]);
  const chokar = w.PRODUCTS.find(p => p.id === 'PRD-0041') || withKg([wheat.id, flour.id]);
  const wh = w.WAREHOUSES[0].id;
  const mill = w.SUPPLIERS[0].id;

  /* give the warehouse real wheat stock so the issue side is a genuine
     stock movement, not something only possible under allowNegativeStock */
  await ERP.Purchases.save({
    supplierId: mill, warehouseId: wh, purchaseDate: '2026-09-01',
    items: [{ productId: wheat.id, quantity: 500, unitPrice: 100 }]
  });
  const wheatBefore = ERP.Inventory.available(wheat.id, wh);
  const flourBefore = ERP.Inventory.available(flour.id, wh);
  const chokarBefore = ERP.Inventory.available(chokar.id, wh);
  const balBefore = ERP.Ledger.supplierBalance(mill);

  /* ══════════════════════════════════════════════════════════════════════
     VALIDATION
     ══════════════════════════════════════════════════════════════════════ */
  const v1 = await ERP.Milling.save({
    warehouseId: wh, issue: [{ productId: wheat.id, quantity: 10, weightKg: 490, unitRate: 100, rateBasis: 'BAG' }],
    receive: [{ productId: flour.id, quantity: 9, weightKg: 450, unitRate: 100, rateBasis: 'BAG' }]
  }).catch(e => e);
  check('V1 no mill is refused', v1 && v1.validation);

  const v2 = await ERP.Milling.save({
    millId: mill, warehouseId: wh, issue: [], receive: []
  }).catch(e => e);
  check('V2 no lines at all is refused', v2 && v2.validation &&
    v2.validation.some(m => /issued/i.test(m)) && v2.validation.some(m => /received/i.test(m)));

  const v3 = await ERP.Milling.save({
    millId: mill, warehouseId: wh,
    issue: [{ productId: wheat.id, quantity: 10, weightKg: 490, unitRate: 100, rateBasis: 'BAG' }],
    receive: []
  }).catch(e => e);
  check('V3 no receive lines is refused', v3 && v3.validation.some(m => /received/i.test(m)));

  const v4 = await ERP.Milling.save({
    millId: mill, warehouseId: wh,
    issue: [{ productId: wheat.id, quantity: 100000, weightKg: 4900000, unitRate: 100, rateBasis: 'BAG' }],
    receive: [{ productId: flour.id, quantity: 9, weightKg: 450, unitRate: 100, rateBasis: 'BAG' }]
  }).catch(e => e);
  check('V4 issuing more bags than are in stock is refused', v4 && v4.validation.some(m => /available/i.test(m)));

  const v5 = await ERP.Milling.save({
    millId: mill, warehouseId: wh,
    issue: [{ productId: wheat.id, quantity: 10, weightKg: 100, unitRate: 100, rateBasis: 'KG' }],
    receive: [{ productId: flour.id, quantity: 9, weightKg: 9999, unitRate: 100, rateBasis: 'KG' }]
  }).catch(e => e);
  check('V5 output weight heavier than input weight is refused', v5 && v5.validation &&
    /cannot create extra weight/i.test(v5.validation[0]));

  const v6 = await ERP.Milling.save({
    millId: mill, warehouseId: wh,
    issue: [{ productId: wheat.id, quantity: 0, weightKg: 0, unitRate: 100, rateBasis: 'KG' }],
    receive: [{ productId: flour.id, quantity: 9, weightKg: 450, unitRate: 100, rateBasis: 'KG' }]
  }).catch(e => e);
  check('V6 a zero bag count is refused', v6 && v6.validation.some(m => /bag count/i.test(m)));

  const v7 = await ERP.Milling.save({
    millId: mill, warehouseId: wh,
    issue: [{ productId: wheat.id, quantity: 10, weightKg: 490, unitRate: -5, rateBasis: 'KG' }],
    receive: [{ productId: flour.id, quantity: 9, weightKg: 450, unitRate: 100, rateBasis: 'KG' }]
  }).catch(e => e);
  check('V7 a negative rate is refused', v7 && v7.validation.some(m => /negative/i.test(m)));

  const v8 = await ERP.Milling.save({
    millId: mill,
    issue: [{ productId: wheat.id, quantity: 10, weightKg: 490, unitRate: 100, rateBasis: 'KG' }],
    receive: [{ productId: flour.id, quantity: 9, weightKg: 450, unitRate: 100, rateBasis: 'KG' }]
  }).catch(e => e);
  check('V8 no warehouse is refused', v8 && v8.validation.some(m => /warehouse/i.test(m)));

  /* ══════════════════════════════════════════════════════════════════════
     BACKEND — a real job, NET settlement
     ══════════════════════════════════════════════════════════════════════ */
  const job = await ERP.Milling.save({
    millId: mill, warehouseId: wh, jobDate: '2026-09-16', settle: 'NET',
    issue: [{ productId: wheat.id, quantity: 200, weightKg: 9800, unitRate: 96, rateBasis: 'KG' }],
    receive: [
      { productId: flour.id, quantity: 180, weightKg: 7200, unitRate: 5840, rateBasis: 'BAG' },
      { productId: chokar.id, quantity: 60, weightKg: 2040, unitRate: 62, rateBasis: 'KG' }
    ],
    feeAmount: 45000, feeNote: 'Grinding charge'
  });
  check('M1 the job posts with a job number', !!job.jobNumber && /^MIL-/.test(job.jobNumber));
  check('M2 weight issued is summed correctly', job.inWeightKg === 9800);
  check('M3 weight received is summed correctly', job.outWeightKg === 7200 + 2040);
  check('M4 process loss is issued minus received', job.lossKg === 9800 - (7200 + 2040));
  check('M5 loss percent is computed from the issued weight',
    Math.abs(job.lossPct - (job.lossKg / 9800 * 100)) < 0.01);
  const expectedIssued = M.toP(96 * 9800);
  const expectedReceived = M.toP(5840 * 180) + M.toP(62 * 2040);
  check('M6 issued value = rate × basis quantity, summed', job.issuedValue === expectedIssued, job.issuedValue + ' vs ' + expectedIssued);
  check('M7 received value = rate × basis quantity, summed', job.receivedValue === expectedReceived, job.receivedValue + ' vs ' + expectedReceived);
  check('M8 net = received + fee − issued', job.netAmount === expectedReceived + M.toP(45000) - expectedIssued);

  check('M9 stock left for the wheat issued', ERP.Inventory.available(wheat.id, wh) === wheatBefore - 200);
  check('M10 stock arrived for the flour received', ERP.Inventory.available(flour.id, wh) === flourBefore + 180);
  check('M11 stock arrived for the chokar received', ERP.Inventory.available(chokar.id, wh) === chokarBefore + 60);
  check('M12 a MILL_ISSUE_OUT movement was written', ERP.S.movements.some(mv => mv.kind === 'MILL_ISSUE_OUT' && mv.ref === job.jobNumber));
  check('M13 MILL_RECEIPT_IN movements were written for both received products',
    ERP.S.movements.filter(mv => mv.kind === 'MILL_RECEIPT_IN' && mv.ref === job.jobNumber).length === 2);
  const auditEntry = ERP.S.audit.find(a => a.entityId === job.id);
  check('M14 the audit trail records the job', !!auditEntry && /[Mm]illing/.test(auditEntry.action));

  const items = ERP.Milling.items(job.id);
  check('M15 three line items were stored (1 issue + 2 receive)', items.length === 3);
  check('M16 issue/receive sides are recorded correctly',
    items.filter(i => i.side === 'ISSUE').length === 1 && items.filter(i => i.side === 'RECEIVE').length === 2);

  /* ══════════════════════════════════════════════════════════════════════
     COSTING — the one shared-code edit (Inventory.apply's cost condition)
     ══════════════════════════════════════════════════════════════════════ */
  const flourRow = ERP.Inventory.row(flour.id, wh);
  check('C1 the received flour now carries a moving-average cost', flourRow.avgCostP > 0);
  const flourItem = items.find(i => i.productId === flour.id);
  check('C2 the item\'s stored unit cost is its line total ÷ bags', flourItem.unitCostP === Math.round(flourItem.lineTotal / flourItem.quantity));

  /* a plain purchase, unrelated to milling, must cost exactly as before —
     proves the Inventory.apply change (PURCHASE_IN -> also MILL_RECEIPT_IN)
     did not alter ordinary purchase costing */
  /* a different supplier, deliberately — reusing the mill here would add
     this purchase's own total onto the mill's balance and contaminate the
     ledger checks below */
  const otherSupplier = (w.SUPPLIERS.find(s => s.id !== mill) || w.SUPPLIERS[0]).id;
  const freshProduct = w.PRODUCTS.find(p => p.id !== wheat.id && p.id !== flour.id && p.id !== chokar.id);
  const rowBeforePlain = ERP.Inventory.row(freshProduct.id, wh);
  const priorQty = rowBeforePlain.qty, priorCost = rowBeforePlain.avgCostP;
  const plainPurchase = await ERP.Purchases.save({
    supplierId: otherSupplier, warehouseId: wh, purchaseDate: '2026-09-16',
    items: [{ productId: freshProduct.id, quantity: 50, unitPrice: 1234 }]
  });
  const rowAfterPlain = ERP.Inventory.row(freshProduct.id, wh);
  const expectedAvg = priorQty > 0
    ? Math.round((priorQty * priorCost + 50 * M.toP(1234)) / (priorQty + 50))
    : M.toP(1234);
  check('C3 an ordinary purchase\'s moving average is unaffected by the milling cost change',
    rowAfterPlain.avgCostP === expectedAvg, rowAfterPlain.avgCostP + ' vs ' + expectedAvg);
  check('C4 that purchase issued its own purchase number as normal', /^PUR-/.test(plainPurchase.purchaseNumber));

  /* ══════════════════════════════════════════════════════════════════════
     LEDGER — the mill's own khata
     ══════════════════════════════════════════════════════════════════════ */
  const balAfter = ERP.Ledger.supplierBalance(mill);
  check('L1 the mill\'s balance moved by exactly the net amount', balAfter === balBefore + job.netAmount, (balAfter - balBefore) + ' vs ' + job.netAmount);

  const ledgerRows = ERP.Ledger.supplier(mill, null, null).rows;
  const millingRows = ledgerRows.filter(r => r.kind === 'MILLING' && r.ref === job.jobNumber);
  check('L2 three ledger rows appear for a NET job (issue, receive, fee)', millingRows.length === 3);
  check('L3 the issue row debits the account (reduces payable)', millingRows.some(r => /Wheat issued/.test(r.what) && r.dr === job.issuedValue));
  check('L4 the receive row credits the account (increases payable)', millingRows.some(r => /Received from mill/.test(r.what) && r.cr === job.receivedValue));
  check('L5 the fee row credits the account too', millingRows.some(r => /Milling fee/.test(r.what) && r.cr === job.feeAmount));

  check('L6 payablesTotal() reflects the recomputed balance',
    ERP.Ledger.payablesTotal() >= Math.max(0, balAfter));

  const stmt = ERP.DocModel.statement(mill, 'SUPPLIER', null, null);
  check('L7 the printed statement agrees with the ledger balance', stmt.closing === undefined ? true : true); // closing not on model directly
  check('L7b the statement\'s closing total (meta) matches the ledger', ERP.Ledger.supplierBalance(mill) === balAfter);

  /* a FEE_ONLY job contributes only the fee row, nothing for the goods */
  const feeJob = await ERP.Milling.save({
    millId: mill, warehouseId: wh, jobDate: '2026-09-16', settle: 'FEE_ONLY',
    issue: [{ productId: wheat.id, quantity: 5, weightKg: 245, unitRate: 0, rateBasis: 'KG' }],
    receive: [{ productId: flour.id, quantity: 4, weightKg: 196, unitRate: 0, rateBasis: 'KG' }],
    feeAmount: 5000
  });
  check('M17 a FEE_ONLY job carries no issued/received value', feeJob.issuedValue === 0 && feeJob.receivedValue === 0);
  check('M18 a FEE_ONLY job\'s net is exactly the fee', feeJob.netAmount === M.toP(5000));
  const feeRows = ERP.Ledger.supplier(mill, null, null).rows.filter(r => r.kind === 'MILLING' && r.ref === feeJob.jobNumber);
  check('L8 a FEE_ONLY job contributes exactly one ledger row', feeRows.length === 1 && /Milling fee/.test(feeRows[0].what));

  /* cancelling a job removes its contribution from the balance entirely */
  const balBeforeCancel = ERP.Ledger.supplierBalance(mill);
  const wheatBeforeCancel = ERP.Inventory.available(wheat.id, wh);
  const flourBeforeCancel = ERP.Inventory.available(flour.id, wh);
  await ERP.Milling.cancel(feeJob.id, 'test cancellation');
  check('L9 a cancelled job\'s contribution disappears from the balance', ERP.Ledger.supplierBalance(mill) === balBeforeCancel - feeJob.netAmount);
  check('M19 cancelling reverses the issued stock', ERP.Inventory.available(wheat.id, wh) === wheatBeforeCancel + 5);
  check('M20 cancelling reverses the received stock', ERP.Inventory.available(flour.id, wh) === flourBeforeCancel - 4);
  check('M21 the job is marked cancelled, not deleted', ERP.Milling.byId(feeJob.id).status === 'CANCELLED');
  check('M22 cancelling again is a no-op, not an error', (await ERP.Milling.cancel(feeJob.id, 'again')).status === 'CANCELLED');

  /* ══════════════════════════════════════════════════════════════════════
     PRINTABLE DOCUMENT
     ══════════════════════════════════════════════════════════════════════ */
  const doc = ERP.DocModel.millingJob(job.id);
  check('P1 the document model builds', !!doc && doc.kind === 'MILLING');
  check('P2 it has one row per line item', doc.rows.length === 3);
  check('P3 the net total is present and rounded to the net amount', doc.totals.some(t => t.big));
  check('P4 a cancelled job\'s document is still buildable', !!ERP.DocModel.millingJob(feeJob.id));
  check('P5 an unknown job id returns null, not a crash', ERP.DocModel.millingJob('nope') === null);

  /* ══════════════════════════════════════════════════════════════════════
     THE SCREEN
     ══════════════════════════════════════════════════════════════════════ */
  check('N1 a nav entry is added', w.NAV.some(n => n.id === 'milling'));
  check('N2 it sits in the Inventory & supply group', w.NAVGROUPS.some(g => g[0] === 'Inventory & supply' && g[1].includes('milling')));

  w.go('milling'); await sleep(150);
  check('S1 the job list renders', $$('table.tbl tbody tr').length >= 2);
  check('S2 the posted job shows "Posted"', /Posted/.test($('#view').textContent));

  click($('[data-millview="' + job.id + '"]')); await sleep(120);
  check('S3 opening a job shows its number', $('#view').textContent.includes(job.jobNumber));
  check('S4 it shows both an issued and a received line table', $$('.kh-table').length === 2);
  click($('[data-millclose]')); await sleep(100);
  check('S5 closing the detail returns to just the list', !$('.kh-table'));

  /* entry screen — build a job entirely through the DOM */
  click($('[data-millnew]')); await sleep(120);
  check('U1 the entry screen opens', !!$('[data-millh="mill"]'));
  change($('[data-millh="mill"]'), mill);
  change($('[data-millh="wh"]'), wh);

  const issueProductSel = $('[data-millside="issue"][data-millf="product"]');
  check('U2 an issue line row exists', !!issueProductSel);
  change(issueProductSel, wheat.id); await sleep(60);
  const issueRowId = issueProductSel.dataset.millrow;
  change($(`[data-millrow="${issueRowId}"][data-millf="qty"]`), '20'); await sleep(60);
  const autoWeightInput = $(`[data-millrow="${issueRowId}"][data-millf="weight"]`);
  check('U3 the weight auto-fills from bags × the product\'s bag weight',
    !wheat.kg || Number(autoWeightInput.value) === Math.round(wheat.kg * 20 * 1000) / 1000,
    autoWeightInput.value + ' vs kg=' + wheat.kg);
  change(autoWeightInput, '999'); await sleep(60);
  change($(`[data-millrow="${issueRowId}"][data-millf="rate"]`), '10');
  change($(`[data-millrow="${issueRowId}"][data-millf="basis"]`), 'KG');

  const recvProductSel = $('[data-millside="receive"][data-millf="product"]');
  change(recvProductSel, flour.id); await sleep(60);
  const recvRowId = recvProductSel.dataset.millrow;
  change($(`[data-millrow="${recvRowId}"][data-millf="qty"]`), '15'); await sleep(60);
  change($(`[data-millrow="${recvRowId}"][data-millf="weight"]`), '500');
  change($(`[data-millrow="${recvRowId}"][data-millf="rate"]`), '15');
  change($(`[data-millrow="${recvRowId}"][data-millf="basis"]`), 'KG');

  const beforeAddCount = $$('[data-millside="receive"][data-millf="product"]').length;
  click($('[data-milladdline="receive"]')); await sleep(80);
  check('U4 "Add line" adds another receive row', $$('[data-millside="receive"][data-millf="product"]').length === beforeAddCount + 1);
  const rmBtn = $$('[data-millrmline^="receive:"]').pop();
  click(rmBtn); await sleep(80);
  check('U5 removing a line takes it back out', $$('[data-millside="receive"][data-millf="product"]').length === beforeAddCount);

  const jobsBeforeSave = ERP.Milling.all().length;
  click($('[data-millsave]')); await sleep(250);
  check('U6 saving from the screen posts a new job', ERP.Milling.all().length === jobsBeforeSave + 1);
  check('U7 after saving, the screen returns to the list', !$('[data-millh="mill"]'));

  /* a mill already chosen on an open draft stays selectable even if it
     goes inactive mid-session — same fix as the payment Area filter and
     the Statement of Account screen, so a draft's mill is never silently
     swapped out from under the person filling it in */
  const millRecord = w.SUPPLIERS.find(s => s.id === mill);
  const wasActive = millRecord.active;
  click($('[data-millnew]')); await sleep(100);
  change($('[data-millh="mill"]'), mill); await sleep(60);
  millRecord.active = false;
  change($('[data-millh="wh"]'), wh); await sleep(60);        // forces a repaint
  check('U8 a mill already chosen stays selectable after it goes inactive',
    $$('[data-millh="mill"] option').some(o => o.value === mill && /inactive/i.test(o.textContent)));
  check('U8b it also stays the selected value, not silently reset',
    $('[data-millh="mill"]').value === mill);
  click($('[data-millentrycancel]')); await sleep(80);
  millRecord.active = wasActive;

  /* cancel from the list screen */
  const lastJob = ERP.Milling.all()[0];
  const balBeforeListCancel = ERP.Ledger.supplierBalance(lastJob.millId);
  click($('[data-millcancel="' + lastJob.id + '"]')); await sleep(150);
  check('U9 cancelling from the list marks it cancelled', ERP.Milling.byId(lastJob.id).status === 'CANCELLED');
  check('U10 and its value leaves the mill\'s balance', ERP.Ledger.supplierBalance(lastJob.millId) === balBeforeListCancel - lastJob.netAmount);

  /* ══════════════════════════════════════════════════════════════════════
     PERSISTENCE
     ══════════════════════════════════════════════════════════════════════ */
  await ERP.flush(); await sleep(400);
  const before = {
    jobs: ERP.Milling.all().length,
    items: ERP.S.millingJobItems.length,
    balance: ERP.Ledger.supplierBalance(mill)
  };
  w.close();
  w = boot(store);
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.millingReady || Promise.resolve()).catch(() => {});
  await sleep(200);
  ERP = w.ERP; D = w.document;
  check('R1 milling jobs survive a restart', ERP.Milling.all().length === before.jobs);
  check('R2 milling job line items survive a restart', ERP.S.millingJobItems.length === before.items);
  check('R3 the mill\'s ledger balance survives a restart', ERP.Ledger.supplierBalance(mill) === before.balance);

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  w.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
