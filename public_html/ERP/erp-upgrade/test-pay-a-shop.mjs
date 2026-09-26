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
  check('U3 the Shop list starts with every shop, after a blank "Choose a shop" line',
    $('#fcRefundCust').options.length === w.CUSTOMERS.length + 1 && $('#fcRefundCust').options[0].value === '');

  change($('#fcRefundArea'), c1.region); await sleep(60);
  const expectAreaCount = w.CUSTOMERS.filter(c => (c.region || '') === c1.region).length;
  check('U4 choosing an Area narrows the Shop list here too',
    $('#fcRefundCust').options.length === expectAreaCount + 1,
    `${$('#fcRefundCust').options.length} vs ${expectAreaCount} + the blank line`);

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

  /* ══════════════════════════════════════════════════════════════════════
     THE PAYMENTS SCREEN — where "amount received" lives (client, 2026-09-20:
     "you have amount received here, but we also pay some customers")
     ══════════════════════════════════════════════════════════════════════ */
  const closePanel = async () => { const b = $('#panel .x') || $('[data-close]') || $('#scrim'); if (b) click(b); await sleep(80); };
  const shopRows = () => $$('#fcPaidToShops tbody tr');
  const c2 = w.CUSTOMERS[w.CUSTOMERS.length - 1];   /* deliberately not the first shop */
  check('S0 setup: two different shops', c2.id !== w.CUSTOMERS[0].id && c2.id !== c1.id);

  w.go('payments'); await sleep(150);
  const refundsNow = ERP.Payments.refunds();
  check('S1 there are already payments to shops from the sections above', refundsNow.length >= 2, String(refundsNow.length));
  check('S2 the receive and the pay-a-shop buttons sit together in the Customer payments header',
    !!$('[data-fcpayopen="payment"]') && !!$('[data-fcpayopen="payment"]').parentNode.querySelector('[data-fcpayopen="refund"]'));
  check('S3 "Paid to shops" has its own button too', !!$('.sec-t [data-fcpayopen="refund"]') &&
    $$('[data-fcpayopen="refund"]').length === 2);
  check('S4 "Paid to shops" is its own list, above Supplier payments',
    !!$('#fcPaidToShops') && D.body.innerHTML.indexOf('id="fcPaidToShops"') < D.body.innerHTML.indexOf('>Supplier payments'));
  check('S5 it has one row per payment made to a shop', shopRows().length === refundsNow.length,
    `${shopRows().length} vs ${refundsNow.length}`);
  check('S6 each row names the shop and has a voucher button',
    shopRows().every(r => r.querySelector('[data-fcreceipt]')) &&
    refundsNow.every(p => $('#fcPaidToShops').textContent.includes((w.custBy(p.partyId) || {}).sh)));
  const sumP = refundsNow.reduce((s, p) => s + p.amount, 0);
  check('S7 the section heading carries the total paid to shops',
    $('#fcPaidToShops').previousElementSibling.textContent.includes(M.fmtPlain(sumP)),
    $('#fcPaidToShops').previousElementSibling.textContent);
  const supHead = $$('.sec-t').find(s => /^Supplier payments/.test(s.textContent.trim()));
  check('S8 payments to shops are still kept out of the supplier list',
    !!supHead && !refundsNow.some(p => supHead.nextElementSibling.textContent.includes(p.receiptNumber)));

  /* the buttons open with no shop chosen — a leftover from an earlier
     "Pay this shop" / "Receive payment" must not leak in */
  ERP.setRefundFor(c2.id); ERP.setPayFor(c2.id);
  click($('[data-fcpayopen="refund"]')); await sleep(150);
  check('S9 "Pay a shop" from this screen does not inherit an earlier shop',
    $('#fcRefundCust') && $('#fcRefundCust').value === '' && $('#fcRefundArea').value === '',
    $('#fcRefundCust') ? $('#fcRefundCust').value : 'panel did not open');
  await closePanel();
  click($('[data-fcpayopen="payment"]')); await sleep(150);
  check('S10 nor does "Receive payment" from this screen',
    $('#fcPayCust') && $('#fcPayCust').value === '' && $('#fcPayArea').value === '',
    $('#fcPayCust') ? $('#fcPayCust').value : 'panel did not open');
  await closePanel();

  /* pay a shop straight from this screen */
  click($('[data-fcpayopen="refund"]')); await sleep(150);
  change($('#fcRefundCust'), c2.id);
  const balC2 = ERP.Ledger.customerBalance(c2.id);
  $('[data-f="amt"]').value = '7500'; $('[data-f="ref"]').value = 'CASH-HAND';
  click($('[data-save="1"]')); await sleep(350);
  check('S11 saving from the Payments screen pays that shop',
    ERP.Ledger.customerBalance(c2.id) === balC2 + M.toP(7500));
  check('S12 the screen shows the new payment at once', shopRows().length === refundsNow.length + 1,
    `${shopRows().length} vs ${refundsNow.length + 1}`);
  check('S13 with its reference', $('#fcPaidToShops').textContent.includes('CASH-HAND'));
  if ($('[data-fcv="close"]')) click($('[data-fcv="close"]'));
  await sleep(80);
  click($('#fcPaidToShops [data-fcreceipt]')); await sleep(150);
  check('S14 a row\'s Voucher button opens the printable voucher', !!$('[data-fcv="close"]'));
  if ($('[data-fcv="close"]')) click($('[data-fcv="close"]'));
  await sleep(80);

  /* a reversed payment is not "paid to a shop" any more */
  const newest = ERP.Payments.refunds().find(p => p.reference === 'CASH-HAND');
  await ERP.Payments.reverse(newest.id, 'test');
  w.go('payments'); await sleep(150);
  check('S15 a reversed payment leaves the list', shopRows().length === refundsNow.length &&
    !$('#fcPaidToShops').textContent.includes('CASH-HAND'));

  /* nothing paid yet → an explanation, not an empty box */
  const w2 = boot({});
  for (let i = 0; i < 400 && !(w2.ERP && w2.ERP.ready); i++) await sleep(25);
  await sleep(250);
  w2.go('payments'); await sleep(150);
  const box2 = w2.document.querySelector('#fcPaidToShops');
  check('S16 with no payments to shops it says so and points at the button',
    box2 && /No payments to shops yet/.test(box2.textContent) && !box2.querySelector('table') &&
    !!w2.document.querySelector('[data-fcpayopen="refund"]'));
  check('S17 and the heading counts zero', box2.previousElementSibling.textContent.includes('0 payments'));
  w2.close();

  /* ══════════════════════════════════════════════════════════════════════
     SECOND PASS — the pay-a-shop panel shows where the account lands, and
     the stored balance points the right way for each kind of payment
     ══════════════════════════════════════════════════════════════════════ */
  const typeAmt = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const c3 = w.CUSTOMERS.filter(c => c.id !== c1.id && c.id !== c2.id)[0];

  click($('[data-fcpayopen="refund"]')); await sleep(150);
  change($('#fcRefundCust'), c3.id);
  const b3 = ERP.Ledger.customerBalance(c3.id);
  check('B1 with no amount typed the panel shows only the balance', !/after this payment/.test($('#fcRefundBal').textContent),
    $('#fcRefundBal').textContent);
  typeAmt($('[data-f="amt"]'), '4000');
  check('B2 typing an amount shows where the shop\'s account lands, as you type',
    $('#fcRefundBal').textContent.includes('after this payment') &&
    $('#fcRefundBal').textContent.includes(M.fmt(b3 + M.toP(4000))), $('#fcRefundBal').textContent);
  check('B3 a shop that would end up owing us is told so',
    /will owe you/.test($('#fcRefundBal').textContent), $('#fcRefundBal').textContent);
  typeAmt($('[data-f="amt"]'), '');
  check('B4 clearing the amount takes the line away again', !/after this payment/.test($('#fcRefundBal').textContent));
  typeAmt($('[data-f="amt"]'), '2500');
  change($('#fcRefundCust'), c2.id);
  check('B5 choosing another shop recomputes with the amount already typed',
    $('#fcRefundBal').textContent.includes(M.fmt(ERP.Ledger.customerBalance(c2.id) + M.toP(2500))), $('#fcRefundBal').textContent);
  change($('#fcRefundArea'), '');
  check('B6 changing the area keeps the amount line', /after this payment/.test($('#fcRefundBal').textContent), $('#fcRefundBal').textContent);
  await closePanel();

  /* stored balances point the right way for each kind of payment */
  await ERP.Payments.refund({ customerId: c3.id, amount: 1000, method: 'Cash', reference: 'SETUP' });
  const rec1b = ERP.Payments.refunds().find(p => p.reference === 'SETUP');
  check('B7 stored balanceAfter of a payment to a shop is balanceBefore + amount, and matches the ledger',
    rec1b.balanceAfter === rec1b.balanceBefore + rec1b.amount && ERP.Ledger.customerBalance(c3.id) === rec1b.balanceAfter,
    `${rec1b.balanceBefore} + ${rec1b.amount} -> ${rec1b.balanceAfter}, ledger ${ERP.Ledger.customerBalance(c3.id)}`);
  await ERP.Payments.receive({ customerId: c3.id, amount: 300, method: 'Cash', reference: 'R-SETUP' });
  const recIn2 = ERP.Payments.incoming().find(p => p.reference === 'R-SETUP');
  check('B8 a receipt still lowers it: balanceAfter = balanceBefore - amount',
    recIn2 && recIn2.balanceAfter === recIn2.balanceBefore - recIn2.amount, recIn2 && JSON.stringify([recIn2.balanceBefore, recIn2.amount, recIn2.balanceAfter]));
  const supPay2 = await ERP.Payments.pay({ supplierId: sup.id, amount: 200, method: 'Cash', reference: 'S-SETUP' });
  check('B9 a supplier payment still lowers it too', supPay2.balanceAfter === supPay2.balanceBefore - supPay2.amount,
    JSON.stringify([supPay2.balanceBefore, supPay2.amount, supPay2.balanceAfter]));

  /* ── no shop is ever chosen for you on a money screen (2026-09-21): the panels start on a blank choice and Save refuses until a
     shop is picked. Before, the first shop in the list was silently selected and a receipt could go to the wrong one. */
  ERP.setPayFor && ERP.setPayFor(null); ERP.setRefundFor && ERP.setRefundFor(null);
  const receiptsBefore = ERP.Payments.incoming().length, refundsBefore = ERP.Payments.refunds().length;
  w.openPanel('payment'); await sleep(200);
  check('N1 Receive payment opens with no shop chosen, and says so', $('#fcPayCust').value === '' && /Choose the shop/.test($('#fcPayBal').textContent), $('#fcPayBal').textContent);
  $('[data-f="amt"]').value = '1234'; click($('[data-save="1"]')); await sleep(250);
  check('N2 Save without a shop is refused and nothing is recorded', ERP.Payments.incoming().length === receiptsBefore && /Choose the shop/.test($('#panel').textContent));
  change($('#fcPayMode'), 'pick'); await sleep(60);
  check('N3 "Choose invoices" with no shop says to choose the shop first, not "this shop has no unpaid invoices"',
    /Choose the shop first/.test($('#fcPayList').textContent) && !/no unpaid invoices/.test($('#fcPayList').textContent), $('#fcPayList').textContent);
  change($('#fcPayCust'), c2.id); await sleep(60);
  check('N4 choosing a shop shows its balance', $('#fcPayBal').textContent.includes(M.fmt(ERP.Ledger.customerBalance(c2.id))));
  change($('#fcPayArea'), ''); await sleep(60);
  check('N5 changing the area keeps the shop already chosen when it is still in the list', $('#fcPayCust').value === c2.id);
  change($('#fcPayArea'), c2.region === c1.region ? '' : c1.region); await sleep(60);
  if (c2.region !== c1.region) check('N6 ...and drops back to the blank choice when it is not', $('#fcPayCust').value === '' && /Choose the shop/.test($('#fcPayBal').textContent));
  await closePanel();

  w.openPanel('refund'); await sleep(200);
  check('N7 Pay a shop opens with no shop chosen, and says so', $('#fcRefundCust').value === '' && /Choose the shop/.test($('#fcRefundBal').textContent), $('#fcRefundBal').textContent);
  $('[data-f="amt"]').value = '500'; click($('[data-save="1"]')); await sleep(250);
  check('N8 Save without a shop is refused and nothing is paid out', ERP.Payments.refunds().length === refundsBefore && /Choose the shop/.test($('#panel').textContent));
  await closePanel();

  /* ── the amount field's wording (client, 2026-09-21): "Receive payment" says Amount Received; the panels that pay money OUT say
     Amount Paid. Module 24's relabeller once rewrote "Amount received" to "Amount Paid" on every repaint, so this is checked after it ran. */
  const amtLabel = () => { const s = $('#panel .fc-amtpaid label.f span'); return s ? s.textContent.trim() : '(no field)'; };
  w.openPanel('payment'); await sleep(200);
  check('L1 Receive payment labels the amount "Amount Received"', amtLabel() === 'Amount Received', amtLabel());
  await closePanel();
  w.openPanel('refund'); await sleep(200);
  check('L2 Pay a shop still labels it "Amount Paid"', amtLabel() === 'Amount Paid', amtLabel());
  await closePanel();
  w.openPanel('paysup'); await sleep(200);
  check('L3 Pay supplier still labels it "Amount Paid"', amtLabel() === 'Amount Paid', amtLabel());
  await closePanel();

  /* ── Client request (2026-09-23): "want to change amount" on a Paid-to-shops
     voucher. Payments.editAmount corrects the figure in place — no cancel and
     redo — but only for a stand-alone "Pay a shop" voucher; see
     Payments.editAmountCheck for what is refused and why. ── */
  const badPay = await ERP.Payments.refund({ customerId: c3.id, amount: 5000, method: 'Cash', reference: 'FIX-ME' });
  const badPayOldAmount = badPay.amount;            /* badPay is the SAME object editAmount mutates in place */
  const c3BalBefore = ERP.Ledger.customerBalance(c3.id);
  check('C1 ERP.Payments.editAmount exists', typeof ERP.Payments.editAmount === 'function');
  ERP.actions.editPaymentAmount(badPay.id); await sleep(200);
  check('C2 the panel names the voucher and its current amount',
    $('#panel').textContent.includes(badPay.receiptNumber) && $('#panel').textContent.includes(M.fmt(badPayOldAmount)));
  check('C3 the amount field starts filled with the current figure, in rupees',
    $('[data-f="amt"]').value === String(M.toR(badPayOldAmount)), $('[data-f="amt"]').value);
  check('C3a with the figure unchanged the balance banner shows only "Currently", no "will become"',
    !!$('#fcEditAmtBal') && /Currently/.test($('#fcEditAmtBal').textContent) && !/will become/.test($('#fcEditAmtBal').textContent));
  click($('[data-save="1"]')); await sleep(200);
  check('C3b saving with the unchanged figure is refused inline, and the panel stays open',
    /already the recorded figure/.test($('#panel').textContent) && ERP.Payments.byId(badPay.id).amount === badPayOldAmount);
  const amtInput = $('[data-f="amt"]');
  amtInput.value = '4200'; amtInput.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(60);
  check('C3c typing a new figure previews it and the shop\'s new balance, live',
    $('#fcEditAmtBal').textContent.includes(M.fmt(M.toP(4200))) &&
    $('#fcEditAmtBal').textContent.includes(M.fmt(c3BalBefore - badPayOldAmount + M.toP(4200))));
  $('[data-f="reason"]').value = 'typed the wrong amount';
  click($('[data-save="1"]')); await sleep(250);
  check('C4 saving updates the amount only — reference and method are untouched',
    ERP.Payments.byId(badPay.id).amount === M.toP(4200) &&
    ERP.Payments.byId(badPay.id).reference === 'FIX-ME' && ERP.Payments.byId(badPay.id).method === 'Cash');
  check('C5 the shop\'s balance moves by exactly the difference (not a fresh amount added on top)',
    ERP.Ledger.customerBalance(c3.id) === c3BalBefore - badPayOldAmount + M.toP(4200),
    `${ERP.Ledger.customerBalance(c3.id)} vs ${c3BalBefore - badPayOldAmount + M.toP(4200)}`);
  const editAudit = ERP.S.audit.find(a => a.entityId === badPay.id && a.action === 'Payment amount corrected');
  check('C6 the correction is recorded in the audit log with the old and new figures and the reason',
    !!editAudit && editAudit.oldValues.amount === M.toP(5000) && editAudit.newValues.amount === M.toP(4200) &&
    editAudit.reason === 'typed the wrong amount');
  await closePanel();

  check('C7 zero or the unchanged figure is refused',
    (await ERP.Payments.editAmount(badPay.id, 0).catch(e => e)).validation &&
    (await ERP.Payments.editAmount(badPay.id, 4200).catch(e => e)).validation);

  await ERP.Payments.reverse(badPay.id, 'test');
  check('C8 a reversed voucher is refused', /reversed voucher/.test(ERP.Payments.editAmountCheck(badPay.id).errs[0] || ''));

  const recvPay = await ERP.Payments.receive({ customerId: c3.id, amount: 500, method: 'Cash', reference: 'IN-ONLY' });
  check('C9 an ordinary receipt (money received) is refused — this only corrects a voucher paid to a shop or a supplier',
    /paid to a shop or a supplier/.test(ERP.Payments.editAmountCheck(recvPay.id).errs[0] || ''));

  /* Extended the same day (2026-09-23) to a "Pay supplier" voucher — same fix,
     same panel, opposite balance direction (paying a supplier LOWERS what we
     owe it, where a shop refund RAISES what it owes us). */
  const supPay3 = await ERP.Payments.pay({ supplierId: sup.id, amount: 500, method: 'Cash', reference: 'SUP-ONLY' });
  check('C10a a stand-alone supplier voucher (no allocations) is NOT refused',
    ERP.Payments.editAmountCheck(supPay3.id).errs.length === 0,
    JSON.stringify(ERP.Payments.editAmountCheck(supPay3.id).errs));
  const supBalBefore = ERP.Ledger.supplierBalance(sup.id);
  ERP.actions.editPaymentAmount(supPay3.id); await sleep(200);
  check('C10b the panel names the supplier voucher, its current amount and the supplier (not a shop)',
    $('#panel').textContent.includes(supPay3.receiptNumber) && $('#panel').textContent.includes(M.fmt(supPay3.amount)) &&
    $('#panel').textContent.includes(sup.co));
  const supAmtInput = $('[data-f="amt"]');
  supAmtInput.value = '650'; supAmtInput.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(60);
  check('C10c typing a new figure previews the supplier balance moving the OPPOSITE way to a shop refund',
    $('#fcEditAmtBal').textContent.includes(M.fmt(supBalBefore - (M.toP(650) - supPay3.amount))));
  click($('[data-save="1"]')); await sleep(250);
  check('C10d saving updates the supplier voucher amount', ERP.Payments.byId(supPay3.id).amount === M.toP(650));
  check('C10e the supplier\'s balance moved by exactly the difference, opposite direction to a shop refund',
    ERP.Ledger.supplierBalance(sup.id) === supBalBefore - (M.toP(650) - M.toP(500)),
    `${ERP.Ledger.supplierBalance(sup.id)} vs ${supBalBefore - (M.toP(650) - M.toP(500))}`);
  await closePanel();

  const supPayAlloc = await ERP.Payments.pay({
    supplierId: sup.id, amount: 700, method: 'Cash', reference: 'SUP-ALLOC',
    allocations: [{ purchaseId: 'test-fake-purchase', amountP: M.toP(700) }]
  });
  check('C10f a supplier voucher applied to a purchase is refused — its allocated total would then be wrong',
    /applied to an invoice or purchase/.test(ERP.Payments.editAmountCheck(supPayAlloc.id).errs[0] || ''));

  /* the cash side of a customer return's REFUND treatment must not be edited on its own —
     its amount is duplicated onto customerReturns.creditAmount, and the two cancel out
     in the shop's ledger (N7.8 in test-erp.mjs) only as long as they still match */
  const invRet = await ERP.Invoices.save({
    /* paid in full: a REFUND can only give back money the shop actually paid (Returns.refundLimitError, 2026-09-26) */
    customerId: c3.id, warehouseId: wh.id, invoiceDate: '2026-09-14', paidAmount: 5000,
    items: [{ productId: prod.id, quantity: 5, unitPrice: 1000, discount: 0, warehouseId: wh.id }]
  });
  const itRet = ERP.Invoices.items(invRet.id)[0];
  const custRet = await ERP.Returns.fromCustomer({
    invoiceId: invRet.id, warehouseId: wh.id, treatment: 'REFUND', reason: 'test',
    items: [{ invoiceItemId: itRet.id, quantity: 2, condition: 'SELLABLE' }]
  });
  const retPay = ERP.Payments.refunds().find(p => p.reference === custRet.returnNumber);
  check('C11 setup: the return posted its own refund payment', !!retPay, JSON.stringify(custRet));
  check('C12 that refund is refused too, pointing at the return instead',
    /return instead/.test(ERP.Payments.editAmountCheck(retPay.id).errs[0] || ''));

  /* the return-linkage guard must match on the note Returns.fromCustomer actually writes,
     not the reference alone — a stand-alone voucher whose reference is coincidentally typed
     the same as an unrelated return's number is a real, if unusual, false-positive risk */
  const coincidence = await ERP.Payments.refund({ customerId: c3.id, amount: 300, method: 'Cash',
    reference: custRet.returnNumber, note: 'unrelated cash handed back' });
  check('C13 a reference that only coincidentally matches a return number is NOT blocked',
    ERP.Payments.editAmountCheck(coincidence.id).errs.length === 0);

  console.log('\n' + out.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  w.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
