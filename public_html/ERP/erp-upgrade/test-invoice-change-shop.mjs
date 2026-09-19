/* Change the shop on an invoice (2026-09-19).
   Business need: an invoice was made out to the wrong shop and must move to the
   right one — the shop and nothing else. A shop's account is derived from its
   invoices, so this is an account move, not a label fix: the invoice total and
   any money taken with it leave one shop's khata and land on the other's, while
   lines, amounts, number, date and stock stay exactly as they are.

   Before this, the edit screen's Shop picker only rewrote `customerId` — the
   receipts stayed on the old shop (B got the debit, A kept the credit), and the
   edit route re-validates stock against bags the invoice itself already took, so
   it fails once stock is zero (R1/R2 below prove that half).

   Covers: Invoices.reassignCheck / changeCustomer (ledger, snapshots, receipts,
   dispatch notes, print-sheet overrides, audit, atomic refusal cases,
   persistence across a restart), the Invoices.save guard, and the UI: the
   "Change shop" panel, the list/viewer buttons, the role gate, and the locked
   Shop picker in the edit screen. */
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
  const change = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };
  const closePanel = async () => { const c = $('[data-close]'); if (c) click(c); await sleep(80); };

  await ERP.Settings.save({ allowNegativeStock: true });
  const wh = w.WAREHOUSES[0], prod = w.PRODUCTS[0], sup = w.SUPPLIERS[0];
  const withRegion = w.CUSTOMERS.filter(c => c.region);
  const A = withRegion[0];
  const C = withRegion.find(c => c.id !== A.id && c.region === A.region);   // same area as A
  const B = withRegion.find(c => c.region !== A.region);                    // different area
  const bal = id => ERP.Ledger.customerBalance(id);
  const line = (q, rate) => ({ productId: prod.id, quantity: q, unitPrice: rate, discount: 0, warehouseId: wh.id });
  const mk = (cust, date, items, extra) => ERP.Invoices.save(Object.assign(
    { customerId: cust.id, warehouseId: wh.id, invoiceDate: date, paidAmount: 0, items: items || [line(1, 20000)] }, extra || {}));
  const rejected = async p => { try { await p; return null; } catch (e) { return e; } };

  check('S0 the data has shops A, B (different area) and C (same area as A)', !!(A && B && C));
  check('S1 the API exists', typeof ERP.Invoices.changeCustomer === 'function' &&
    typeof ERP.Invoices.reassignCheck === 'function');

  /* ══════════════════════════════════════════════════════════════════════
     A. UNPAID INVOICE — the plain case
     ══════════════════════════════════════════════════════════════════════ */
  /* give the two shops different histories, so "previous balance" has to be
     recomputed for the new shop rather than carried over from the old one */
  await mk(A, '2026-09-02', [line(1, 3000)]);       // A owed 3,000 before the sale
  await mk(B, '2026-09-01', [line(1, 7777)]);       // B owed 7,777 before the sale…
  await mk(B, '2026-09-20', [line(1, 5555)]);       // …and bought again later: must NOT count as "previous"
  const inv1 = await mk(A, '2026-09-05');
  const stock1 = ERP.Inventory.available(prod.id, wh.id);
  const moves1 = ERP.S.movements.length;
  const balA_before = bal(A.id) - inv1.grandTotal;          // A as it stood before this invoice
  const balB_before = bal(B.id);
  const prevExpected = ERP.Ledger.customer(B.id, null, '2026-09-04').closing;
  const items1 = ERP.Invoices.items(inv1.id).map(i => i.id + ':' + i.quantity + ':' + i.lineTotal).join('|');

  const moved1 = await ERP.Invoices.changeCustomer(inv1.id, B.id, { reason: 'picked the wrong shop' });
  const now1 = ERP.Invoices.byId(inv1.id);
  check('A1 the invoice now belongs to shop B', now1.customerId === B.id && moved1.customerId === B.id);
  check('A2 the shop snapshots are B\'s — name, code, mobile, address, region',
    now1.shopNameSnapshot === B.sh && now1.mobileSnapshot === (B.ph || '') && now1.addressSnapshot === (B.addr || '') &&
    now1.regionId === B.region && (now1.customerNameSnapshot === (B.ow || B.sh)),
    JSON.stringify([now1.shopNameSnapshot, now1.regionId]));
  check('A3 the snapshots match what a brand-new invoice for B would carry',
    JSON.stringify(ERP.Invoices.customerFields(B)) ===
    JSON.stringify(Object.fromEntries(Object.keys(ERP.Invoices.customerFields(B)).map(k => [k, now1[k]]))));
  check('A4 A\'s account is back to before the invoice', bal(A.id) === balA_before, bal(A.id) + ' vs ' + balA_before);
  check('A5 B\'s account carries the invoice total', bal(B.id) === balB_before + inv1.grandTotal,
    bal(B.id) + ' vs ' + (balB_before + inv1.grandTotal));
  check('A6 the number, date, total, status and lines are untouched',
    now1.invoiceNumber === inv1.invoiceNumber && now1.invoiceDate === '2026-09-05' &&
    now1.grandTotal === inv1.grandTotal && now1.status === inv1.status &&
    ERP.Invoices.items(inv1.id).map(i => i.id + ':' + i.quantity + ':' + i.lineTotal).join('|') === items1);
  check('A7 no stock moved and no new stock movement was written',
    ERP.Inventory.available(prod.id, wh.id) === stock1 && ERP.S.movements.length === moves1);
  check('A8 previous balance is B\'s balance just before the invoice date — not A\'s, and not counting B\'s later purchase',
    now1.previousBalance === prevExpected && now1.previousBalance !== inv1.previousBalance &&
    prevExpected === balB_before - M.toP(5555),
    now1.previousBalance + ' vs ' + prevExpected + ' (A had ' + inv1.previousBalance + ', B now ' + balB_before + ')');
  check('A9 the audit log records who/what/why',
    (() => { const a = ERP.S.audit[0]; return a && a.action === 'Invoice moved to another shop' && a.ref === inv1.invoiceNumber &&
      a.oldValues.shop === A.sh && a.newValues.shop === B.sh && a.reason === 'picked the wrong shop'; })());
  check('A10 the invoice appears on B\'s ledger and not on A\'s',
    ERP.Ledger.customer(B.id).rows.some(r => r.ref === inv1.invoiceNumber) &&
    !ERP.Ledger.customer(A.id).rows.some(r => r.ref === inv1.invoiceNumber));
  check('A11 the printed invoice says B', ERP.DocModel.invoice(inv1.id).party.shop === B.sh &&
    ERP.DocModel.invoice(inv1.id).party.id === B.id);

  /* an ordinary edit afterwards still works, on the new shop */
  const edited1 = await ERP.Invoices.save(Object.assign(ERP.Invoices.toDraft(now1),
    { id: inv1.id, revision: now1.revision, items: [line(2, 20000)] }));
  check('A12 a normal edit of the moved invoice keeps it on B and re-prices B\'s account',
    edited1.customerId === B.id && edited1.grandTotal === 2 * inv1.grandTotal &&
    bal(B.id) === balB_before + 2 * inv1.grandTotal && bal(A.id) === balA_before);

  /* ══════════════════════════════════════════════════════════════════════
     B. PAID WITH THE INVOICE — the receipt follows
     ══════════════════════════════════════════════════════════════════════ */
  await mk(C, '2026-09-01', [line(1, 1111)]);       // C has a history of its own, unlike A's
  const inv2 = await mk(A, '2026-09-06', [line(1, 20000)], { paidAmount: 5000 });
  const pay2 = ERP.Payments.forInvoice(inv2.id);
  const balA2 = bal(A.id), balC2 = bal(C.id);
  const oldBefore2 = pay2[0].balanceBefore;                    // worked out against A
  const expBefore2 = ERP.Ledger.customer(C.id, null, '2026-09-05').closing + inv2.grandTotal;   // what it will be for C
  check('B0 the invoice took a 5,000 receipt with it', pay2.length === 1 && pay2[0].amount === M.toP(5000));
  await ERP.Invoices.changeCustomer(inv2.id, C.id);
  const p2 = ERP.Payments.byId(pay2[0].id);
  check('B0b the receipt\'s stored balances are recomputed for C, not left as A\'s',
    p2.balanceBefore === expBefore2 && p2.balanceAfter === expBefore2 - p2.amount && p2.balanceBefore !== oldBefore2,
    p2.balanceBefore + ' vs ' + expBefore2 + ' (A\'s was ' + oldBefore2 + ')');
  check('B0c the printed receipt shows that "Previous balance" beside C\'s name',
    (() => { const m = ERP.DocModel.receipt(p2.id);
      return m.party.shop === C.sh && m.totals.some(t => t.label === 'Previous balance' && t.value === M.fmt(expBefore2)); })());
  check('B1 the receipt moved to C, with C\'s name on it', p2.partyId === C.id && p2.partyNameSnapshot === C.sh);
  check('B2 A\'s account lost the invoice AND the receipt (net 15,000 off)',
    bal(A.id) === balA2 - (inv2.grandTotal - M.toP(5000)), bal(A.id) + ' vs ' + (balA2 - (inv2.grandTotal - M.toP(5000))));
  check('B3 C\'s account gained the invoice AND the receipt (net 15,000 on)',
    bal(C.id) === balC2 + (inv2.grandTotal - M.toP(5000)));
  check('B4 the invoice is still 5,000 paid / 15,000 outstanding, allocation intact',
    ERP.Invoices.paidFor(inv2.id) === M.toP(5000) &&
    ERP.Invoices.outstanding(ERP.Invoices.byId(inv2.id)) === inv2.grandTotal - M.toP(5000));
  check('B5 the receipt shows on C\'s ledger, not A\'s',
    ERP.Ledger.customer(C.id).rows.some(r => r.ref === pay2[0].receiptNumber) &&
    !ERP.Ledger.customer(A.id).rows.some(r => r.ref === pay2[0].receiptNumber));
  check('B6 the audit entry lists the receipt that moved',
    ERP.S.audit[0].newValues.receiptsMoved.indexOf(pay2[0].receiptNumber) > -1);

  /* ══════════════════════════════════════════════════════════════════════
     C. REFUSALS — money that cannot be split honestly; nothing is written
     ══════════════════════════════════════════════════════════════════════ */
  const snap = () => JSON.stringify([bal(A.id), bal(B.id), bal(C.id)]);
  const i3a = await mk(A, '2026-09-01', [line(1, 10000)]);
  const i3b = await mk(A, '2026-09-02', [line(1, 10000)]);
  const shared = await ERP.Payments.receive({ customerId: A.id, amount: 15000, method: 'Cash', date: '2026-09-03',
    allocations: [{ invoiceId: i3a.id, amount: 10000 }, { invoiceId: i3b.id, amount: 5000 }] });
  let s0 = snap();
  const e3 = await rejected(ERP.Invoices.changeCustomer(i3b.id, B.id));
  check('C1 a receipt shared with another invoice blocks the move, naming the receipt',
    e3 && e3.validation && e3.validation.some(m => m.indexOf(shared.receiptNumber) > -1), JSON.stringify(e3));
  check('C2 …and nothing changed', ERP.Invoices.byId(i3b.id).customerId === A.id && snap() === s0);

  const i3c = await mk(A, '2026-09-04', [line(1, 10000)]);
  const onAcct = await ERP.Payments.receive({ customerId: A.id, amount: 15000, method: 'Cash', date: '2026-09-04',
    allocations: [{ invoiceId: i3c.id, amount: 10000 }] });
  s0 = snap();
  const e3c = await rejected(ERP.Invoices.changeCustomer(i3c.id, B.id));
  check('C3 a receipt partly left on account blocks the move',
    e3c && e3c.validation && e3c.validation.some(m => m.indexOf(onAcct.receiptNumber) > -1));
  check('C4 …and nothing changed', ERP.Invoices.byId(i3c.id).customerId === A.id && snap() === s0);

  const i3d = await mk(A, '2026-09-05', [line(2, 20000)]);
  const ret = await ERP.Returns.fromCustomer({ invoiceId: i3d.id, treatment: 'ADJUST_OUTSTANDING_BALANCE',
    items: [{ invoiceItemId: ERP.Invoices.items(i3d.id)[0].id, quantity: 1 }], warehouseId: wh.id });
  s0 = snap();
  const e3d = await rejected(ERP.Invoices.changeCustomer(i3d.id, B.id));
  check('C5 a posted customer return blocks the move, naming the return',
    e3d && e3d.validation && e3d.validation.some(m => m.indexOf(ret.returnNumber) > -1));
  check('C6 …and nothing changed', ERP.Invoices.byId(i3d.id).customerId === A.id && snap() === s0);

  /* a reversed receipt is already out of the books — it must not block */
  const i3e = await mk(A, '2026-09-06', [line(1, 10000)], { paidAmount: 4000 });
  const payE = ERP.Payments.forInvoice(i3e.id)[0];
  await ERP.Payments.reverse(payE.id, 'entered by mistake');
  const okE = await rejected(ERP.Invoices.changeCustomer(i3e.id, B.id));
  check('C7 a reversed receipt does not block the move, and stays on A untouched',
    okE === null && ERP.Invoices.byId(i3e.id).customerId === B.id && ERP.Payments.byId(payE.id).partyId === A.id,
    JSON.stringify(okE));

  const cancelled = await mk(A, '2026-09-07');
  await ERP.Invoices.cancel(cancelled.id, 'test');
  const eC = await rejected(ERP.Invoices.changeCustomer(cancelled.id, B.id));
  check('C8 a cancelled invoice cannot be moved', eC && eC.validation && /cancelled/i.test(eC.validation[0]));
  check('C9 an unknown invoice is refused', (await rejected(ERP.Invoices.changeCustomer('nope', B.id))).validation[0] === 'Invoice not found.');
  check('C10 an unknown shop is refused', /Choose the shop/.test((await rejected(ERP.Invoices.changeCustomer(i3a.id, 'nope'))).validation[0]));
  check('C11 no shop is refused', /Choose the shop/.test((await rejected(ERP.Invoices.changeCustomer(i3a.id, ''))).validation[0]));
  check('C12 the same shop is refused (so a double-click cannot move it twice)',
    /already the shop/.test((await rejected(ERP.Invoices.changeCustomer(inv1.id, B.id))).validation[0]));
  const chk = ERP.Invoices.reassignCheck(i3b.id);
  check('C13 reassignCheck reports blockers without a target shop, and writes nothing',
    chk.errs.length === 1 && chk.payments.length === 0 && ERP.Invoices.byId(i3b.id).customerId === A.id);

  /* ══════════════════════════════════════════════════════════════════════
     D. THE OTHER THINGS THAT CARRY A COPY OF THE SHOP
     ══════════════════════════════════════════════════════════════════════ */
  /* a draft has no account entry and can be moved too */
  const draft = await ERP.Invoices.save({ customerId: A.id, warehouseId: wh.id, invoiceDate: '2026-09-08',
    items: [line(1, 20000)] }, { draft: true });
  const dm = await ERP.Invoices.changeCustomer(draft.id, B.id);
  check('D1 a draft can be moved and stays a draft', dm.customerId === B.id && dm.status === 'DRAFT');

  /* hand-typed shop details on the printed sheet must not mask the new shop */
  const inv6 = await mk(A, '2026-09-08');
  const ed = ERP.Edits.ensure(inv6.id);
  ed.fields.shop = 'Hand Typed Shop'; ed.fields.owner = 'Hand Typed Owner'; ed.fields.address = 'Old street';
  ed.fields.previousBalance = '12345'; ed.fields.title = 'TAX INVOICE';
  await ERP.Edits.save(inv6.id, { revision: true });
  check('D2 (setup) the printed sheet shows the hand-typed name', ERP.buildSheet(inv6.id).shop === 'Hand Typed Shop');
  await ERP.Invoices.changeCustomer(inv6.id, B.id);
  const ed2 = ERP.Edits.get(inv6.id);
  check('D3 the stale shop/owner/address/previous-balance overrides are dropped',
    ed2.fields.shop === undefined && ed2.fields.owner === undefined && ed2.fields.address === undefined &&
    ed2.fields.previousBalance === undefined);
  check('D4 unrelated overrides (the title) survive', ed2.fields.title === 'TAX INVOICE');
  check('D5 the earlier wording is kept in the sheet\'s history',
    ed2.revisions.length >= 1 && ed2.revisions[0].note === 'Before the shop was changed' &&
    ed2.revisions[0].state.fields.shop === 'Hand Typed Shop');
  check('D6 the sheet and the printed document now say B', ERP.buildSheet(inv6.id).shop === B.sh &&
    ERP.DocModel.invoice(inv6.id).party.shop === B.sh);

  /* dispatch notes written against the invoice follow; unrelated ones do not */
  const inv7 = await mk(A, '2026-09-09');
  const dsp = await ERP.StockDocs.save({ type: 'DISPATCH', customerId: A.id, warehouseId: wh.id, invoiceId: inv7.id,
    date: '2026-09-09', items: [{ productId: prod.id, quantity: 1, unitPrice: 1 }] });
  const dspOther = await ERP.StockDocs.save({ type: 'DISPATCH', customerId: A.id, warehouseId: wh.id, invoiceId: null,
    date: '2026-09-09', items: [{ productId: prod.id, quantity: 1, unitPrice: 1 }] });
  await ERP.Invoices.changeCustomer(inv7.id, B.id);
  const d1 = ERP.StockDocs.byId(dsp.id), d2 = ERP.StockDocs.byId(dspOther.id);
  check('D7 the dispatch note against the invoice moved to B', d1.customerId === B.id && d1.customerSnapshot === B.sh);
  check('D8 an unrelated dispatch note for A was left alone', d2.customerId === A.id && d2.customerSnapshot === A.sh);
  check('D9 the audit entry lists the dispatch note',
    ERP.S.audit[0].newValues.dispatchNotesMoved.indexOf(d1.docNumber) > -1);

  /* two receipts on one invoice: each gets the balance it would have had, in date order */
  const inv8 = await mk(A, '2026-09-13', [line(1, 10000)]);
  await ERP.Payments.receive({ customerId: A.id, amount: 4000, method: 'Cash', date: '2026-09-14',
    allocations: [{ invoiceId: inv8.id, amount: 4000 }] });
  await ERP.Payments.receive({ customerId: A.id, amount: 3000, method: 'Cash', date: '2026-09-15',
    allocations: [{ invoiceId: inv8.id, amount: 3000 }] });
  const b1 = ERP.Ledger.customer(B.id, null, '2026-09-13').closing + inv8.grandTotal;
  const b2 = ERP.Ledger.customer(B.id, null, '2026-09-14').closing + inv8.grandTotal - M.toP(4000);
  await ERP.Invoices.changeCustomer(inv8.id, B.id);
  const [q1, q2] = ERP.Payments.forInvoice(inv8.id).map(x => ERP.Payments.byId(x.id))
    .sort((x, y) => x.paymentDate < y.paymentDate ? -1 : 1);
  check('D10 two receipts on one invoice both move, each with its own recomputed balance, in date order',
    q1.partyId === B.id && q2.partyId === B.id && q1.balanceBefore === b1 && q2.balanceBefore === b2,
    [q1.balanceBefore, b1, q2.balanceBefore, b2].join(' / '));

  /* a malformed invoice date must not make the move throw */
  const inv9 = await mk(A, '2026-09-12');
  ERP.Invoices.byId(inv9.id).invoiceDate = 'not-a-date';
  const balBnow = bal(B.id);
  let threw = null, m9 = null;
  try { m9 = await ERP.Invoices.changeCustomer(inv9.id, B.id); } catch (e) { threw = e; }
  check('D11 an unreadable invoice date does not break the move — it falls back to B\'s current balance',
    !threw && m9 && m9.customerId === B.id && m9.previousBalance === balBnow, String(threw && (threw.message || JSON.stringify(threw))));

  /* the integrity page flags a receipt sitting on a different shop from its invoice —
     what the old edit route could leave behind. Simulated in memory only. */
  check('D12 after all these moves no receipt disagrees with its invoice', ERP.Health.allocationCheck().ok);
  const invMem = ERP.Invoices.byId(inv2.id);
  invMem.customerId = A.id;                                   // pretend the old edit route moved it alone
  const bad = ERP.Health.allocationCheck();
  check('D13 the integrity check catches a receipt left behind on the other shop',
    !bad.ok && bad.mismatches.length === 1 && bad.mismatches[0].receipt === pay2[0].receiptNumber);
  check('D14 …and reports it as a warning on the health page',
    ERP.Health.report().warnings.some(x => /different shop/.test(x) && x.indexOf(pay2[0].receiptNumber) > -1));
  invMem.customerId = C.id;                                   // put it back
  check('D15 (restored) the check is clean again', ERP.Health.allocationCheck().ok);

  /* ══════════════════════════════════════════════════════════════════════
     E. WHY THE EDIT SCREEN WAS NOT ENOUGH
     ══════════════════════════════════════════════════════════════════════ */
  await ERP.Settings.save({ allowNegativeStock: false });
  const p9 = w.PRODUCTS[7];
  await ERP.Purchases.save({ supplierId: sup.id, warehouseId: wh.id, purchaseDate: '2026-09-01',
    items: [{ productId: p9.id, quantity: 3, unitPrice: 1000 }] });
  const invR = await ERP.Invoices.save({ customerId: A.id, warehouseId: wh.id, invoiceDate: '2026-09-02', paidAmount: 0,
    items: [{ productId: p9.id, quantity: 3, unitPrice: 1200, warehouseId: wh.id }] });
  check('R1 that sale took the last bags — stock is now zero', ERP.Inventory.available(p9.id, wh.id) === 0);
  check('R2 re-validating the invoice as an edit would is blocked on stock',
    ERP.Validate.invoice(ERP.Invoices.toDraft(invR)).some(e => /Only 0 bags/.test(e)));
  const rm = await rejected(ERP.Invoices.changeCustomer(invR.id, B.id));
  check('R3 Change shop is not blocked — it never touches stock', rm === null &&
    ERP.Invoices.byId(invR.id).customerId === B.id && ERP.Inventory.available(p9.id, wh.id) === 0);
  await ERP.Settings.save({ allowNegativeStock: true });

  /* the edit route can no longer move a posted invoice by itself */
  const posted = ERP.Invoices.byId(inv2.id);
  const s1 = snap();
  const eSave = await rejected(ERP.Invoices.save(Object.assign(ERP.Invoices.toDraft(posted),
    { id: posted.id, revision: posted.revision, customerId: A.id })));
  check('G1 saving a posted invoice with a different shop is refused, pointing at Change shop',
    eSave && eSave.validation && eSave.validation.some(m => /Change shop/.test(m)), JSON.stringify(eSave));
  check('G2 …and nothing changed', ERP.Invoices.byId(inv2.id).customerId === C.id && snap() === s1);
  /* reuses the draft from D1 rather than creating another: the invoices store's
     unique invoiceNumber index means a second draft (empty number) cannot be
     saved at all — a separate, pre-existing limitation this feature leaves alone */
  const dCur = ERP.Invoices.byId(draft.id);
  const dr3 = await rejected(ERP.Invoices.save({ id: dCur.id, revision: dCur.revision, clientOpId: dCur.clientOpId,
    customerId: A.id, warehouseId: wh.id, invoiceDate: '2026-09-08', items: [line(1, 20000)] }, { draft: true }));
  check('G3 a DRAFT can still change its shop through an ordinary save (nothing is posted)',
    dr3 === null && ERP.Invoices.byId(draft.id).customerId === A.id, JSON.stringify(dr3));

  /* ══════════════════════════════════════════════════════════════════════
     F. PERSISTENCE — everything survives a restart
     ══════════════════════════════════════════════════════════════════════ */
  const expect = {
    inv1: ERP.Invoices.byId(inv1.id).customerId, inv2: ERP.Invoices.byId(inv2.id).customerId,
    pay2: ERP.Payments.byId(pay2[0].id).partyId, dsp: ERP.StockDocs.byId(dsp.id).customerId,
    balA: bal(A.id), balB: bal(B.id), balC: bal(C.id)
  };
  await ERP.flush(); await sleep(300);
  w.close();
  const w2 = boot(store); await ready(w2);
  const E2 = w2.ERP;
  check('F1 the moved invoices are on their new shops after a restart',
    E2.Invoices.byId(inv1.id).customerId === expect.inv1 && E2.Invoices.byId(inv2.id).customerId === expect.inv2);
  check('F2 the moved receipt and dispatch note persisted',
    E2.Payments.byId(pay2[0].id).partyId === expect.pay2 && E2.StockDocs.byId(dsp.id).customerId === expect.dsp);
  check('F3 all three shops\' balances are identical after the restart',
    E2.Ledger.customerBalance(A.id) === expect.balA && E2.Ledger.customerBalance(B.id) === expect.balB &&
    E2.Ledger.customerBalance(C.id) === expect.balC);
  check('F4 the audit entry survived', E2.S.audit.some(a => a.action === 'Invoice moved to another shop' &&
    a.ref === inv1.invoiceNumber));
  const ed3 = E2.Edits.get(inv6.id);
  check('F5 the cleaned print-sheet record persisted', !ed3 || (ed3.fields.shop === undefined && ed3.fields.title === 'TAX INVOICE'));
  w2.close();

  /* ══════════════════════════════════════════════════════════════════════
     UI — a fresh page, so the panel/viewer state is clean
     ══════════════════════════════════════════════════════════════════════ */
  const w3 = boot(store); await ready(w3);
  const E3 = w3.ERP, D3 = w3.document;
  const $3 = q => D3.querySelector(q), $$3 = q => [...D3.querySelectorAll(q)];
  const click3 = el => el && el.dispatchEvent(new w3.Event('click', { bubbles: true }));
  const change3 = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w3.Event('change', { bubbles: true })); } };
  const close3 = async () => { const c = D3.querySelector('[data-close]'); if (c) click3(c); await sleep(80); };
  const bal3 = id => E3.Ledger.customerBalance(id);
  await E3.Settings.save({ allowNegativeStock: true });
  const wh3 = w3.WAREHOUSES[0], prod3 = w3.PRODUCTS[0];
  const cust3 = id => w3.custBy(id);

  const u1 = await E3.Invoices.save({ customerId: A.id, warehouseId: wh3.id, invoiceDate: '2026-09-11', paidAmount: 0,
    items: [{ productId: prod3.id, quantity: 1, unitPrice: 20000, discount: 0, warehouseId: wh3.id }] });
  const uDraft = E3.Invoices.byId(draft.id);                 // the draft persisted from the first half
  check('U0 (setup) the draft survived the restart', !!uDraft && uDraft.status === 'DRAFT');
  const uCancelled = await E3.Invoices.save({ customerId: A.id, warehouseId: wh3.id, invoiceDate: '2026-09-11', paidAmount: 0,
    items: [{ productId: prod3.id, quantity: 1, unitPrice: 20000, discount: 0, warehouseId: wh3.id }] });
  await E3.Invoices.cancel(uCancelled.id, 'test');
  const btnFor = id => $3('[data-fcinv="changeshop"][data-id="' + id + '"]');

  w3.go('invoices'); await sleep(200);
  check('U1 a confirmed invoice row offers "Change shop"', !!btnFor(u1.id));
  check('U2 a draft and a cancelled invoice do not', !btnFor(uDraft.id) && !btnFor(uCancelled.id));

  click3(btnFor(u1.id)); await sleep(200);
  const shopSel = $3('#fcCsShop'), areaSel = $3('#fcCsArea');
  check('U3 the Change shop panel opens with an Area and a Shop picker', !!shopSel && !!areaSel);
  check('U4 the Shop picker starts on a blank choice — never a silent default',
    shopSel && shopSel.value === '' && /choose/i.test(shopSel.options[0].textContent));
  check('U5 the current shop is not offered as a target',
    shopSel && ![...shopSel.options].some(o => o.value === A.id));
  check('U6 the panel says what the invoice is and what it does to the balance',
    $3('#panel').textContent.indexOf(u1.invoiceNumber) > -1 && /balance/i.test($3('#panel').textContent));

  change3(areaSel, C.region); await sleep(80);
  const inArea = [...$3('#fcCsShop').options].filter(o => o.value);
  check('U7 picking an Area narrows the Shop list to that area (minus the current shop)',
    inArea.length > 0 && inArea.every(o => (cust3(o.value).region || '') === C.region) && !inArea.some(o => o.value === A.id),
    inArea.length + ' options');
  check('U8 …and the shop picker is back on the blank choice', $3('#fcCsShop').value === '');

  change3($3('#fcCsShop'), C.id); await sleep(80);
  const expectAfter = bal3(C.id) + u1.grandTotal;
  check('U9 choosing a shop previews its balance before → after',
    $3('#fcCsBal').textContent.indexOf(C.sh) > -1 && $3('#fcCsBal').textContent.indexOf(w3.Money.fmt(expectAfter)) > -1,
    $3('#fcCsBal').textContent);

  /* saving with no shop chosen is refused in the panel, nothing written */
  change3($3('#fcCsShop'), ''); await sleep(30);
  click3($3('[data-save="1"]')); await sleep(150);
  check('U10 saving without choosing a shop shows an error and keeps the panel open',
    /Choose the shop/.test(($3('#panelErr') || {}).textContent || '') && E3.Invoices.byId(u1.id).customerId === A.id);

  change3($3('#fcCsShop'), C.id);
  $3('[data-f="reason"]').value = 'wrong shop picked at billing';
  const balAbefore = bal3(A.id);
  click3($3('[data-save="1"]')); await sleep(400);
  check('U11 saving moves the invoice to the chosen shop, with the reason audited',
    E3.Invoices.byId(u1.id).customerId === C.id && E3.S.audit[0].reason === 'wrong shop picked at billing');
  check('U12 the accounts moved', bal3(A.id) === balAbefore - u1.grandTotal && bal3(C.id) === expectAfter);
  check('U13 the list repainted with the new shop',
    $3('[data-fcinv="changeshop"][data-id="' + u1.id + '"]').closest('tr').textContent.indexOf(C.sh) > -1);

  /* a blocked invoice explains why instead of offering a picker */
  E3.actions.changeInvoiceShop(i3b.id); await sleep(200);
  check('U14 a blocked invoice\'s panel explains why and names the receipt, with no picker',
    !$3('#fcCsShop') && /cannot be moved/i.test($3('#panel').textContent) &&
    $3('#panel').textContent.indexOf(shared.receiptNumber) > -1);
  click3($3('[data-save="1"]')); await sleep(120);
  check('U15 pressing the button anyway returns the same reason and changes nothing',
    $3('#panelErr').textContent.indexOf(shared.receiptNumber) > -1 && E3.Invoices.byId(i3b.id).customerId === A.id);
  await close3();

  /* the document viewer */
  E3.Viewer.open(E3.DocModel.invoice(u1.id)); await sleep(100);
  check('V1 the invoice viewer has a "Change shop" button', !!$3('[data-fcv="changeshop"]'));
  click3($3('[data-fcv="changeshop"]')); await sleep(200);
  check('V2 it closes the viewer and opens the same panel', !$3('#fcviewer.on') && !!$3('#fcCsShop'));
  await close3();
  E3.Viewer.open(E3.DocModel.invoice(uDraft.id)); await sleep(80);
  check('V3 a draft\'s viewer does not offer it', !$3('[data-fcv="changeshop"]'));
  E3.Viewer.close();
  E3.Viewer.open(E3.DocModel.invoice(uCancelled.id)); await sleep(80);
  check('V4 a cancelled invoice\'s viewer does not offer it', !$3('[data-fcv="changeshop"]'));
  E3.Viewer.close();

  /* the edit screen: the shop is fixed on a posted invoice, free on a draft */
  E3.actions.editInvoice(u1.id); await sleep(250);
  const sel = $3('[data-fcb="customerId"]'), reg = $3('[data-fcb="regionFilter"]');
  check('W1 editing a posted invoice: the Shop and Region pickers are locked',
    sel && reg && sel.disabled && reg.disabled);
  check('W2 …with a hint pointing at Change shop', /Change shop/.test($3('#main, main, body').textContent));
  check('W3 …and the locked picker still shows the invoice\'s own shop', sel && sel.value === C.id);
  w3.go('invoices'); await sleep(120);
  E3.actions.editInvoice(uDraft.id); await sleep(250);
  check('W4 editing a draft: the Shop picker stays editable',
    $3('[data-fcb="customerId"]') && !$3('[data-fcb="customerId"]').disabled);
  w3.go('invoices'); await sleep(120);

  /* the role gate: moving a sale between two accounts is a correction */
  await E3.Settings.save({ currentRole: 'SALES' }); w3.go('invoices'); await sleep(200);
  check('X1 a Sales-role user sees no Change shop button', !btnFor(u1.id));
  E3.Viewer.open(E3.DocModel.invoice(u1.id)); await sleep(80);
  check('X2 …nor in the viewer', !$3('[data-fcv="changeshop"]'));
  E3.Viewer.close();
  E3.actions.changeInvoiceShop(u1.id); await sleep(150);
  check('X3 …and opening the panel directly is refused with the role named',
    !$3('#fcCsShop') && /role/i.test($3('#panel').textContent));
  await close3();
  await E3.Settings.save({ currentRole: 'ACCOUNTANT' }); w3.go('invoices'); await sleep(200);
  check('X4 an Accountant (holds TRANSACTION_CORRECT) does see it', !!btnFor(u1.id));
  await E3.Settings.save({ currentRole: 'OWNER' });

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  w3.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
