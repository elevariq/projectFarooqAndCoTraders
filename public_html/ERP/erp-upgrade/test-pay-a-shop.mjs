/* Client change request (2026-09-16, clientNewReq/clientMesseges.txt, item 1):
   "amount received is here but amount paid isn't here... sometimes they pay
   payments too, so want implementation for that too." The gap: a shop could
   only ever be paid money via the Customer Return flow (tied to a product
   return, treatment=REFUND). ERP.Payments.refund() exposes that same,
   already-tested engine write (direction OUT, partyType CUSTOMER) as a
   standalone action, with a "Pay a shop" panel wired into the shop's own
   khata page and the Statement of Account screen, next to "Receive payment".

   Also covers two real bugs found while tracing this:
   - ERP.DocModel.receipt() computed the closing balance and contact info
     from payment *direction* alone, so a customer refund (direction OUT)
     looked up a *supplier* balance using the customer's id.
   - PANELS.paysup ("Pay supplier"), opened from a specific supplier's own
     profile page, never pre-selected that supplier — the base app's button
     sets WATARGET, but the panel (added by this upgrade, replacing the
     base app's original) only ever read PAY_FOR. */
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

async function main() {
  const store = {};
  const w = boot(store);
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  await (w.ERP.landedReady || Promise.resolve()).catch(() => {});
  await sleep(250);
  const ERP = w.ERP, D = w.document, M = w.Money;
  const $ = q => D.querySelector(q);
  const $$ = q => [...D.querySelectorAll(q)];
  const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const change = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };

  await ERP.Settings.save({ allowNegativeStock: true });
  const wh = w.WAREHOUSES[0], prod = w.PRODUCTS[0], sup = w.SUPPLIERS[0];
  const c1 = w.CUSTOMERS.filter(c => c.region)[0];

  check('P0 ERP.Payments.refund exists', typeof ERP.Payments.refund === 'function');

  /* ══════════════════════════════════════════════════════════════════════
     BACKEND — validation and correctness
     ══════════════════════════════════════════════════════════════════════ */
  const badAmount = await ERP.Payments.refund({ customerId: c1.id, amount: 0 }).catch(e => e);
  check('P1 a zero amount is refused', badAmount && badAmount.validation, JSON.stringify(badAmount));

  const badParty = await ERP.Payments.refund({ customerId: 'not-a-real-id', amount: 500 }).catch(e => e);
  check('P2 an unknown shop is refused', badParty && badParty.validation, JSON.stringify(badParty));

  await ERP.Invoices.save({
    customerId: c1.id, warehouseId: wh.id, invoiceDate: '2026-09-10', paidAmount: 0,
    items: [{ productId: prod.id, quantity: 1, unitPrice: 20000, discount: 0, warehouseId: wh.id }]
  });
  await ERP.Payments.receive({ customerId: c1.id, amount: 25000, method: 'Cash', date: '2026-09-11' });
  const balAfterOverpay = ERP.Ledger.customerBalance(c1.id);
  check('P3 setup: the shop is now in credit (overpaid)', balAfterOverpay < 0, String(balAfterOverpay));

  const refundRec = await ERP.Payments.refund({
    customerId: c1.id, amount: 5000, method: 'Cash', date: '2026-09-12', note: 'Cash handed back'
  });
  check('P4 the refund is posted with a receipt number', !!refundRec.receiptNumber);
  check('P5 it is recorded as an outgoing payment to a customer',
    refundRec.direction === 'OUT' && refundRec.partyType === 'CUSTOMER' && refundRec.isRefund === true);
  const balAfterRefund = ERP.Ledger.customerBalance(c1.id);
  check('P6 paying the shop moves the balance back up by that amount',
    balAfterRefund === balAfterOverpay + M.toP(5000), `${balAfterRefund} vs ${balAfterOverpay + M.toP(5000)}`);
  check('P7 it shows up in ERP.Payments.refunds()',
    ERP.Payments.refunds().some(p => p.id === refundRec.id));
  check('P8 it does NOT show up in ERP.Payments.outgoing() (that is supplier payments only)',
    !ERP.Payments.outgoing().some(p => p.id === refundRec.id));

  const auditEntry = ERP.S.audit.find(a => a.entityId === refundRec.id);
  check('P9 the audit trail calls it a refund to a shop, not a supplier payment',
    !!auditEntry && /shop/i.test(auditEntry.action) && !/supplier/i.test(auditEntry.action),
    auditEntry ? auditEntry.action : 'no audit entry found');

  /* the same figures a plain "Receive payment" would produce, reused as-is */
  const L1 = ERP.Ledger.customer(c1.id, null, null);
  check('P10 the refund appears as a row in the shop\'s own ledger',
    L1.rows.some(r => r.kind === 'REFUND' && r.id === refundRec.id));

  /* ══════════════════════════════════════════════════════════════════════
     RECEIPT / VOUCHER — the closing balance and contact-info bug
     ══════════════════════════════════════════════════════════════════════ */
  const doc = ERP.DocModel.receipt(refundRec.id);
  check('R1 the voucher is titled correctly for an outgoing payment',
    doc.title === 'PAYMENT VOUCHER' && doc.kind === 'VOUCHER');
  check('R2 it is addressed to the shop, not a supplier',
    doc.party.label === 'PAID TO' && doc.party.shop === c1.sh);
  check('R3 the closing balance is the SHOP\'s ledger balance, not a wrong supplier lookup',
    doc.totals.find(t => /Remaining balance/.test(t.label)).value === M.fmt(balAfterRefund),
    doc.totals.find(t => /Remaining balance/.test(t.label)).value + ' vs ' + M.fmt(balAfterRefund));
  check('R4 the shop\'s phone number is carried onto the voucher',
    doc.party.contact === (c1.ph || ''));
  check('R5 the amount line says "Amount paid", not "Amount received", for an outgoing payment',
    doc.totals[0].label === 'Amount paid', doc.totals[0].label);

  /* the existing "Pay supplier" voucher must still say "Amount paid" too
     (it always should have — direction OUT, previously mislabeled) */
  const supPay = await ERP.Payments.pay({ supplierId: sup.id, amount: 3000, method: 'Cash', date: '2026-09-12' });
  const supDoc = ERP.DocModel.receipt(supPay.id);
  check('R6 a supplier payment voucher also says "Amount paid"', supDoc.totals[0].label === 'Amount paid');
  check('R7 and its balance is still the supplier\'s own (unaffected by the fix)',
    supDoc.totals.find(t => /Remaining balance/.test(t.label)).value === M.fmt(ERP.Ledger.supplierBalance(sup.id)));

  /* a plain "Receive payment" receipt must be completely unaffected */
  const custPay = await ERP.Payments.receive({ customerId: c1.id, amount: 1000, method: 'Cash', date: '2026-09-13' });
  const custDoc = ERP.DocModel.receipt(custPay.id);
  check('R8 an ordinary receipt still says "Amount received"', custDoc.totals[0].label === 'Amount received');
  check('R9 and is still addressed "RECEIVED FROM" the shop', custDoc.party.label === 'RECEIVED FROM');

  /* ══════════════════════════════════════════════════════════════════════
     THE PANEL — "Pay a shop", with the same Area filter as Receive payment
     ══════════════════════════════════════════════════════════════════════ */
  ERP.setRefundFor && ERP.setRefundFor(null);
  w.openPanel('refund'); await sleep(120);
  check('U1 the "Pay a shop" panel opens with an Area selector', !!$('#fcRefundArea'));
  check('U2 and a Shop selector', !!$('#fcRefundCust'));
  check('U3 the Shop list starts with every shop', $('#fcRefundCust').options.length === w.CUSTOMERS.length);

  change($('#fcRefundArea'), c1.region); await sleep(60);
  const expectAreaCount = w.CUSTOMERS.filter(c => (c.region || '') === c1.region).length;
  check('U4 choosing an Area narrows the Shop list here too',
    $('#fcRefundCust').options.length === expectAreaCount,
    `${$('#fcRefundCust').options.length} vs ${expectAreaCount}`);

  const cb1 = $('#panel .x') || $('[data-close]') || $('#scrim'); if (cb1) click(cb1);
  await sleep(80);

  ERP.setRefundFor && ERP.setRefundFor(c1.id);
  w.openPanel('refund'); await sleep(120);
  check('U5 opening it for a specific shop pre-selects that shop', $('#fcRefundCust').value === c1.id);
  check('U6 and that shop\'s own area', $('#fcRefundArea').value === (c1.region || ''));

  /* save through the panel end-to-end */
  const amtField = $('[data-f="amt"]');
  amtField.value = '2000';
  const before = ERP.Ledger.customerBalance(c1.id);
  click($('[data-save="1"]')); await sleep(300);
  check('U7 saving through the panel actually pays the shop',
    ERP.Ledger.customerBalance(c1.id) === before + M.toP(2000),
    `${ERP.Ledger.customerBalance(c1.id)} vs ${before + M.toP(2000)}`);
  if ($('[data-fcv="close"]')) click($('[data-fcv="close"]'));
  await sleep(80);
  ERP.setRefundFor && ERP.setRefundFor(null);

  /* ══════════════════════════════════════════════════════════════════════
     ENTRY POINTS — khata page and Statement of Account
     ══════════════════════════════════════════════════════════════════════ */
  w.go('khata', c1.id); await sleep(150);
  check('E1 "Pay this shop" is offered on the shop\'s own account page', !!$('[data-khrefund]'));
  click($('[data-khrefund]')); await sleep(150);
  check('E2 it opens the refund panel pre-filled to this shop',
    $('#panel.on') && $('#fcRefundCust') && $('#fcRefundCust').value === c1.id);
  const cb2 = $('#panel .x') || $('[data-close]') || $('#scrim'); if (cb2) click(cb2);
  await sleep(80);
  ERP.setRefundFor && ERP.setRefundFor(null);

  w.go('customerProfile', c1.id); await sleep(150);
  check('E3 "Pay this shop" is also offered from the customer profile page', !!$('[data-khrefund]'));

  w.go('soa'); await sleep(150);
  change($('[data-soaf="partyId"]'), c1.id); await sleep(100);
  check('E4 the Statement of Account screen offers both directions for a customer',
    !!$('[data-soapay]') && !!$('[data-soarefund]'));
  click($('[data-soarefund]')); await sleep(150);
  check('E5 it opens the refund panel pre-filled to the shop being viewed',
    $('#panel.on') && $('#fcRefundCust') && $('#fcRefundCust').value === c1.id);
  const cb3 = $('#panel .x') || $('[data-close]') || $('#scrim'); if (cb3) click(cb3);
  await sleep(80);
  ERP.setRefundFor && ERP.setRefundFor(null); ERP.setPayFor && ERP.setPayFor(null);

  change($('[data-soaf="type"]'), 'SUPPLIER'); await sleep(100);
  change($('[data-soaf="partyId"]'), sup.id); await sleep(100);
  check('E6 for a supplier it offers "Pay this supplier" instead',
    !!$('[data-soapaysup]') && !$('[data-soapay]') && !$('[data-soarefund]'));
  click($('[data-soapaysup]')); await sleep(150);
  check('E7 it opens Pay supplier pre-filled to the supplier being viewed',
    $('#panel.on') && $('[data-f="sup"]') && $('[data-f="sup"]').value === sup.id);
  const cb4 = $('#panel .x') || $('[data-close]') || $('#scrim'); if (cb4) click(cb4);
  await sleep(80);
  ERP.setPayFor && ERP.setPayFor(null);

  /* ══════════════════════════════════════════════════════════════════════
     THE WATARGET / PAY_FOR BUG — "Pay supplier" from a supplier's own page
     ══════════════════════════════════════════════════════════════════════ */
  /* WATARGET is a `let` binding lexically scoped to the base app's own
     script, not a window property — setting w.WATARGET from outside the
     page (as a naive test would) only creates an unrelated shadow property
     and proves nothing. The only faithful way to test the real bug is to
     trigger the actual base-app click path that sets it. */
  const sup2 = w.SUPPLIERS[1] || w.SUPPLIERS[0];
  ERP.setPayFor && ERP.setPayFor(null);
  w.go('supplierProfile', sup2.id); await sleep(150);
  const paysupBtn = $('[data-paysup="' + sup2.id + '"]');
  check('W0 the supplier profile page offers a "Pay supplier" button', !!paysupBtn);
  click(paysupBtn); await sleep(150);
  check('W1 opening Pay supplier from a supplier\'s own page pre-selects that supplier',
    $('[data-f="sup"]') && $('[data-f="sup"]').value === sup2.id,
    $('[data-f="sup"]') ? $('[data-f="sup"]').value + ' vs ' + sup2.id : 'panel did not open');
  const cb5 = $('#panel .x') || $('[data-close]') || $('#scrim'); if (cb5) click(cb5);
  await sleep(80);

  /* PAY_FOR, once explicitly set, still takes priority over whatever the
     base app's own click path left in WATARGET */
  ERP.setPayFor && ERP.setPayFor(sup.id);
  w.openPanel('paysup'); await sleep(120);
  check('W2 PAY_FOR still takes priority over a stale WATARGET when both are set',
    $('[data-f="sup"]').value === sup.id, $('[data-f="sup"]').value + ' vs ' + sup.id);
  const cb6 = $('#panel .x') || $('[data-close]') || $('#scrim'); if (cb6) click(cb6);
  ERP.setPayFor && ERP.setPayFor(null);

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  w.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
