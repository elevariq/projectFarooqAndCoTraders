/* The Warehouse app on the company server database (module 39 + the page's own server path).
   The REAL Warehouse page runs in jsdom on the shared mock of the business-data API (test-mock-server.mjs — the same
   rules api/_data.php enforces). Nothing here fakes the app: every entry is made by clicking the page's own buttons.

   What must hold:
     · it reads the company database (not its old browser copy), downloads only what it needs, writes nothing at start-up;
     · a receive and a dispatch make byte-for-byte the records the OFFICE screens make (proved by running both and comparing);
     · a dispatch for an invoice that already took the bags out does not take them out twice;
     · two people can never take the same number or sell the same last bag; a save that loses a race is refused whole;
     · it catches up with other people's changes by itself, but never under the user's hands;
     · with no signal nothing is "saved for later" — it says so and sends nothing;
     · names typed by staff cannot inject markup; a movement of a product that was switched off cannot break a screen;
     · with the switch off (or no server API) the page behaves exactly as before. */
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
import { Mock, SEED } from './test-mock-server.mjs';

const PWA_HTML = fs.readFileSync(process.env.PWA_HTML_PATH || path.resolve('dist/farooq-co-warehouse-pwa.html'), 'utf8');   /* PWA_HTML_PATH: only to mutation-test the page */
const ERP_HTML = fs.readFileSync(path.resolve('dist/farooq-co-erp.html'), 'utf8');
let pass = 0, fail = 0; const out = [];
function check(name, cond, detail) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); } else { fail++; out.push(`  ✘ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitUntil(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(20); } return false; }

/* ── the world: the seed plus some stock, one invoice that already took its bags out ───────────────── */
const P1 = 'PRD-0004', P2 = 'PRD-0005', WH = 'wh-main', WH2 = 'wh-college', SHOP = 'CUS-0006', SHOP2 = 'CUS-0007', SUP = 'SUP-0002';
const inv = (id, no, cust, status, extra = {}) => ({ id, invoiceNumber: no, customerId: cust, status, stockApplied: true, dispatchNumber: '', invoiceDate: '2026-09-18', totalQty: 40, grandTotal: 1000000, ...extra });
function world(opts = {}) {
  const m = new Mock(SEED, opts);
  const put = (s, k, d) => m.stores[s].set(k, { r: 1, d });
  put('inventory', P1 + '|' + WH, { id: P1 + '|' + WH, productId: P1, warehouseId: WH, qty: 100, damagedQty: 0, avgCostP: 250000 });
  put('inventory', P2 + '|' + WH, { id: P2 + '|' + WH, productId: P2, warehouseId: WH, qty: 30, damagedQty: 0, avgCostP: 0 });
  put('inventory', P1 + '|' + WH2, { id: P1 + '|' + WH2, productId: P1, warehouseId: WH2, qty: 7, damagedQty: 0, avgCostP: 0 });
  for (let i = 0; i < 3; i++) {                                   /* three old movements so the history list has something to show */
    const id = 'mv_old_' + i;
    put('stockMovements', id, { id, createdAt: '2026-09-1' + i + 'T09:00:00.000Z', date: '2026-09-1' + i, productId: P1, warehouseId: WH, kind: i === 1 ? 'SALE_OUT' : 'PURCHASE_IN',
      qtyDelta: i === 1 ? -20 : 60, bucket: 'stock', balanceAfter: 100, ref: 'REF-' + i, refType: 'X', note: i === 1 ? 'Some shop' : 'Zam Zam Flour Mill', unitCostP: 0, userId: 'Owner' });
  }
  put('invoices', 'inv-a', inv('inv-a', 'INV-2026-000001', SHOP, 'CONFIRMED'));
  put('invoices', 'inv-b', inv('inv-b', 'INV-2026-000002', SHOP, 'PAID', { dispatchNumber: 'DSP-2026-000009' }));
  put('invoices', 'inv-draft', inv('inv-draft', 'INV-2026-000003', SHOP, 'DRAFT'));
  put('invoices', 'inv-cancel', inv('inv-cancel', 'INV-2026-000004', SHOP, 'CANCELLED'));
  put('invoices', 'inv-other', inv('inv-other', 'INV-2026-000005', SHOP2, 'CONFIRMED'));
  put('invoices', 'inv-nt', inv('inv-nt', 'INV-2026-000006', SHOP, 'CONFIRMED', { stockApplied: false }));   /* made without taking the bags out */
  return m;
}

/* ── booting the real Warehouse page (or the office app, for the comparison) ─────────────────────────── */
function browser(html, mock, opts = {}) {
  const vc = new VirtualConsole(); const errors = [];
  vc.on('jsdomError', e => { if (!/Could not load|not implemented/i.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://farooq.local/',
    beforeParse(w) {
      w.indexedDB = new FDBFactory(); w.IDBKeyRange = FDBKeyRange;
      w.print = () => {}; w.confirm = () => true; w.prompt = () => 'reason'; w.alert = () => {}; w.scrollTo = () => {};
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; w.open = () => null;
      if (mock) w.fetch = mock.fetchFor();
      for (const k of Object.keys(opts.ls || {})) w.localStorage.setItem(k, opts.ls[k]);
      if (opts.offline) Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
    }
  });
  return { dom, w: dom.window, errors };
}
async function pwa(mock, opts) {
  const b = browser(PWA_HTML, mock, opts);
  b.ready = await waitUntil(() => b.w.FcWH && b.w.FcWH.active && /Warehouse stock/.test(b.w.document.getElementById('view').textContent), opts && opts.waitMs || 8000);
  await sleep(60);
  return b;
}
async function office(mock) {
  const b = browser(ERP_HTML, mock);
  b.ready = await waitUntil(() => b.w.ERP && b.w.ERP.fullyReady, 15000);
  await sleep(200);
  return b;
}
const $ = (w, sel) => w.document.querySelector(sel);
const click = (w, sel) => { const el = $(w, sel); if (!el) throw new Error('no element ' + sel); el.click(); };
const typeIn = (w, sel, v) => { const el = $(w, sel); if (!el) throw new Error('no input ' + sel); el.value = String(v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const shown = w => { const c = w.document.getElementById('view').cloneNode(true); c.querySelectorAll('script,style').forEach(n => n.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
const ev = (w, code) => w.eval(code);
/* close a window only once its last save has finished (a save that lands on a closed window would throw) */
async function end(w) { await waitUntil(() => { try { return !w.eval('S.busy'); } catch (e) { return true; } }, 3000); await sleep(40); w.close(); }
const stockOf = (m, p, wh) => { const e = m.stores.inventory.get(p + '|' + wh); return e ? e.d.qty : undefined; };

async function receiveUi(w, { prod = P1, qty = 100, sup = SUP, wh = WH } = {}) {
  click(w, '[data-go="add"]'); click(w, `[data-apick="${prod}"]`); click(w, '[data-next]');
  if (qty !== 100) typeIn(w, '#qty', qty);
  click(w, '[data-next]'); click(w, `[data-sup="${sup}"]`); click(w, '[data-next]'); click(w, `[data-awh="${wh}"]`);
  click(w, '[data-save]');
}
async function dispatchUi(w, { shop = SHOP, wh = WH, prod = P1, qty = 30, inv: invId = '' } = {}) {
  click(w, '[data-go="send"]'); click(w, `[data-oshop="${shop}"]`);
  await waitUntil(() => ev(w, 'S.out.invs') !== null);
  if (invId) click(w, `[data-oinv="${invId}"]`);
  click(w, `[data-owh="${wh}"]`); click(w, `[data-oprod="${prod}"]`);
  typeIn(w, '#oqty', qty);
  if (!$(w, '[data-send]').disabled) click(w, '[data-send]');
}

async function main() {
  /* ══ A. start-up ═══════════════════════════════════════════════════════════════════════════════ */
  {
    const m = world(); const b = await pwa(m); const w = b.w;
    check('W1 with the switch on, the page runs on the company database', b.ready && w.FcWH.active && w.FDB.driver === 'server', b.errors.join(';'));
    check('W2 the shops, products, warehouses and suppliers are the database\'s (409 shops, 131 active products, 3 warehouses, 31 active suppliers)',
      ev(w, 'SHOPS.length') === 409 && ev(w, 'PRODUCTS.length') === 131 && ev(w, 'WAREHOUSES.length') === 3 && ev(w, 'SUPPLIERS.length') === 31,
      [ev(w, 'SHOPS.length'), ev(w, 'PRODUCTS.length'), ev(w, 'WAREHOUSES.length'), ev(w, 'SUPPLIERS.length')].join('/'));
    check('W3 it did NOT download the whole business (no full hydrate; only small reads)', m.hydrates === 0 && m.reads <= 3, `hydrates=${m.hydrates} reads=${m.reads}`);
    check('W4 nothing is written to the server just by opening the page', m.commits === 0);
    check('W5 the stock on screen is the database\'s stock', ev(w, `stockAt('${P1}','${WH}')`) === 100 && ev(w, `stockAt('${P2}','${WH}')`) === 30 && ev(w, `stockAt('${P1}','${WH2}')`) === 7);
    check('W6 the history is the newest movements from the server, newest first',
      ev(w, 'HISTORY.length') === 3 && ev(w, 'HISTORY[0].pid') === P1 && ev(w, 'HISTORY[0].t') === 'in' && ev(w, 'HISTORY[1].t') === 'out' && ev(w, 'HISTORY[1].qty') === 20);
    check('W7 this device remembers it runs on the server (so it can never fall back to a browser copy)', w.localStorage.getItem('farooqco_backend') === 'server');
    check('W8 the old browser copy is not used or created (no farooqco_erp_v1)', w.localStorage.getItem('farooqco_erp_v1') === null);
    const inactive = SEED.data.products.filter(p => p.active === false).map(p => p.id);
    check('W9 none of the 5 switched-off products is offered', inactive.length === 5 && inactive.every(id => !ev(w, `PRODUCTS.some(p=>p.id==="${id}")`)));
    check('W11 the page did not throw', b.errors.length === 0, b.errors.join(';'));
    await end(w);
  }
  { // the switch is OFF → the page is exactly the old one
    const m = world({ backend: 'browser' }); const b = browser(PWA_HTML, m); await sleep(1500); const w = b.w;
    check('W12 switch off → the old browser-copy behaviour (FcWH stays inactive, page shows its own data)', !w.FcWH.active && ev(w, 'SERVER') === false && ev(w, 'PRODUCTS.length') > 0 && !!w.localStorage.getItem('farooqco_erp_v1'));
    check('W13 …and it only asked the server which backend to use (no data read, nothing written)', m.log.every(l => l === 'GET status.php') && m.commits === 0, m.log.join(','));
    await end(w);
    const b2 = browser(PWA_HTML, null); await sleep(1200);
    check('W14 no server API at all (a plain browser page) → the old behaviour', !b2.w.FcWH.active && ev(b2.w, 'PRODUCTS.length') > 0);
    await end(b2.w);
  }
  { // never guess
    const m = world(); m.fail['status.php'] = { times: 99, kind: 'network' };
    const b = browser(PWA_HTML, m, { ls: { farooqco_backend: 'server' } }); await sleep(1500); const w = b.w;
    check('W15 a device that ran on the server and cannot reach it stops with a notice — it does not fall back', !!w.document.getElementById('fcsd-boot') && !w.FcWH.active);
    check('W16 …and it did not seed or use a browser copy', w.localStorage.getItem('farooqco_erp_v1') === null);
    await end(w);
    const m2 = world(); m2.fail['read.php'] = { times: 99, kind: 'network' };
    const b2 = browser(PWA_HTML, m2); await sleep(1500);
    check('W17 if the data cannot be loaded the page says so and offers "Try again" (nothing is shown as if it were real)',
      /Cannot load the stock/.test(shown(b2.w)) && !!$(b2.w, '[data-retry]'), shown(b2.w).slice(0, 120));
    await end(b2.w);
  }

  /* ══ B. receive ═══════════════════════════════════════════════════════════════════════════════ */
  {
    const m = world(); const b = await pwa(m); const w = b.w;
    await receiveUi(w, { qty: 120 });
    const ok = await waitUntil(() => m.count('stockDocs') === 1);
    await waitUntil(() => /Stock (received|dispatched)/.test(shown(w)));      /* the page has drawn its "done" screen */
    check('B1 receiving through the page creates one stock document RCV-… on the server', ok && /^RCV-\d{4}-000001$/.test((m.rows('stockDocs')[0] || {}).docNumber), JSON.stringify(m.rows('stockDocs')[0] || {}).slice(0, 100));
    const d = m.rows('stockDocs')[0] || {}, mv = m.rows('stockMovements').filter(x => x.ref === d.docNumber);
    check('B2 the stock row went up by exactly the bags received (100 + 120)', stockOf(m, P1, WH) === 220);
    check('B3 one ADJUSTMENT_IN movement, with the running balance and the supplier in the reason', mv.length === 1 && mv[0].kind === 'ADJUSTMENT_IN' && mv[0].qtyDelta === 120 && mv[0].balanceAfter === 220 && /Received from/.test(d.reason), JSON.stringify(mv));
    check('B4 the entry is attributed to the signed-in person (not "Owner")', d.createdBy === 'Farooq Ahmed' && mv[0].userId === 'Farooq Ahmed');
    const au = m.rows('auditLog').filter(a => a.ref === d.docNumber);
    check('B5 an audit row was written, with the person and where it came from', au.length === 1 && au[0].userName === 'Farooq Ahmed' && au[0].source === 'Warehouse app');
    check('B6 the "done" screen shows the document number and says it is on the server', /On the company server/.test(shown(w)) && shown(w).includes(d.docNumber), shown(w).slice(0, 160));
    check('B7 the page\'s stock and history follow at once (no reload)', ev(w, `stockAt('${P1}','${WH}')`) === 220 && ev(w, 'HISTORY[0].qty') === 120 && ev(w, 'HISTORY[0].t') === 'in');
    check('B8 no "NOT saved" notice and no stale banner', !w.document.getElementById('fcsd-failed') && !w.document.getElementById('fcsd-stale'));
    check('B9 the save was ONE commit (atomic)', m.commits === 1, 'commits=' + m.commits);
    await end(w);
  }
  { // a double tap must not post twice
    const m = world(); const b = await pwa(m); const w = b.w;
    click(w, '[data-go="add"]'); click(w, `[data-apick="${P1}"]`); click(w, '[data-next]'); click(w, '[data-next]'); click(w, `[data-sup="${SUP}"]`); click(w, '[data-next]'); click(w, `[data-awh="${WH}"]`);
    click(w, '[data-save]'); const again = $(w, '[data-save]'); if (again) again.click();
    await sleep(500);
    check('B10 tapping Save twice makes ONE receipt', m.count('stockDocs') === 1 && stockOf(m, P1, WH) === 200, `docs=${m.count('stockDocs')} qty=${stockOf(m, P1, WH)}`);
    await end(w);
  }

  /* ══ C. dispatch ══════════════════════════════════════════════════════════════════════════════ */
  {
    const m = world(); const b = await pwa(m); const w = b.w;
    click(w, '[data-go="send"]'); click(w, `[data-oshop="${SHOP}"]`);
    await waitUntil(() => ev(w, 'S.out.invs') !== null);
    const invText = shown(w);
    check('C1 the shop\'s invoices are offered — but not drafts, cancelled ones, or another shop\'s',
      invText.includes('INV-2026-000001') && invText.includes('INV-2026-000002') && !invText.includes('INV-2026-000003') && !invText.includes('INV-2026-000004') && !invText.includes('INV-2026-000005'), invText.slice(0, 200));
    check('C2 an invoice that was already sent is marked as such', /already sent as DSP-2026-000009/.test(invText));
    await dispatchUi(w, { qty: 30 }).catch(e => { throw e; });
    const ok = await waitUntil(() => m.count('stockDocs') === 1);
    await waitUntil(() => /Stock (received|dispatched)/.test(shown(w)));      /* the page has drawn its "done" screen */
    const d = m.rows('stockDocs')[0] || {};
    check('C3 an unlinked dispatch creates DSP-… and takes the bags out (100 − 30)', ok && /^DSP-\d{4}-000001$/.test(d.docNumber) && d.type === 'DISPATCH' && d.stockApplied === true && stockOf(m, P1, WH) === 70, JSON.stringify(d).slice(0, 140));
    const mv = m.rows('stockMovements').filter(x => x.ref === d.docNumber);
    check('C4 one DISPATCH_OUT movement naming the shop, shop and region recorded on the document',
      mv.length === 1 && mv[0].kind === 'DISPATCH_OUT' && mv[0].qtyDelta === -30 && mv[0].balanceAfter === 70 && d.customerId === SHOP && !!d.customerSnapshot && /—/.test(d.regionSnapshot), JSON.stringify(mv[0] || {}).slice(0, 160));
    check('C5 the "done" screen says stock now holds 70', /now holds 70 bags/.test(shown(w)), shown(w).slice(0, 200));
    await end(w);
  }
  { // linked to an invoice that already took the bags out: no second deduction
    const m = world(); const b = await pwa(m); const w = b.w;
    await dispatchUi(w, { inv: 'inv-a', qty: 40 });
    const ok = await waitUntil(() => m.count('stockDocs') === 1);
    await waitUntil(() => /Stock (received|dispatched)/.test(shown(w)));      /* the page has drawn its "done" screen */
    const d = m.rows('stockDocs')[0] || {}, invRow = m.stores.invoices.get('inv-a').d;
    check('C6 a dispatch for an invoice that already took the stock out does NOT take it out again', ok && stockOf(m, P1, WH) === 100 && d.stockApplied === false && m.rows('stockMovements').filter(x => x.ref === d.docNumber).length === 0,
      `qty=${stockOf(m, P1, WH)} docs=${JSON.stringify(d).slice(0, 100)}`);
    check('C7 …the document names the invoice and the invoice knows its dispatch (CONFIRMED → DISPATCHED)', d.invoiceId === 'inv-a' && d.invoiceNumber === 'INV-2026-000001' && invRow.dispatchNumber === d.docNumber && invRow.status === 'DISPATCHED');
    check('C8 …and it was one atomic commit', m.commits === 1);
    await waitUntil(() => /Stock dispatched/.test(shown(w)));
    check('C9 the page says the invoice already took the stock out', /already taken out by the invoice/.test(shown(w)), shown(w).slice(0, 200));
    await end(w);
  }
  { // an invoice that did NOT take the stock out: the dispatch takes it out (and is still linked)
    const m = world(); const b = await pwa(m); const w = b.w;
    await dispatchUi(w, { inv: 'inv-nt', qty: 15 });
    const ok = await waitUntil(() => m.count('stockDocs') === 1);
    await waitUntil(() => /Stock dispatched/.test(shown(w)));
    const d = m.rows('stockDocs')[0] || {};
    check('C6b an invoice that did NOT take the bags out yet: the dispatch takes them out (100 − 15) and is linked to the invoice',
      ok && stockOf(m, P1, WH) === 85 && d.stockApplied === true && d.invoiceId === 'inv-nt' && m.stores.invoices.get('inv-nt').d.dispatchNumber === d.docNumber, JSON.stringify(d).slice(0, 120));
    check('C6c …and the page did not claim "already taken out"', !/already taken out by the invoice/.test(shown(w)) && /now holds 85 bags/.test(shown(w)), shown(w).slice(0, 160));
    await end(w);
  }
  { // refusals: nothing is written, no scary notice
    const m = world(); const b = await pwa(m); const w = b.w;
    click(w, '[data-go="send"]'); click(w, `[data-oshop="${SHOP}"]`); await waitUntil(() => ev(w, 'S.out.invs') !== null);
    click(w, `[data-owh="${WH}"]`); click(w, `[data-oprod="${P2}"]`); typeIn(w, '#oqty', 31);
    check('C10 asking for more bags than the shelf holds disables the button ("Too many bags")', $(w, '[data-send]').disabled && /Too many bags/.test(shown(w)));
    /* the button is right for what the page HAS — but someone else may have sold the bags since; the server-side check refuses */
    m.stores.inventory.set(P2 + '|' + WH, { r: 5, d: { id: P2 + '|' + WH, productId: P2, warehouseId: WH, qty: 30, damagedQty: 0, avgCostP: 0 } });
    typeIn(w, '#oqty', 30);
    const before = m.commits;
    // make the shelf empty behind the page's back (a sale by the office), keep the page's stale number
    const stale = stockOf(m, P2, WH); m.stores.inventory.get(P2 + '|' + WH).d.qty = 5; m.stores.inventory.get(P2 + '|' + WH).r++;
    click(w, '[data-send]');
    await waitUntil(() => /Not saved/.test(shown(w)));
    check('C11 someone else emptied the shelf: the save is refused against the server\'s truth, with the real figure, and nothing is written',
      /Only 5 bags/.test(shown(w)) && m.count('stockDocs') === 0 && m.commits === before && stockOf(m, P2, WH) === 5, shown(w).slice(0, 240));
    check('C12 …a business refusal is NOT shown as a broken save (no blocking notice) and the page stays usable', !w.document.getElementById('fcsd-failed') && !w.FDB.server.failed);
    await end(w);
  }
  { // a dispatch needs a shop; negative stock only when the owner allowed it
    const m = world(); const b = await pwa(m); const w = b.w;
    const r = await w.FcWH.post('DISPATCH', { warehouseId: WH, items: [{ productId: P1, quantity: 5 }], clientOpId: 'x1' }).then(() => null, e => e);
    check('C13 a dispatch with no shop is refused (like the office screen)', r && r.validation && /Choose the shop/.test(r.validation.join(' ')) && m.commits === 0);
    const r2 = await w.FcWH.post('DISPATCH', { warehouseId: WH, customerId: SHOP, items: [{ productId: P1, quantity: 500 }], clientOpId: 'x2' }).then(() => null, e => e);
    check('C14 more bags than are there is refused when negative stock is not allowed', r2 && /Only 100 bags/.test((r2.validation || []).join(' ')) && m.commits === 0);
    m.stores.business.get('business').d.allowNegativeStock = true;
    await w.FcWH.refresh(); const bad = m.commits;
    // refresh() re-reads the business row through the base stores
    const r3 = await w.FcWH.post('DISPATCH', { warehouseId: WH, customerId: SHOP, items: [{ productId: P1, quantity: 130 }], clientOpId: 'x3' }).then(x => x, e => e);
    check('C15 …and allowed when the owner switched "allow negative stock" on', r3 && r3.doc && stockOf(m, P1, WH) === -30 && m.commits === bad + 1, JSON.stringify(r3).slice(0, 120));
    await end(w);
  }

  /* ══ D. two people at once ══════════════════════════════════════════════════════════════════ */
  {
    const m = world(); const b1 = await pwa(m), b2 = await pwa(m);
    /* both screens show 30 bags of P2; person 1 sends 30, then person 2 tries to send 30 from the (stale) screen */
    await dispatchUi(b1.w, { prod: P2, qty: 30 });
    await waitUntil(() => m.count('stockDocs') === 1);
    const before = m.commits;
    await dispatchUi(b2.w, { prod: P2, qty: 30 });
    await waitUntil(() => /Not saved|Only 0 bags/.test(shown(b2.w)) || m.count('stockDocs') > 1);
    check('D1 the second person cannot sell the same last bags: refused with the true figure, nothing written', m.count('stockDocs') === 1 && stockOf(m, P2, WH) === 0 && /Only 0 bags/.test(shown(b2.w)) && m.commits === before, shown(b2.w).slice(0, 200));
    await end(b1.w); await end(b2.w);
  }
  {
    const m = world(); const b1 = await pwa(m), b2 = await pwa(m);
    await receiveUi(b1.w, { qty: 10 }); await waitUntil(() => m.count('stockDocs') === 1);
    await receiveUi(b2.w, { qty: 20 }); await waitUntil(() => m.count('stockDocs') === 2);
    const nums = m.rows('stockDocs').map(d => d.docNumber).sort();
    check('D2 two receipts from two screens take DIFFERENT numbers (the counter is re-read before every save)', nums.length === 2 && nums[0] !== nums[1] && /-000001$/.test(nums[0]) && /-000002$/.test(nums[1]), nums.join(','));
    check('D3 …and the shelf holds both (100 + 10 + 20)', stockOf(m, P1, WH) === 130, 'qty=' + stockOf(m, P1, WH));
    await end(b1.w); await end(b2.w);
  }
  { // a race INSIDE the save (another writer between our read and our commit): refused whole, loudly
    const m = world(); const b = await pwa(m); const w = b.w;
    const orig = m.handle.bind(m); let armed = true;
    m.handle = (url, init) => { if (armed && /commit\.php/.test(url)) { armed = false; const e = m.stores.inventory.get(P1 + '|' + WH); e.r++; e.d = { ...e.d, qty: 90 }; } return orig(url, init); };
    await receiveUi(w, { qty: 10 });
    await waitUntil(() => !!w.document.getElementById('fcsd-failed'));
    check('D4 a save that loses a race inside the commit is refused WHOLE: nothing written, the blocking notice shown', !!w.document.getElementById('fcsd-failed') && m.count('stockDocs') === 0 && stockOf(m, P1, WH) === 90, 'docs=' + m.count('stockDocs'));
    check('D5 …and further saves are blocked until reload (never a quiet retry on stale data)', await w.FcWH.post('RECEIVE', { warehouseId: WH, reason: 'x', items: [{ productId: P1, quantity: 1 }], clientOpId: 'zz' }).then(() => false, e => !!e));
    await end(w);
  }

  /* ══ E. catching up ═══════════════════════════════════════════════════════════════════════ */
  {
    const m = world(); const b = await pwa(m); const w = b.w;
    const home = shown(w);
    m.stores.inventory.set(P1 + '|' + WH, { r: 9, d: { id: P1 + '|' + WH, productId: P1, warehouseId: WH, qty: 500, damagedQty: 0, avgCostP: 0 } }); m.version++;
    await w.FDB.server.check();
    const ok = await waitUntil(() => ev(w, `stockAt('${P1}','${WH}')`) === 500);
    check('E1 when somebody else saves, an idle page catches up by itself (no banner, no reload)', ok && !w.document.getElementById('fcsd-stale') && shown(w) !== home, shown(w).slice(0, 100));
    click(w, '[data-go="add"]'); await sleep(50);
    m.stores.inventory.get(P1 + '|' + WH).d.qty = 11; m.stores.inventory.get(P1 + '|' + WH).r++; m.version++;
    await w.FDB.server.check(); await sleep(400);
    check('E2 …but never under the user\'s hands while they are entering something', ev(w, `stockAt('${P1}','${WH}')`) === 500 && w.FcWH.stale === true);
    click(w, '[data-go="home"]');
    await waitUntil(() => ev(w, `stockAt('${P1}','${WH}')`) === 11);
    check('E3 …it catches up as soon as they leave the entry screen', ev(w, `stockAt('${P1}','${WH}')`) === 11 && w.FcWH.stale === false);
    await end(w);
  }
  { // offline: nothing is "saved for later"
    const m = world(); const b = await pwa(m, { offline: true }); const w = b.w;
    const r = await w.FcWH.post('RECEIVE', { warehouseId: WH, reason: 'x', items: [{ productId: P1, quantity: 5 }], clientOpId: 'off1' }).then(() => null, e => e);
    check('E4 with no connection a save is refused at once, says so, and sends nothing', r && /no internet/i.test((r.validation || []).join(' ')) && m.commits === 0 && m.count('stockDocs') === 0);
    check('E5 the home screen says nothing is stored on this device', /Nothing is stored on this device/.test(shown(w)));
    await end(w);
  }

  /* ══ F. what is shown is safe ═══════════════════════════════════════════════════════════════ */
  {
    const m = world();
    m.stores.customers.get(SHOP).d.sh = '<img src=x onerror="window.__pwned=1">Bad & "Shop"';
    m.stores.warehouses.get(WH).d.name = 'Main <b>Warehouse</b>';
    const gone = 'PRD-0002';                                        /* an inactive product with a movement */
    m.stores.stockMovements.set('mv_gone', { r: 1, d: { id: 'mv_gone', createdAt: '2026-09-20T10:00:00.000Z', date: '2026-09-20', productId: gone, warehouseId: WH, kind: 'PURCHASE_IN', qtyDelta: 5, bucket: 'stock', balanceAfter: 5, ref: 'R', refType: 'X', note: 'n', unitCostP: 0, userId: 'o' } });
    const b = await pwa(m); const w = b.w;
    click(w, '[data-go="send"]');
    check('F1 a shop name with markup cannot inject anything (shown as text)', !w.__pwned && !w.document.querySelector('#view img') && /Bad & "Shop"/.test(shown(w)));
    check('F2 …nor a warehouse name (shown as text, no element created)', !w.document.querySelector('#view .picks b b') && /Main <b>Warehouse<\/b>/.test(shown(w)), shown(w).slice(0, 160));
    click(w, '[data-go="stock"]'); click(w, '[data-tab="history"]');
    check('F3 a movement of a product that was switched off does not break the history list', /Stock/.test(shown(w)) && b.errors.length === 0 && ev(w, 'HISTORY.every(x=>!!prodOf(x.pid))'), b.errors.join(';'));
    await end(w);
  }
  { // a long shop list is searchable and capped
    const m = world(); const b = await pwa(m); const w = b.w;
    click(w, '[data-go="send"]');
    const total = w.document.querySelectorAll('[data-oshop]').length;
    typeIn(w, '#sq', 'sharmi');
    const some = w.document.querySelectorAll('[data-oshop]').length;
    check('F4 the shop list is capped at 40 and can be searched', total === 40 && some > 0 && some < 40 && /sharmi/i.test(shown(w)), `${total}/${some}`);
    check('F5 the search box keeps focus while typing', w.document.activeElement && w.document.activeElement.id === 'sq');
    await end(w);
  }

  /* ══ G. the same records as the office makes ════════════════════════════════════════════════ */
  {
    const VOL = ['id', 'createdAt', 'updatedAt', 'clientOpId', 'docId', 'createdBy', 'userId', 'userName', 'userRole', 'source', 'entityId', 'opId'];
    const norm = r => { const o = JSON.parse(JSON.stringify(r)); for (const k of VOL) delete o[k]; return JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]])); };
    const snap = m => ({
      docs: m.rows('stockDocs').map(norm).sort(), items: m.rows('stockDocItems').map(norm).sort(),
      moves: m.rows('stockMovements').filter(x => !/^mv_old/.test(x.id)).map(norm).sort(),
      inv: m.rows('inventory').map(norm).sort(), seq: m.rows('sequences').map(x => JSON.stringify([x.k, x.kind, x.year, x.n])).sort(),
      audit: m.rows('auditLog').filter(a => /StockDoc/.test(a.entity)).map(norm).sort(),
      invoices: m.rows('invoices').map(i => norm({ ...i, revision: 0 })).sort()
    });
    const steps = [
      { t: 'RECEIVE', d: { warehouseId: WH, reason: 'Received from Some Mill (Warehouse app)', items: [{ productId: P1, quantity: 120 }] } },
      { t: 'DISPATCH', d: { warehouseId: WH, customerId: SHOP, items: [{ productId: P1, quantity: 30 }] } },
      { t: 'DISPATCH', d: { warehouseId: WH, customerId: SHOP, invoiceId: 'inv-a', items: [{ productId: P2, quantity: 12 }] } },
      { t: 'DISPATCH', d: { warehouseId: WH, customerId: SHOP, invoiceId: 'inv-nt', items: [{ productId: P1, quantity: 5 }] } },
    ];
    const mo = world(), mw = world();
    const o = await office(mo), w = await pwa(mw);
    for (const s of steps) {
      await o.w.ERP.StockDocs[s.t === 'RECEIVE' ? 'receive' : 'dispatch']({ ...s.d, date: undefined, items: s.d.items.map(i => ({ ...i })) });
      await w.w.FcWH.post(s.t, { ...s.d, clientOpId: 'c' + Math.random() });
    }
    const A = snap(mo), B = snap(mw);
    check('G0 (guard against a vacuous comparison) both sides made 4 documents, 4 lines, 3 movements and used the same counters',
      A.docs.length === 4 && B.docs.length === 4 && A.items.length === 4 && A.moves.length === 3 && B.moves.length === 3 && A.seq.length === 2 && A.audit.length === 4, JSON.stringify([A.docs.length, A.items.length, A.moves.length, A.seq.length, A.audit.length]));
    for (const k of Object.keys(A)) {
      const same = JSON.stringify(A[k]) === JSON.stringify(B[k]);
      check(`G-${k} the Warehouse app's ${k} are identical to the office's (RECEIVE, DISPATCH, DISPATCH against an invoice that took the stock, against one that did not)`, same,
        same ? '' : 'office=' + JSON.stringify(A[k]).slice(0, 700) + '\n   warehouse=' + JSON.stringify(B[k]).slice(0, 700));
    }
    await end(o.w); await end(w.w);
  }

  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
process.on('uncaughtException', e => { console.log(out.join('\n')); console.error('UNCAUGHT', e && e.message); process.exit(2); });
main().catch(e => { console.log(out.join('\n')); console.error(e); process.exit(2); });
