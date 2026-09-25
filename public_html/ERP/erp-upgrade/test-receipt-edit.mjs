/* Editing an "Add stock" receipt (2026-09-25).
   Client request: stock added through Inventory → Add stock must be editable
   afterwards (wrong bags, wrong cost, wrong product, wrong warehouse/date).

   The edit (07-transactions.js StockDocs.editReceive) reverses the old lines
   with RECEIPT_EDIT_OUT movements at their old cost and re-posts the corrected
   lines, under the same RCV number, in one atomic save.

   Covers: the engine (qty, cost, lines, product swap, warehouse move, date,
   opening stock), the carried cost / Stock value using the corrected cost only,
   the stock guard on the net change, refusals (not a receipt, role, bad
   input), the audit entry, the movement report and the screens (list Edit
   button, document Edit button, the edit screen and its Save). */
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

process.env.TZ = 'Asia/Karachi';
const HTML = fs.readFileSync(path.resolve('dist/farooq-co-erp.html'), 'utf8');
let pass = 0, fail = 0; const out = [];
function check(name, cond, detail) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = n => Math.round(n * 100);

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

async function main() {
  const store = {};
  const w = boot(store);
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.landedReady || Promise.resolve()).catch(() => {});
  await sleep(250);
  const ERP = w.ERP, D = w.document, SD = ERP.StockDocs;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const typeIn = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); } };
  const rejected = async p => { try { await p; return null; } catch (e) { return e; } };
  const msgs = e => (e && e.validation || []).join(' | ');

  await ERP.Settings.save({ allowNegativeStock: false });
  const whs = w.WAREHOUSES.filter(x => x.active !== false), wh = whs[0], wh2 = whs[1];
  const cust = w.CUSTOMERS[0];
  const P = w.PRODUCTS.filter(p => p.active !== false);
  const pA = P[20], pB = P[21], pC = P[22], pD = P[23];
  const stock = (p, wid) => ERP.Inventory.available(p.id, wid || wh.id);
  const add = (lines, extra) => SD.receive(Object.assign({ warehouseId: wh.id, date: '2026-09-05', reason: 'opening count',
    items: lines.map(([p, q, c]) => ({ productId: p.id, quantity: q, unitPrice: c === undefined ? '' : c })) }, extra || {}));
  const edit = (id, fn) => { const d = SD.toDraft(SD.byId(id)); fn(d); return SD.editReceive(d); };
  const sell = (p, qty) => ERP.Invoices.save({ customerId: cust.id, warehouseId: wh.id, invoiceDate: '2026-09-10', paidAmount: 0,
    items: [{ productId: p.id, quantity: qty, unitPrice: 5000, discount: 0, warehouseId: wh.id }] });
  const mvSum = (p, wid) => ERP.S.movements.filter(m => m.productId === p.id && m.warehouseId === wid && m.bucket !== 'damaged')
    .reduce((a, m) => a + m.qtyDelta, 0);

  /* ═══ A. the API is there ═══ */
  check('A1 editReceive / toDraft / canEdit exist',
    ['editReceive', 'toDraft', 'canEdit'].every(k => typeof SD[k] === 'function'));

  /* ═══ B. quantity and cost corrected ═══ */
  const r1 = await add([[pA, 50, 3000]]);
  check('B0 the receipt is posted: 50 bags at 3000', stock(pA) === 50 && ERP.Inventory.carriedCost(pA.id, wh.id) === R(3000));
  const nDocs = ERP.S.stockDocs.length;
  const e1 = await edit(r1.id, d => { d.items[0].quantity = 40; d.items[0].unitPrice = 3200; });
  check('B1 edited to 40 bags: stock is 40, not 90 or 50', stock(pA) === 40, String(stock(pA)));
  check('B2 the corrected cost replaces the old one (3200, not an average with 3000)',
    ERP.Inventory.carriedCost(pA.id, wh.id) === R(3200) && ERP.Inventory.costOf(pA.id, wh.id) === R(3200),
    ERP.Inventory.carriedCost(pA.id, wh.id));
  const svRow = ERP.StockValue.build({}).rows.find(r => r.productId === pA.id && r.warehouseId === wh.id);
  check('B3 Stock value agrees: 40 bags at 3200', svRow && svRow.qty === 40 && svRow.costP === R(3200),
    svRow && JSON.stringify({ q: svRow.qty, c: svRow.costP }));
  check('B4 same document, same number, no new document',
    e1.id === r1.id && e1.docNumber === r1.docNumber && ERP.S.stockDocs.length === nDocs);
  const it1 = SD.items(r1.id);
  check('B5 the document now has the one corrected line', it1.length === 1 && it1[0].quantity === 40 && it1[0].unitCostP === R(3200));
  check('B6 header totals and revision follow', e1.totalQty === 40 && e1.lineCount === 1 && e1.revision === 1);
  const rev = ERP.S.movements.filter(m => m.ref === r1.docNumber && m.kind === 'RECEIPT_EDIT_OUT');
  check('B7 the old line was reversed by a RECEIPT_EDIT_OUT movement at its old cost, dated as the original',
    rev.length === 1 && rev[0].qtyDelta === -50 && rev[0].unitCostP === R(3000) && rev[0].date === '2026-09-05');
  check('B8 the stock row still equals the sum of its movements', mvSum(pA, wh.id) === stock(pA));
  check('B9 the movement has a readable label', /receipt edited/i.test(ERP.Movements.label('RECEIPT_EDIT_OUT')));
  const au = ERP.S.audit.find(a => a.action === 'Stock receipt edited' && a.entityId === r1.id);
  check('B10 the edit is in the audit log with old and new lines',
    !!au && /× 50/.test(JSON.stringify(au.oldValues)) && /× 40/.test(JSON.stringify(au.newValues)));

  /* a second edit on top of the first */
  await edit(r1.id, d => { d.items[0].quantity = 45; d.items[0].unitPrice = 3100; });
  check('B11 edited again: 45 bags at 3100, the earlier corrections fully undone',
    stock(pA) === 45 && ERP.Inventory.carriedCost(pA.id, wh.id) === R(3100) && SD.byId(r1.id).revision === 2,
    stock(pA) + ' @ ' + ERP.Inventory.carriedCost(pA.id, wh.id));

  /* ═══ C. lines added, swapped, removed; date and reason ═══ */
  const r2 = await add([[pB, 10, 2000]]);
  await edit(r2.id, d => {
    d.items[0].productId = pC.id;                                   // wrong product picked
    d.items.push(Object.assign({}, d.items[0], { productId: pD.id, quantity: 7, unitPrice: 1500 }));
    d.date = '2026-09-06'; d.reason = 'corrected count';
  });
  check('C1 wrong product swapped: pB back to 0, pC 10, extra line pD 7',
    stock(pB) === 0 && stock(pC) === 10 && stock(pD) === 7, [stock(pB), stock(pC), stock(pD)].join());
  check('C2 the swapped-out product has no carried cost left', ERP.Inventory.carriedCost(pB.id, wh.id) === 0);
  const d2 = SD.byId(r2.id);
  check('C3 date and reason updated, two lines, 17 bags', d2.docDate === '2026-09-06' && d2.reason === 'corrected count' &&
    d2.lineCount === 2 && d2.totalQty === 17);
  await edit(r2.id, d => { d.items = d.items.filter(i => i.productId === pD.id); });
  check('C4 a line removed takes its bags back out', stock(pC) === 0 && stock(pD) === 7 && SD.items(r2.id).length === 1);

  /* ═══ D. warehouse moved ═══ */
  await edit(r2.id, d => { d.warehouseId = wh2.id; d.items.forEach(i => { i.warehouseId = wh2.id; }); });
  check('D1 changed warehouse: bags leave the old one and arrive in the new one',
    stock(pD, wh.id) === 0 && stock(pD, wh2.id) === 7 && SD.byId(r2.id).warehouseId === wh2.id);
  check('D2 …and the cost goes with them', ERP.Inventory.carriedCost(pD.id, wh2.id) === R(1500) &&
    ERP.Inventory.carriedCost(pD.id, wh.id) === 0);

  /* ═══ E. the stock guard: sold bags cannot be taken back ═══ */
  await sell(pA, 40);                                                 // 45 in, 40 sold → 5 left
  check('E0 40 sold, 5 left', stock(pA) === 5);
  const before = JSON.stringify(SD.items(r1.id)) + stock(pA);
  const eE = await rejected(edit(r1.id, d => { d.items[0].quantity = 20; }));
  check('E1 reducing the receipt by more than is left is refused, and says why',
    !!eE && /Only 5 bags/.test(msgs(eE)) && /already been sold or moved/.test(msgs(eE)), msgs(eE));
  check('E2 …and nothing changed', JSON.stringify(SD.items(r1.id)) + stock(pA) === before);
  await edit(r1.id, d => { d.items[0].quantity = 41; });
  check('E3 reducing by what is still there is allowed (45 → 41, 1 left)', stock(pA) === 1);
  await ERP.Settings.save({ allowNegativeStock: true });
  await edit(r1.id, d => { d.items[0].quantity = 39; });
  check('E4 with negative stock allowed in Settings, the guard steps aside like everywhere else', stock(pA) === -1);
  await edit(r1.id, d => { d.items[0].quantity = 45; });
  await ERP.Settings.save({ allowNegativeStock: false });

  /* ═══ F. refusals ═══ */
  const eF1 = await rejected(edit(r1.id, d => { d.items = []; }));
  check('F1 no lines → refused', /at least one product line/.test(msgs(eF1)));
  const eF2 = await rejected(edit(r1.id, d => { d.reason = ''; }));
  check('F2 no reason → refused', /reason/i.test(msgs(eF2)));
  const eF3 = await rejected(edit(r1.id, d => { d.items[0].quantity = 0; }));
  check('F3 zero bags → refused', /more than zero/.test(msgs(eF3)));
  const eF4 = await rejected(edit(r1.id, d => { d.items[0].unitPrice = -5; }));
  check('F4 a negative cost → refused', /cannot be negative/.test(msgs(eF4)));
  check('F5 …none of them changed the stock', stock(pA) === 5 && SD.byId(r1.id).revision === 5, stock(pA) + ' rev ' + SD.byId(r1.id).revision);
  const tr = await SD.transfer({ warehouseId: wh.id, toWarehouseId: wh2.id, date: '2026-09-07',
    items: [{ productId: pA.id, quantity: 1 }] });
  check('F6 only Add-stock receipts are editable (a transfer is not)', !SD.canEdit(tr) && SD.canEdit(SD.byId(r1.id)));
  const eF7 = await rejected(SD.editReceive(Object.assign(SD.toDraft(SD.byId(r1.id)), { id: tr.id })));
  check('F7 …and the engine refuses one even if asked directly', /not found/.test(msgs(eF7)));
  /* the role comes from the signed-in account (22-users.js RBAC.role) — pose as each one */
  const realRole = ERP.RBAC.role, asRole = r => { ERP.RBAC.role = () => r; };
  asRole('SALES');
  check('F8 the Sales role may not edit a receipt', !SD.canEdit(SD.byId(r1.id)));
  const eF9 = await rejected(edit(r1.id, d => { d.items[0].quantity = 44; }));
  check('F9 …and the engine refuses it too', /not allowed/.test(msgs(eF9)));
  asRole('INVENTORY');
  check('F10 the Warehouse role (STOCK_MANAGE) may', SD.canEdit(SD.byId(r1.id)));
  asRole('ACCOUNTANT');
  check('F11 the Accountant (TRANSACTION_CORRECT) may', SD.canEdit(SD.byId(r1.id)));
  ERP.RBAC.role = realRole;

  /* ═══ G. opening stock stays opening stock ═══ */
  const pO = P[24];
  const rO = await add([[pO, 12, 1000]], { opening: true });
  await edit(rO.id, d => { d.items[0].quantity = 15; });
  const oMv = ERP.S.movements.filter(m => m.ref === rO.docNumber && m.qtyDelta > 0);
  check('G1 an opening-stock receipt is re-posted as opening stock', stock(pO) === 15 &&
    oMv.length === 2 && oMv.every(m => m.kind === 'OPENING_STOCK'));

  /* ═══ H. the movement report nets to the live figure ═══ */
  const rep = ERP.Analytics.inventory('2026-09-01', '2026-09-30');
  const rA = rep.rows.find(r => r.productId === pA.id && r.warehouseId === wh.id);
  check('H1 the stock movement report for the month closes at the live figure',
    rA && rA.closing === stock(pA), rA && rA.closing + ' vs ' + stock(pA));
  /* an Adjust OUT inside a dated report used to be added as a positive size, raising the closing figure */
  await SD.adjust({ warehouseId: wh2.id, date: '2026-09-08', reason: 'count', items: [{ productId: pD.id, quantity: 2, direction: 'OUT' }] });
  const rD = ERP.Analytics.inventory('2026-09-01', '2026-09-30').rows.find(r => r.productId === pD.id && r.warehouseId === wh2.id);
  check('H2 a dated report nets an Adjust OUT (receipt 7 in, 2 out → closes at 5, adjusted +7 −2 = 5, not 9)',
    rD && rD.closing === 5 && stock(pD, wh2.id) === 5 && rD.adjusted === 5, rD && JSON.stringify({ c: rD.closing, a: rD.adjusted }));

  /* ═══ U. the screens ═══ */
  w.go('inventory'); await sleep(250);
  const btn = $('[data-fcsdedit="' + r1.id + '"]');
  check('U1 the Stock receipts list has an Edit button on each receipt', !!btn &&
    $$('[data-fcsdedit]').length === ERP.S.stockDocs.filter(d => d.type === 'RECEIVE').length);
  check('U2 no Edit button on transfers', !$('[data-fcsdedit="' + tr.id + '"]'));
  click(btn); await sleep(300);
  check('U3 Edit opens the Add-stock screen, titled "Edit stock receipt", marked "Editing RCV-…"',
    !!$('#fcbuilder') && ERP.Builder.mode === 'receive' && ERP.Builder.editingId === r1.id &&
    /Edit stock receipt/.test($('#fcbHead').closest('.card').textContent) &&
    new RegExp('Editing ' + r1.docNumber).test($('#fcbHead').closest('.card').textContent));
  check('U4 it is filled in: warehouse, date, reason, the line and its bags',
    $('[data-fcb="warehouseId"]').value === wh.id && $('[data-fcb="reason"]').value === 'opening count' &&
    $$('[data-fcline="qty"]').length === 1 && $$('[data-fcline="qty"]')[0].value === '45',
    $$('[data-fcline="qty"]').map(i => i.value).join());
  check('U5 the save button says "Save changes"', /Save changes/.test($('[data-fcbact="save"]').textContent));
  const sU = stock(pA);                                           // 4: F6 moved one bag to the other warehouse
  typeIn($$('[data-fcline="qty"]')[0], '46'); await sleep(50);
  click($('[data-fcbact="save"]')); await sleep(600);
  for (let i = 0; i < 40 && !$('#fcviewer.on'); i++) await sleep(50);
  check('U6 Save applies it: one more bag, same document, the receipt note opens',
    stock(pA) === sU + 1 && SD.items(r1.id)[0].quantity === 46 && !!$('#fcviewer.on') && /STOCK RECEIPT NOTE/.test($('#fcviewer').textContent),
    stock(pA) + ' viewer ' + !!$('#fcviewer.on') + ' ' + ($('#fcbErr') ? $('#fcbErr').textContent : ''));
  check('U7 the receipt note has its own Edit button', !!$('#fcviewer [data-fcv="edit"]'));
  click($('#fcviewer [data-fcv="edit"]')); await sleep(300);
  check('U8 …which opens the same edit screen', !$('#fcviewer.on') && ERP.Builder.editingId === r1.id && !!$('#fcbuilder'));
  click($('[data-fcbact="cancel"]')); await sleep(150);
  check('U9 Discard goes back to Inventory without changing anything', w.CURRENT_PAGE === 'inventory' || /Stock receipts/.test(D.body.innerHTML),
    String(w.CURRENT_PAGE));
  check('U10 …and nothing moved', stock(pA) === sU + 1);
  const trDoc = ERP.DocModel.stockDoc(tr.id);
  check('U11 a transfer note has no Edit button', !trDoc.actions.edit);
  B_new: {
    click($('[data-fcnew="receive"]')); await sleep(300);
    check('U12 a brand-new Add stock still says "Add stock" / "Add to Stock"',
      ERP.Builder.editingId === null && /Add to Stock/.test($('[data-fcbact="save"]').textContent));
    click($('[data-fcbact="cancel"]')); await sleep(100);
  }

  /* ═══ Z. survives a reload ═══ */
  await sleep(400);
  const w2 = boot(store);
  for (let i = 0; i < 400 && !(w2.ERP && w2.ERP.ready); i++) await sleep(25);
  await sleep(300);
  const E2 = w2.ERP;
  const d1b = E2.StockDocs.byId(r1.id);
  check('Z1 after a reload the edited receipt, its lines and the stock are as saved',
    d1b && d1b.totalQty === 46 && E2.StockDocs.items(r1.id).length === 1 &&
    E2.Inventory.available(pA.id, wh.id) === sU + 1 && E2.Inventory.carriedCost(pA.id, wh.id) === R(3100),
    d1b && d1b.totalQty + ' / ' + E2.Inventory.available(pA.id, wh.id) + ' / ' + E2.Inventory.carriedCost(pA.id, wh.id));

  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
