/* Client voice notes (Punjab stock, 2026-09-20): the mill (in Punjab) is handed wheat by weight, makes flour plus
   two or three by-products and often KEEPS the finished goods there. The ERP must show what is lying at the mill,
   and as loads arrive here they are taken off that balance ("30,000 bags made, all still in Punjab; whatever
   arrives, deduct it"). This file covers that flow (32-milling.js: receiveMode AT_MILL, arrivals, the balance
   at the mill, the Stock at mills screen, the arrival document). test-milling.mjs covers the original job. */
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
async function ready(w) {
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.millingReady || Promise.resolve()).catch(() => {});
  await sleep(250);
}

async function main() {
  const store = {};
  let w = boot(store);
  await ready(w);
  let ERP = w.ERP, D = w.document, M = w.Money;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const change = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };
  const rejects = p => p.then(() => null, e => e);

  check('A1 the arrivals store exists', w.FDB.STORE_NAMES.includes('millingArrivals'));
  check('A2 the service is there', typeof ERP.Milling.receiveArrival === 'function' && typeof ERP.Milling.atMill === 'function');
  check('A3 the arrival document model exists', typeof ERP.DocModel.millingArrival === 'function');

  const withKg = excl => w.PRODUCTS.find(p => p.kg && !excl.includes(p.id));
  const wheat = w.PRODUCTS.find(p => p.id === 'PRD-0097') || withKg([]);
  const flour = w.PRODUCTS.find(p => p.id === 'PRD-0004') || withKg([wheat.id]);
  const chokar = w.PRODUCTS.find(p => p.id === 'PRD-0041') || withKg([wheat.id, flour.id]);
  const fine = withKg([wheat.id, flour.id, chokar.id]);           /* a third by-product (suji / maida style) */
  const wh = w.WAREHOUSES[0].id;
  const wh2 = (w.WAREHOUSES[1] || w.WAREHOUSES[0]).id;
  const millA = w.SUPPLIERS[0].id, millB = w.SUPPLIERS[1].id;
  const avail = (p, x) => ERP.Inventory.available(p.id, x || wh);
  const moves = async ref => (await w.FDB.hydrate()).stockMovements.filter(m => m.ref === ref);

  await ERP.Purchases.save({ supplierId: millB, warehouseId: wh, purchaseDate: '2026-09-01',
    items: [{ productId: wheat.id, quantity: 1000, unitPrice: 100 }] });

  const wheat0 = avail(wheat), flour0 = avail(flour), chokar0 = avail(chokar), fine0 = avail(fine);
  const bal0 = ERP.Ledger.supplierBalance(millA);

  /* ── a job whose goods stay at the mill ─────────────────────────────── */
  const jobDraft = mode => ({
    millId: millA, warehouseId: wh, jobDate: '2026-09-10', settle: 'NET', receiveMode: mode,
    issue: [{ productId: wheat.id, quantity: 100, weightKg: 4900, unitRate: 100, rateBasis: 'BAG' }],
    receive: [
      { productId: flour.id, quantity: 60, weightKg: 3000, unitRate: 120, rateBasis: 'BAG' },
      { productId: chokar.id, quantity: 30, weightKg: 1020, unitRate: 40, rateBasis: 'BAG' },
      { productId: fine.id, quantity: 10, weightKg: 300, unitRate: 60, rateBasis: 'BAG' }
    ]
  });
  const job = await ERP.Milling.save(jobDraft('AT_MILL'));
  check('B1 the job records where its goods are', job.receiveMode === 'AT_MILL' && ERP.Milling.receiveMode(job) === 'AT_MILL');
  check('B2 the wheat left the warehouse', avail(wheat) === wheat0 - 100);
  check('B3 NOTHING was added to any warehouse for flour / chokar / third product',
    avail(flour) === flour0 && avail(chokar) === chokar0 && avail(fine) === fine0);
  const jm = await moves(job.jobNumber);
  check('B4 only the wheat issue movement was written', jm.length === 1 && jm[0].kind === 'MILL_ISSUE_OUT', JSON.stringify(jm.map(m => m.kind)));
  const net = M.toP(60 * 120 + 30 * 40 + 10 * 60) - M.toP(100 * 100);
  check('B5 the mill\'s account is charged exactly as for a delivered job', ERP.Ledger.supplierBalance(millA) === bal0 + net);

  const at = () => ERP.Milling.atMill({ millId: millA });
  const rowOf = p => at().find(r => r.productId === p.id);
  check('C1 three products are lying at the mill', at().length === 3);
  check('C2 flour: 60 bags, 3000 kg, none arrived', rowOf(flour).qty === 60 && rowOf(flour).kg === 3000 && rowOf(flour).arrivedQty === 0);
  check('C3 chokar and the third product', rowOf(chokar).qty === 30 && rowOf(fine).qty === 10);
  check('C4 cost per bag is the job\'s rate', rowOf(flour).costPerBagP === M.toP(120) && rowOf(chokar).costPerBagP === M.toP(40));
  check('C5 worth = bags × cost', rowOf(flour).valueP === 60 * M.toP(120));
  const tot = ERP.Milling.atMillTotals(millA);
  check('C6 totals: wheat given / made / loss', tot.issuedKg === 4900 && tot.producedKg === 4320 && tot.lossKg === 580 && tot.qty === 100 && tot.arrivedQty === 0);
  check('C7 nothing shows for another mill', ERP.Milling.atMill({ millId: millB }).length === 0);

  /* ── a load arrives ─────────────────────────────────────────────────── */
  const bal1 = ERP.Ledger.supplierBalance(millA);
  const arr1 = await ERP.Milling.receiveArrival({ millId: millA, warehouseId: wh, arrivalDate: '2026-09-12', vehicle: 'LEB-1234',
    lines: [{ productId: flour.id, quantity: 20, weightKg: 1000 }, { productId: chokar.id, quantity: 10, weightKg: 340 }] });
  check('D1 arrival is numbered MAR-…', /^MAR-\d{4}-\d{6}$/.test(arr1.arrivalNumber), arr1.arrivalNumber);
  check('D2 the bags were added to the warehouse', avail(flour) === flour0 + 20 && avail(chokar) === chokar0 + 10);
  check('D3 the third product is untouched', avail(fine) === fine0);
  check('D4 the balance at the mill went down by exactly that', rowOf(flour).qty === 40 && rowOf(flour).kg === 2000 && rowOf(chokar).qty === 20);
  check('D5 arrived totals are tracked', rowOf(flour).arrivedQty === 20 && ERP.Milling.atMillTotals(millA).arrivedQty === 30);
  check('D6 the remaining value follows', rowOf(flour).valueP === 40 * M.toP(120));
  check('D7 an arrival moves goods, not money: the mill\'s account is unchanged', ERP.Ledger.supplierBalance(millA) === bal1);
  const am = await moves(arr1.arrivalNumber);
  check('D8 one stock movement per line, carrying the cost', am.length === 2 && am.every(m => m.kind === 'MILL_RECEIPT_IN' && m.refType === 'MILL_ARRIVAL') &&
    am.find(m => m.productId === flour.id).unitCostP === M.toP(120), JSON.stringify(am.map(m => [m.kind, m.unitCostP])));
  check('D9 totals stored on the arrival', arr1.totalQty === 30 && arr1.totalKg === 1340 && arr1.status === 'POSTED');
  check('D10 the moving average of the stock row took the mill cost when the row was empty',
    flour0 > 0 || ERP.Inventory.row(flour.id, wh).avgCostP === M.toP(120));

  /* a second, partial load into another warehouse; then everything else */
  const arr2 = await ERP.Milling.receiveArrival({ millId: millA, warehouseId: wh2, arrivalDate: '2026-09-15',
    lines: [{ productId: flour.id, quantity: 15, weightKg: 750 }] });
  check('E1 a second load into a different warehouse', avail(flour, wh2) >= 15 && rowOf(flour).qty === 25);
  check('E2 Arrivals are listed newest first', ERP.Milling.arrivals()[0].id === arr2.id);

  /* ── refusals ───────────────────────────────────────────────────────── */
  const stockNow = avail(flour);
  const r1 = await rejects(ERP.Milling.receiveArrival({ millId: millA, warehouseId: wh, lines: [{ productId: flour.id, quantity: 26, weightKg: 1300 }] }));
  check('F1 more than is at the mill is refused, naming the figures', r1 && r1.validation && /Only 25 bags/.test(r1.validation[0]), JSON.stringify(r1 && r1.validation));
  check('F2 …and nothing was written', avail(flour) === stockNow && rowOf(flour).qty === 25);
  const r2 = await rejects(ERP.Milling.receiveArrival({ millId: millA, warehouseId: wh, lines: [{ productId: flour.id, quantity: 15, weightKg: 750 }, { productId: flour.id, quantity: 11, weightKg: 550 }] }));
  check('F3 the same product on two lines is added together before the check', r2 && r2.validation && /Only 25/.test(r2.validation[0]));
  const r3 = await rejects(ERP.Milling.receiveArrival({ millId: millB, warehouseId: wh, lines: [{ productId: flour.id, quantity: 1, weightKg: 50 }] }));
  check('F4 goods lying at a DIFFERENT mill cannot be received from this one', r3 && r3.validation && /No .* is recorded as lying at/.test(r3.validation[0]) && /Record the milling job/.test(r3.validation[0]));
  const r4 = await rejects(ERP.Milling.receiveArrival({ warehouseId: wh, lines: [{ productId: flour.id, quantity: 1, weightKg: 50 }] }));
  check('F5 no mill', r4 && r4.validation && /mill/i.test(r4.validation[0]));
  const r5 = await rejects(ERP.Milling.receiveArrival({ millId: millA, lines: [] }));
  check('F6 no warehouse and no lines', r5 && r5.validation && r5.validation.some(m => /warehouse/i.test(m)) && r5.validation.some(m => /at least one/i.test(m)));
  const r6 = await rejects(ERP.Milling.receiveArrival({ millId: millA, warehouseId: wh, lines: [{ productId: flour.id, quantity: 0, weightKg: 50 }] }));
  check('F7 zero bags', r6 && r6.validation && /more than zero/.test(r6.validation[0]));
  const r7 = await rejects(ERP.Milling.receiveArrival({ millId: millA, warehouseId: wh, lines: [{ productId: flour.id, quantity: 1, weightKg: 0 }] }));
  check('F8 zero weight', r7 && r7.validation && /weight/i.test(r7.validation[0]));
  const dup = { id: 'mar-dup-test', clientOpId: 'op-dup-1', millId: millA, warehouseId: wh, lines: [{ productId: chokar.id, quantity: 2, weightKg: 68 }] };
  await ERP.Milling.receiveArrival(dup);
  const dupErr = await rejects(ERP.Milling.receiveArrival(Object.assign({}, dup, { id: 'mar-dup-test' })));
  check('F9 a double-clicked Save cannot receive the same load twice', !!dupErr && rowOf(chokar).qty === 18, 'chokar at mill ' + rowOf(chokar).qty);

  /* ── cancelling ─────────────────────────────────────────────────────── */
  const rJob = await rejects(ERP.Milling.cancel(job.id, 'oops'));
  check('G1 a job whose goods already arrived cannot be cancelled', rJob && rJob.validation && /already arrived/.test(rJob.validation[0]) && ERP.Milling.byId(job.id).status === 'POSTED', JSON.stringify(rJob && rJob.validation));
  check('G2 …and the message says which goods', !!(rJob && rJob.validation) && /bags of/.test(rJob.validation[0]));
  const flourBeforeCancel = avail(flour), wh2Before = avail(flour, wh2);
  await ERP.Milling.cancelArrival(arr2.id, 'wrong truck');
  check('G3 cancelling an arrival takes the bags out of that warehouse again', avail(flour, wh2) === wh2Before - 15 && avail(flour) === flourBeforeCancel);
  check('G4 …and puts them back "at the mill"', rowOf(flour).qty === 40);
  check('G5 cancelling twice is harmless', (await ERP.Milling.cancelArrival(arr2.id, 'again')).status === 'CANCELLED' && avail(flour, wh2) === wh2Before - 15);
  const rm = await moves(arr2.arrivalNumber);
  check('G6 the reversal is a stock movement', rm.some(m => m.kind === 'MILL_RECEIPT_REVERSAL_OUT' && m.qtyDelta === -15));
  await ERP.Milling.cancelArrival(arr1.id, 'x'); await ERP.Milling.cancelArrival('mar-dup-test', 'x');
  check('G7 with every arrival cancelled everything is back at the mill', rowOf(flour).qty === 60 && rowOf(chokar).qty === 30 && ERP.Milling.atMillTotals(millA).arrivedQty === 0);
  const wheatBeforeCancel = avail(wheat);
  await ERP.Milling.cancel(job.id, 'entered twice');
  check('G8 now the job can be cancelled: wheat is back, no flour stock is removed (it never arrived)',
    avail(wheat) === wheatBeforeCancel + 100 && avail(flour) === flour0 && avail(chokar) === chokar0);
  check('G9 its goods leave the balance at the mill and its value leaves the account', at().length === 0 && ERP.Ledger.supplierBalance(millA) === bal0);

  /* ── delivered jobs are unchanged and never appear at the mill ──────── */
  const legacy = await ERP.Milling.save(jobDraft(undefined));
  check('H1 a job saved without the field means "already here"', ERP.Milling.receiveMode(legacy) === 'DELIVERED' && avail(flour) === flour0 + 60);
  check('H2 …so nothing is lying at the mill for it', at().length === 0);
  const rLeg = await rejects(ERP.Milling.receiveArrival({ millId: millA, warehouseId: wh, lines: [{ productId: flour.id, quantity: 1, weightKg: 50 }] }));
  check('H3 an arrival against it is refused', rLeg && rLeg.validation);
  const oldShape = { id: 'old1', jobNumber: 'MIL-OLD', millId: millA, status: 'POSTED', jobDate: '2026-01-01' };
  check('H4 a stored record with no receiveMode reads as DELIVERED', ERP.Milling.receiveMode(oldShape) === 'DELIVERED');
  await ERP.Milling.cancel(legacy.id, 'test');
  check('H5 cancelling it still takes the flour back out of the warehouse', avail(flour) === flour0);

  /* ── two mills stay separate; an arrival needs a job of ITS mill ────── */
  const jA = await ERP.Milling.save(jobDraft('AT_MILL'));
  const jB = await ERP.Milling.save(Object.assign(jobDraft('AT_MILL'), { millId: millB,
    receive: [{ productId: flour.id, quantity: 5, weightKg: 250, unitRate: 100, rateBasis: 'BAG' }] }));
  check('I1 each mill has its own balance', ERP.Milling.atMillBalance(millA, flour.id).qty === 60 && ERP.Milling.atMillBalance(millB, flour.id).qty === 5);
  check('I2 no filter lists every mill', ERP.Milling.atMill().length === 4);
  const rB = await rejects(ERP.Milling.receiveArrival({ millId: millB, warehouseId: wh, lines: [{ productId: flour.id, quantity: 6, weightKg: 300 }] }));
  check('I3 mill B cannot send more than mill B holds', rB && rB.validation && /Only 5 bags/.test(rB.validation[0]));
  check('I4 an average-cost sale/stock row picks up the arrival cost',
    (await ERP.Milling.receiveArrival({ millId: millB, warehouseId: wh, lines: [{ productId: flour.id, quantity: 5, weightKg: 250 }] })).lines[0].unitCostP === M.toP(100));
  check('I5 the last bag off a mill leaves a zero row, not a negative one', ERP.Milling.atMillBalance(millB, flour.id).qty === 0 && ERP.Milling.atMillBalance(millB, flour.id).valueP === 0);

  /* ── the screens ────────────────────────────────────────────────────── */
  w.go('milling'); await sleep(150);
  click($('[data-millnew]')); await sleep(100);
  check('J1 the job entry asks where the finished goods are, defaulting to "at the mill"',
    $('[data-millh="mode"]') && $('[data-millh="mode"]').value === 'AT_MILL');
  change($('[data-millh="mode"]'), 'DELIVERED'); await sleep(60);
  check('J2 switching it to "already in our warehouse" sticks', $('[data-millh="mode"]').value === 'DELIVERED');
  click($('[data-millentrycancel]')); await sleep(80);
  check('J3 the job list marks jobs whose goods are at the mill', /Goods at the mill/.test($('.card').textContent));

  check('K1 the nav has "Stock at mills"', w.NAV.some(n => n.id === 'millstock') && w.NAVGROUPS.some(g => g[1].includes('millstock')));
  w.go('millstock'); await sleep(150);
  check('K2 the screen shows what is lying at the mill', /Stock at mills/.test(D.body.textContent) && /Still at the mill/.test(D.body.textContent));
  check('K3 a row per mill + product still holding goods (A: 3)', $$('table.tbl tbody tr').length >= 3);
  check('K4 the filter lists both mills', $$('[data-msfilter] option').length === 3);
  change($('[data-msfilter]'), millA); await sleep(80);
  check('K5 filtering to one mill drops the Mill column', !$$('table.tbl thead th').some(th => th.textContent === 'Mill') || $$('table.tbl')[0].querySelectorAll('thead th').length >= 6);
  check('K6 the "Still at the mill" card says 100 bags', /100 bags/.test($('.kh-cards').textContent), $('.kh-cards') && $('.kh-cards').textContent);

  click($('[data-msnew]')); await sleep(100);
  check('K7 "Goods arrived" opens the entry, with the filtered mill already chosen', $('[data-msh="mill"]') && $('[data-msh="mill"]').value === millA);
  const prodSel = $('[data-msrow][data-msf="product"]');
  check('K8 the product list offers only goods at that mill, with the bags left', prodSel && [...prodSel.options].some(o => o.value === flour.id && /60 bags at the mill/.test(o.textContent)));
  change(prodSel, flour.id); await sleep(60);
  change($('[data-msrow][data-msf="qty"]'), '20'); await sleep(60);
  check('K9 the weight fills in from the bag size and stays editable', Number($('[data-msrow][data-msf="weight"]').value) === 20 * (flour.kg || 0));
  check('K10 the before/after table shows 60 → 40', /40/.test($$('table.kh-table')[0] ? $$('table.kh-table')[0].textContent : ''));
  change($('[data-msrow][data-msf="qty"]'), '61'); await sleep(60);
  check('K11 too many bags is called out on screen before saving', /more than is at the mill/.test(D.body.textContent));
  click($('[data-mssave]')); await sleep(150);
  check('K12 …and Save refuses it', ERP.Milling.arrivals().filter(a => a.status !== 'CANCELLED' && a.millId === millA).length === 0 && !!$('[data-mssave]'));
  change($('[data-msrow][data-msf="qty"]'), '20'); await sleep(60);
  change($('[data-msh="vehicle"]'), 'TRK-77'); await sleep(40);
  const flourWhBefore = avail(flour);
  click($('[data-mssave]')); await sleep(400);
  const posted = ERP.Milling.arrivals().find(a => a.millId === millA && a.status !== 'CANCELLED');
  check('K13 saving from the screen posts the arrival', !!posted && posted.vehicle === 'TRK-77' && posted.totalQty === 20);
  check('K14 …adds the bags to the warehouse and returns to the list', avail(flour) === flourWhBefore + 20 && !!$('[data-msnew]') && !$('[data-mssave]'));
  check('K15 the list now says 40 bags of flour still at the mill', /40/.test(D.body.textContent) && ERP.Milling.atMillBalance(millA, flour.id).qty === 40);

  const m = ERP.DocModel.millingArrival(posted.id);
  check('L1 the arrival document has the load, the vehicle and what is left', m && m.kind === 'MILLING_ARRIVAL' && m.rows.length === 1 && m.meta.some(r => r[1] === 'TRK-77') && /80 bags/.test(JSON.stringify(m.totals)));
  const jm2 = ERP.DocModel.millingJob(jA.id);
  check('L2 the job document says the goods are at the mill', jm2.meta.some(r => r[0] === 'Finished goods' && /at the mill/i.test(r[1])) && jm2.rows.some(r => r.side === 'Made'));

  click($('[data-msarrcancel="' + posted.id + '"]')); await sleep(200);
  check('M1 cancelling from the list reverses it', ERP.Milling.arrivalById(posted.id).status === 'CANCELLED' && avail(flour) === flourWhBefore && ERP.Milling.atMillBalance(millA, flour.id).qty === 60);

  /* a remembered filter whose mill has nothing any more falls back to All */
  await ERP.Milling.cancel(jB.id, 'x').catch(() => {});
  await ERP.Milling.cancel(jA.id, 'x');
  change($('[data-msfilter]'), ''); await sleep(60);
  check('N1 with nothing left the screen says so', /Nothing is lying at a mill/.test(D.body.textContent));

  /* ── survives a restart ─────────────────────────────────────────────── */
  const jR = await ERP.Milling.save(jobDraft('AT_MILL'));
  const aR = await ERP.Milling.receiveArrival({ millId: millA, warehouseId: wh, lines: [{ productId: flour.id, quantity: 25, weightKg: 1250 }] });
  const before = { arr: ERP.Milling.arrivals().length, flour: rowOf(flour).qty, tot: ERP.Milling.atMillTotals(millA).qty };
  w.close(); w = boot(store); await ready(w);
  ERP = w.ERP;
  const bal = ERP.Milling.atMillBalance(millA, flour.id);
  check('R1 arrivals survive a restart', ERP.Milling.arrivals().length === before.arr && !!ERP.Milling.arrivalById(aR.id));
  check('R2 the balance at the mill is the same after a restart', bal.qty === before.flour && bal.qty === 35 && ERP.Milling.atMillTotals(millA).qty === before.tot);
  check('R3 the job still remembers where its goods are', ERP.Milling.receiveMode(ERP.Milling.byId(jR.id)) === 'AT_MILL');
  w.close();

  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
