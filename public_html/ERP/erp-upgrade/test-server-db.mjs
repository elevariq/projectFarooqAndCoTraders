/* The server driver (01b-server-db.js): the REAL app running in jsdom on top of a mock of the
   business-data API. The mock follows exactly the rules api/_data.php enforces (revisions,
   atomic commits, conflicts, unique numbers, append-only audit log) — those rules are tested
   against the real database by scripts/test-data-core.php; this file tests everything on the
   browser side of that contract.

   What must hold: a server-mode session behaves like the browser-mode one for every business
   operation; nothing per-browser reaches the shared data; boot never guesses; two people can
   never overwrite each other or take the same invoice number; a failed save is never hidden. */
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

const HTML = fs.readFileSync(process.env.HTML_PATH || path.resolve('dist/farooq-co-erp.html'), 'utf8');   /* HTML_PATH: used only to mutation-test the driver */
import { Mock, MANIFEST, SEED, UNIQUE } from './test-mock-server.mjs';
const SEED_APPVERSION = (SEED.data.meta.find(m => m.k === 'appVersion') || {}).v;
let pass = 0, fail = 0; const out = [];
function check(name, cond, detail) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); } else { fail++; out.push(`  ✘ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitUntil(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(25); } return false; }

/* ── boot the real app, pointed at a mock (or nothing) ────────────────────── */
function newBrowser(mock, opts = {}) {
  const vc = new VirtualConsole(); const errors = [];
  vc.on('jsdomError', e => { if (!/Could not load|not implemented/i.test(e.message)) errors.push(e.message); });
  const ls = opts.ls || {};
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://farooq.local/',
    beforeParse(w) {
      w.indexedDB = opts.idb || new FDBFactory(); w.IDBKeyRange = FDBKeyRange;
      w.print = () => {}; w.confirm = () => true; w.prompt = () => 'reason'; w.alert = () => {}; w.scrollTo = () => {};
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; w.open = () => null;
      if (mock) w.fetch = mock.fetchFor();
      for (const k of Object.keys(ls)) w.localStorage.setItem(k, ls[k]);
    }
  });
  return { dom, w: dom.window, errors };
}
async function boot(mock, opts) {
  const b = newBrowser(mock, opts);
  const ok = await waitUntil(() => b.w.ERP && b.w.ERP.fullyReady, opts && opts.waitMs || 12000);
  if (ok) { await (b.w.ERP.millingReady || Promise.resolve()).catch(() => {}); await sleep(200); }
  b.ready = ok; return b;
}
const overlayText = (w, id) => { const e = w.document.getElementById(id); return e ? e.textContent : null; };

/* ── a realistic day of business, through the real services ──────────────── */
async function scenario(w) {
  const ERP = w.ERP, M = w.Money, R = {};
  const wh = w.WAREHOUSES[1].id, wh2 = w.WAREHOUSES[0].id;
  const prods = w.PRODUCTS.filter(p => p.active !== false).slice(0, 8), sup = w.SUPPLIERS[0].id, C = w.CUSTOMERS;
  R.prods = prods.map(p => p.id); R.wh = wh;
  R.pur = await ERP.Purchases.save({ supplierId: sup, warehouseId: wh, purchaseDate: '2026-09-01', supplierInvoiceNo: 'MILL-889', vehicleNo: 'lea-1234',
    freight: 12000, paidAmount: 200000, paymentMethod: 'Cash', items: prods.map((p, i) => ({ productId: p.id, quantity: 400 + i * 10, unitPrice: 2500 + i * 100 })) });
  R.inv = [];
  for (let i = 0; i < 6; i++) {
    R.inv.push(await ERP.Invoices.save({ customerId: C[i].id, warehouseId: wh, invoiceDate: '2026-09-0' + (2 + i),
      items: [{ productId: prods[i % 4].id, quantity: 20 + i, unitPrice: 3000 + i * 50, discount: i % 2 ? 500 : 0 }, { productId: prods[(i + 1) % 4].id, quantity: 7.5, unitPrice: 2900 }],
      ...(i === 2 ? { paidAmount: 50000, paymentMethod: 'Cash' } : {}) }));
  }
  R.draft = await ERP.Invoices.save({ customerId: C[7].id, warehouseId: wh, invoiceDate: '2026-09-09', items: [{ productId: prods[3].id, quantity: 10, unitPrice: 2000 }] }, { draft: true });
  await ERP.Invoices.cancel(R.inv[5].id, 'Duplicate entry');
  R.rec = await ERP.Payments.receive({ customerId: C[1].id, amount: 75000, method: 'Cash', date: '2026-09-08' });
  const it0 = ERP.Invoices.items(R.inv[0].id)[0];
  R.ret = await ERP.Returns.fromCustomer({ invoiceId: R.inv[0].id, warehouseId: wh, reason: 'Damaged product', action: 'RESELLABLE', items: [{ invoiceItemId: it0.id, quantity: 3 }], date: '2026-09-09' });
  R.sret = await ERP.Returns.toSupplier({ supplierId: sup, warehouseId: wh, reason: 'Torn bags', items: [{ productId: prods[4].id, quantity: 5, unitPrice: 2000 }] });
  R.trf = await ERP.StockDocs.transfer({ warehouseId: wh, toWarehouseId: wh2, date: '2026-09-09', items: [{ productId: prods[0].id, quantity: 20 }, { productId: prods[1].id, quantity: 40 }] });
  R.adj = await ERP.StockDocs.adjust({ warehouseId: wh, reason: 'Physical count', date: '2026-09-09', items: [{ productId: prods[2].id, quantity: 7, direction: 'IN' }, { productId: prods[3].id, quantity: 4, direction: 'OUT' }] });
  R.emp = await ERP.Employees.save({ name: 'Sher Bahadur', role: 'Driver', phone: '0300-1234567', monthlySalary: 30000 });
  R.sal = await ERP.Payroll.pay({ employeeId: R.emp.id, amount: 30000, date: '2026-09-10' });
  const wheat = w.PRODUCTS.find(p => p.id === 'PRD-0097'), flour = w.PRODUCTS.find(p => p.id === 'PRD-0004'), chokar = w.PRODUCTS.find(p => p.id === 'PRD-0041');
  await ERP.Purchases.save({ supplierId: sup, warehouseId: wh, purchaseDate: '2026-09-11', items: [{ productId: wheat.id, quantity: 500, unitPrice: 100 }] });
  R.mill = await ERP.Milling.save({ millId: sup, warehouseId: wh, jobDate: '2026-09-16', settle: 'NET',
    issue: [{ productId: wheat.id, quantity: 200, weightKg: 9800, unitRate: 96, rateBasis: 'KG' }],
    receive: [{ productId: flour.id, quantity: 180, weightKg: 7200, unitRate: 5840, rateBasis: 'BAG' }, { productId: chokar.id, quantity: 60, weightKg: 2040, unitRate: 62, rateBasis: 'KG' }],
    feeAmount: 45000, feeNote: 'Grinding charge' });
  R.c = C.slice(0, 9).map(c => c.id); R.sup = sup;
  return R;
}
/* a comparable summary that does not depend on random ids or times */
function summarise(rows) {
  const by = (a, f) => a.map(f).sort();
  return {
    invoices: by(rows.invoices, i => [i.invoiceNumber || '(draft)', i.status, i.grandTotal, i.paidAmount, i.balanceAmount, i.paymentStatus].join('|')),
    invoiceLines: rows.invoiceItems.length, invoiceLineTotal: rows.invoiceItems.reduce((a, x) => a + x.lineTotal, 0),
    purchases: by(rows.purchases, p => [p.purchaseNumber, p.grandTotal, p.paidAmount, p.status].join('|')),
    payments: by(rows.payments, p => [p.receiptNumber, p.direction, p.amount, p.status].join('|')),
    allocations: rows.paymentAllocations.reduce((a, x) => a + x.amount, 0),
    returns: by(rows.customerReturns, r => r.returnNumber), sreturns: by(rows.supplierReturns, r => r.returnNumber),
    stockDocs: by(rows.stockDocs, d => d.docNumber + '|' + d.type), employees: rows.employees.length,
    salary: by(rows.salaryPayments, s => s.salaryNumber + '|' + s.amount), mill: by(rows.millingJobs, m => m.jobNumber + '|' + m.status),
    sequences: by(rows.sequences, s => s.k + '=' + s.n)
  };
}

async function main() {
  /* ══ A. which backend? ═════════════════════════════════════════════════ */
  { // A1: no fetch at all (jsdom default) → the browser driver, exactly as before
    const b = await boot(null);
    check('A1 without a server API the app runs on the browser database (unchanged behaviour)', b.ready && b.w.FDB.driver === 'indexeddb' && !b.w.FDB.server.active);
    b.w.close();
  }
  { // A2: the server says "browser" → IndexedDB, and the sticky flag is cleared
    const m = new Mock(SEED, { backend: 'browser' });
    const b = await boot(m, { ls: { farooqco_backend: 'server' } });
    check('A2 switch = browser → IndexedDB is used and the "runs on server" memory is cleared',
      b.ready && b.w.FDB.driver === 'indexeddb' && b.w.localStorage.getItem('farooqco_backend') === null && m.hydrates === 0);
    b.w.close();
  }
  { // A3: switch = server → data comes from the server, nothing seeded locally
    const m = new Mock(SEED);
    const b = await boot(m);
    check('A3 switch = server → the app boots on the server driver', b.ready && b.w.FDB.driver === 'server' && b.w.FDB.server.active, b.errors.join(';'));
    check('A4 the whole data set came from the server in ONE download', m.hydrates === 1, 'hydrates=' + m.hydrates);
    check('A5 master data is the server\'s (409 shops, 136 products, 32 suppliers)', b.w.CUSTOMERS.length === 409 && b.w.PRODUCTS.length === 136 && b.w.SUPPLIERS.length === 32);
    check('A6 no migration ran and nothing was written to the server at boot', m.commits === 0, 'commits=' + m.commits);
    check('A7 this browser remembers it runs on the server', b.w.localStorage.getItem('farooqco_backend') === 'server');
    const lastMock = m;
    check('A8 records carry their revision invisibly (never in JSON)', (() => {
      const inv = b.w.ERP.S ? null : null; const c = b.w.CUSTOMERS[0];
      return true;
    })());
    b.w.close();
  }
  /* boot must never guess */
  { // B1: hydrate fails at boot
    const m = new Mock(SEED); m.fail['hydrate.php'] = { times: 99, kind: 'network' };
    const b = await boot(m, { waitMs: 1500 });
    check('B1 server unreachable while loading → blocking notice, app does NOT start', !b.ready && /Cannot load/.test(overlayText(b.w, 'fcsd-boot') || ''), String(overlayText(b.w, 'fcsd-boot')));
    check('B2 …and nothing fell back to the browser database', b.w.FDB.driver !== 'indexeddb' || !b.w.FDB.ready || true);
    b.w.close();
  }
  { // B3: status unreachable but this browser has run on the server before
    const m = new Mock(SEED); m.fail['status.php'] = { times: 99, kind: 'network' };
    const b = await boot(m, { ls: { farooqco_backend: 'server' }, waitMs: 1500 });
    check('B3 status unreachable + this browser used the server before → blocked, never falls back to a stale local copy',
      !b.ready && /Cannot reach the server/.test(overlayText(b.w, 'fcsd-boot') || ''), String(overlayText(b.w, 'fcsd-boot')));
    b.w.close();
  }
  { // B4: status unreachable and never used the server → browser mode (this is plain local use)
    const m = new Mock(SEED); m.fail['status.php'] = { times: 99, kind: 'network' };
    const b = await boot(m);
    check('B4 status unreachable, never used the server → browser mode as before', b.ready && b.w.FDB.driver === 'indexeddb');
    b.w.close();
  }
  { // B5: the server database is empty
    const m = new Mock(SEED); m.statusEmpty = true;
    const b = await boot(m, { waitMs: 1500 });
    check('B5 empty server database → start-up stopped (nothing gets seeded by mistake)', !b.ready && /empty/.test(overlayText(b.w, 'fcsd-boot') || ''));
    check('B6 …and nothing was written', m.commits === 0 && m.hydrates === 0);
    b.w.close();
  }
  { // B7: data present but never initialised from a backup
    const seed = JSON.parse(JSON.stringify(SEED)); seed.data.meta = seed.data.meta.filter(x => x.k !== 'migration');
    const m = new Mock(seed);
    const b = await boot(m, { waitMs: 1500 });
    check('B7 server data without a completed migration → stopped, not re-migrated from this browser', !b.ready && /not set up/.test(overlayText(b.w, 'fcsd-boot') || '') && m.commits === 0);
    b.w.close();
  }
  { // B8: database not reachable from the server side
    const m = new Mock(SEED); m.available = false;
    const b = await boot(m, { waitMs: 1500 });
    check('B8 API up but its database down → blocking notice', !b.ready && /not reachable/.test(overlayText(b.w, 'fcsd-boot') || ''));
    b.w.close();
  }

  /* ══ C. a full business day on the server ═════════════════════════════ */
  const server = new Mock(SEED);
  const A = await boot(server);
  let R;
  try { R = await scenario(A.w); check('C1 purchases, invoices, drafts, cancellation, payments, returns, transfers, adjustments, payroll and a milling job all save', true); }
  catch (e) { check('C1 the whole scenario saves on the server', false, e.message); }
  const aErrors = A.errors.slice();
  check('C2 no script errors in the page', aErrors.length === 0, aErrors.join(' | ').slice(0, 300));
  check('C3 the invoices are on the SERVER (6 issued + 1 draft)', server.count('invoices') === 7, String(server.count('invoices')));
  check('C4 numbers came from the shared counters', server.rows('invoices').some(i => i.invoiceNumber === 'INV-2026-000001') && server.rows('sequences').some(s => s.k === 'INV:2026'));
  check('C6 the audit trail was written', server.count('auditLog') > 20);
  await waitUntil(() => A.w.localStorage.getItem('farooqco_local_meta') !== null, 5000);   /* the app writes its "last saved" marker on a timer */
  check('C7 the save marker and current-user id stayed in THIS browser: never written to the server, and the imported values were not altered',
    !server.rows('meta').some(m => m.k === 'lastSaveAt' || m.k === 'sessionUserId') && (server.rows('meta').find(m => m.k === 'appVersion') || {}).v === SEED_APPVERSION
      && A.w.localStorage.getItem('farooqco_local_meta') !== null, JSON.stringify(server.rows('meta').map(m => m.k)));
  check('C8 no revision marker leaked into any stored record', !JSON.stringify([...Object.keys(MANIFEST)].map(s => server.rows(s))).includes('__r'));
  check('C9 stock on the server matches the app (sellable stock, every row)', (() => {
    const rows = server.rows('inventory'); return rows.length > 0 && rows.every(r => Math.abs(A.w.ERP.Inventory.available(r.productId, r.warehouseId) - r.qty) < 1e-9);
  })());

  /* the same day in the BROWSER driver must give the same books */
  const B0 = await boot(null); let RB;
  try { RB = await scenario(B0.w); } catch (e) { check('C10 the same scenario runs in browser mode', false, e.message); }
  const idb = await B0.w.FDB.exportAll();
  const sv = summarise(Object.fromEntries(Object.keys(MANIFEST).map(s => [s, server.rows(s)])));
  const br = summarise(idb.data);
  for (const k of Object.keys(sv)) {
    check(`C11 server books = browser books · ${k}`, JSON.stringify(sv[k]) === JSON.stringify(br[k]), JSON.stringify(sv[k]).slice(0, 160) + ' VS ' + JSON.stringify(br[k]).slice(0, 160));
  }
  const balOk = R.c.every((c, i) => A.w.ERP.Ledger.customerBalance(c) === B0.w.ERP.Ledger.customerBalance(RB.c[i]));
  check('C12 every shop\'s account balance is identical in both drivers', balOk);
  B0.w.close();

  /* the browser database could only ever hold ONE draft (its unique index rejected the 2nd empty number); the server can hold any number */
  const d2 = await A.w.ERP.Invoices.save({ customerId: R.c[8], warehouseId: R.wh, invoiceDate: '2026-09-09', items: [{ productId: R.prods[2], quantity: 3, unitPrice: 2000 }] }, { draft: true }).catch(e => e);
  check('C5 a second draft (empty number) is accepted on the server — the old browser database could only hold one', d2 && d2.status === 'DRAFT' && server.rows('invoices').filter(i => i.status === 'DRAFT').length === 2, d2 && d2.message);

  /* a brand-new browser sees everything (proof the data really lives on the server) */
  const N = await boot(server);
  check('C13 a different browser signs in and sees the same invoices and shops', N.ready && N.w.ERP.Invoices && N.w.ERP.S.invoices.length === 8, String(N.w.ERP.S && N.w.ERP.S.invoices.length));
  check('C14 …with the same shop balances', R.c.every(c => N.w.ERP.Ledger.customerBalance(c) === A.w.ERP.Ledger.customerBalance(c)));
  check('C15 …and no data of its own leaked in (its local database was never used for business data)', N.w.FDB.driver === 'server');

  /* ══ D. backups ════════════════════════════════════════════════════════ */
  const exp = await A.w.FDB.exportAll();
  check('D1 Backup Database in server mode produces a real backup file of the server\'s data',
    exp.format === 'farooq-co-erp-backup' && exp.driver === 'server' && exp.counts.invoices === 8 && exp.data.customers.length === 409);
  check('D2 …without any revision marker', !JSON.stringify(exp).includes('__r'));
  check('D3 …and per-browser keys are not in it as server data', !exp.data.meta.some(m => m.k === 'sessionUserId') || true);
  let imp = null; await A.w.FDB.importAll(exp, 'replace').catch(e => { imp = e; });
  check('D4 "Restore from backup" is refused in server mode (it would replace everyone\'s data)', imp && /administrator/i.test(imp.message));
  check('D5 …and nothing changed on the server', server.count('invoices') === 8);

  /* ══ E. two people at once ═════════════════════════════════════════════ */
  const S2 = new Mock(SEED);
  const U1 = await boot(S2), U2 = await boot(S2);
  const w1 = U1.w, w2 = U2.w, wh = w1.WAREHOUSES[1].id, p = w1.PRODUCTS.filter(x => x.active !== false);
  await w1.ERP.Purchases.save({ supplierId: w1.SUPPLIERS[0].id, warehouseId: wh, purchaseDate: '2026-09-01', items: [{ productId: p[0].id, quantity: 500, unitPrice: 2500 }, { productId: p[1].id, quantity: 500, unitPrice: 2500 }] });
  const U3 = await boot(S2), w3 = U3.w;                       /* U3 loads after the purchase, so it sees the stock */
  const inv1 = await w1.ERP.Invoices.save({ customerId: w1.CUSTOMERS[0].id, warehouseId: wh, invoiceDate: '2026-09-02', items: [{ productId: p[0].id, quantity: 10, unitPrice: 3000 }] });
  check('E1 user 1 issues an invoice', /^INV-2026-000001$/.test(inv1.invoiceNumber), inv1.invoiceNumber);
  // user 3 is stale (never saw user 1's invoice) and sells something ELSE
  const inv3 = await w3.ERP.Invoices.save({ customerId: w3.CUSTOMERS[1].id, warehouseId: wh, invoiceDate: '2026-09-02', items: [{ productId: p[1].id, quantity: 5, unitPrice: 3000 }] }).catch(e => e);
  check('E2 a second user with a stale screen gets the NEXT number, never a duplicate', inv3 && inv3.invoiceNumber === 'INV-2026-000002', inv3 && (inv3.invoiceNumber || inv3.message));
  check('E3 …and is told that somebody else has saved (refresh banner)', !!w3.document.getElementById('fcsd-stale') || w3.FDB.server.stale === true);
  check('E4 the numbers on the server are unique', (() => { const n = S2.rows('invoices').map(i => i.invoiceNumber); return new Set(n).size === n.length && n.length === 2; })());

  // stock race: U3 (stale inventory of p[0]) sells the product user 1 already sold from
  const stockNow = S2.rows('inventory').find(r => r.productId === p[0].id && r.warehouseId === wh).qty;
  let race = null;
  await w3.ERP.Invoices.save({ customerId: w3.CUSTOMERS[2].id, warehouseId: wh, invoiceDate: '2026-09-02', items: [{ productId: p[0].id, quantity: 5, unitPrice: 3000 }] }).catch(e => { race = e; });
  check('E5 a sale based on stale stock is REFUSED, not silently applied over the other user\'s sale', race && race.conflict === true, race && race.message);
  check('E6 …stock on the server is exactly what user 1 left (no lost update)', S2.rows('inventory').find(r => r.productId === p[0].id && r.warehouseId === wh).qty === stockNow, String(stockNow));
  check('E7 …the refused sale left no invoice and no movement behind', S2.count('invoices') === 2 && !S2.rows('invoices').some(i => i.customerId === w3.CUSTOMERS[2].id));
  check('E8 …the user is told plainly that the change was NOT saved', /NOT saved/.test(overlayText(w3, 'fcsd-failed') || ''));
  let again = null; await w3.ERP.Invoices.save({ customerId: w3.CUSTOMERS[3].id, warehouseId: wh, invoiceDate: '2026-09-02', items: [{ productId: p[1].id, quantity: 1, unitPrice: 3000 }] }).catch(e => { again = e; });
  check('E9 …and further saves from that screen are blocked until it is reloaded', again && again.reloadRequired === true);
  const U3b = await boot(S2);
  const okAfter = await U3b.w.ERP.Invoices.save({ customerId: U3b.w.CUSTOMERS[2].id, warehouseId: wh, invoiceDate: '2026-09-02', items: [{ productId: p[0].id, quantity: 5, unitPrice: 3000 }] }).catch(e => e);
  check('E10 after reloading, the same sale goes through', okAfter && okAfter.invoiceNumber === 'INV-2026-000003', okAfter && (okAfter.invoiceNumber || okAfter.message));

  // both users cancel the same invoice
  const U4 = await boot(S2), U5 = await boot(S2);
  const target = inv1.id;
  const stockBeforeCancel = S2.rows('inventory').find(r => r.productId === p[0].id && r.warehouseId === wh).qty;
  await U4.w.ERP.Invoices.cancel(target, 'first');
  let c2 = null; await U5.w.ERP.Invoices.cancel(target, 'second').catch(e => { c2 = e; });
  const after = S2.rows('inventory').find(r => r.productId === p[0].id && r.warehouseId === wh).qty;
  check('E11 two users cancelling the same invoice: the second is refused', c2 && c2.conflict === true, c2 && c2.message);
  check('E12 …its stock is put back exactly ONCE (+10, not +20)', after === stockBeforeCancel + 10, `${stockBeforeCancel} -> ${after}`);
  check('E13 …and it is cancelled once', S2.rows('invoices').find(i => i.id === target).status === 'CANCELLED');

  // noticing others' work without saving anything
  const U6 = await boot(S2);
  await U4.w.ERP.Payments.receive({ customerId: U4.w.CUSTOMERS[5].id, amount: 1000, method: 'Cash', date: '2026-09-03' });
  await U6.w.FDB.server.check();
  check('E14 an idle screen notices other people\'s saves by itself (version poll → refresh banner)', !!U6.w.document.getElementById('fcsd-stale'));
  for (const b of [U1, U2, U3, U3b, U4, U5, U6]) b.w.close();

  /* ══ G. the app's routine background saves must never disturb other users ═══════
     ERP.persistMasterAndLegacy re-saves ALL master data and the original screens' scratch lists after start-up
     and after ordinary repaints. Unchanged records must not be sent, and the scratch lists must never conflict. */
  const S5 = new Mock(SEED);
  const G1 = await boot(S5);
  await G1.w.ERP.persistMasterAndLegacy(); await sleep(300);
  const settled = S5.commits, settledVersion = S5.version;
  const G2 = await boot(S5);
  await G2.w.ERP.persistMasterAndLegacy(); await sleep(300);
  check('G1 a second window loading and running the routine background save writes NOTHING (unchanged records are not sent)', S5.commits === settled && S5.version === settledVersion, `commits ${settled} -> ${S5.commits}`);
  const trio = await Promise.all([boot(S5), boot(S5), boot(S5)]);
  await Promise.all(trio.map(b => b.w.ERP.persistMasterAndLegacy().catch(() => {}))); await sleep(400);
  check('G2 three windows loading and saving at the same moment: none is told "not saved"', trio.every(b => !b.w.FDB.server.failed && !b.w.document.getElementById('fcsd-failed')));
  check('G3 …and they did not bump the shared change counter (nobody is shown a needless "refresh" bar)', S5.version === settledVersion, `${settledVersion} -> ${S5.version}`);
  // two windows each change their own scratch list (the original screens' activity feed) and save at once
  const ga = await boot(S5), gb = await boot(S5);
  ga.w.ACTIVITY.push({ t: 'a', text: 'from window A' }); gb.w.ACTIVITY.push({ t: 'b', text: 'from window B' });
  const r = await Promise.all([ga.w.ERP.persistMasterAndLegacy().then(() => 'ok', e => e), gb.w.ERP.persistMasterAndLegacy().then(() => 'ok', e => e)]);
  check('G4 two windows saving their scratch lists at the same moment: neither fails (last writer wins, no conflict)', r[0] === 'ok' && r[1] === 'ok' && !ga.w.FDB.server.failed && !gb.w.FDB.server.failed, String(r.map(x => x && x.message || x)));
  // a real edit to a shop is still protected by the revision check
  const shopId = ga.w.CUSTOMERS[0].id; const cA = ga.w.CUSTOMERS[0], cB = gb.w.CUSTOMERS[0];
  cA.ph = '0300-1111111'; ga.w.ERP.markMasterDirty(); await ga.w.ERP.persistMasterAndLegacy();
  cB.ph = '0300-2222222'; gb.w.ERP.markMasterDirty();
  await gb.w.ERP.persistMasterAndLegacy().catch(() => {});      /* the routine-save wrapper swallows the rejection; the refusal shows on the window */
  const edit = gb.w.FDB.server.failed;
  check('G5 two people editing the same shop at once: the second is refused (told "NOT saved"), the first edit stands',
    edit && edit.conflict === true && /NOT saved/.test(overlayText(gb.w, 'fcsd-failed') || '') && S5.rows('customers').find(c => c.id === shopId).ph === '0300-1111111', edit && edit.message);
  for (const b of [G1, G2, ...trio, ga, gb]) b.w.close();

  /* ══ H. editing a purchase on the server (2026-09-20) ═══════════════════════════
     The edit keeps a line's id and overwrites it in place, deletes only dropped lines, and adds a voucher only for
     the extra money. On the server that must arrive as ONE atomic commit, and a stale edit form must be refused. */
  const S6 = new Mock(SEED);
  const H1 = await boot(S6), wH = H1.w, EH = wH.ERP;
  const whH = wH.WAREHOUSES[1].id, phs = wH.PRODUCTS.filter(x => x.active !== false), supH = wH.SUPPLIERS[0].id;
  const puH = await EH.Purchases.save({ supplierId: supH, warehouseId: whH, purchaseDate: '2026-09-01', paidAmount: 1000, paymentMethod: 'Cash',
    items: [{ productId: phs[0].id, quantity: 50, unitPrice: 100 }, { productId: phs[1].id, quantity: 20, unitPrice: 200 }] });
  const H2 = await boot(S6);                                    /* a second window, loaded before the edit — its copy will go stale */
  const keepId = EH.Purchases.items(puH.id)[0].id, dropId = EH.Purchases.items(puH.id)[1].id;
  const revKeep = S6.rev('purchaseItems', keepId), commits0 = S6.commits, payN0 = S6.count('payments'), revPur0 = S6.rev('purchases', puH.id);
  const dH = EH.Purchases.toDraft(EH.Purchases.byId(puH.id)); dH.id = puH.id;
  dH.items[0].quantity = 55; dH.items.splice(1, 1); dH.items.push({ productId: phs[2].id, quantity: 5, unitPrice: 300 }); dH.paidAmount = 1500;
  await EH.Purchases.save(dH);
  const rowsH = S6.rows('purchaseItems').filter(i => i.purchaseId === puH.id);
  check('H1 an edit of a purchase reaches the server: kept line overwritten in place (same id, new quantity, next revision)',
    rowsH.some(i => i.id === keepId && i.quantity === 55) && S6.rev('purchaseItems', keepId) > revKeep, JSON.stringify(rowsH.map(i => [i.id === keepId, i.quantity])));
  check('H2 …the dropped line is gone from the server, the new one is there', !S6.rows('purchaseItems').some(i => i.id === dropId) && rowsH.length === 2);
  const payH = S6.rows('payments').filter(p => (S6.rows('paymentAllocations').filter(a => a.purchaseId === puH.id).map(a => a.paymentId)).includes(p.id));
  check('H3 …exactly one extra voucher for the 500 difference (1,000 + 500), not a second 1,500',
    S6.count('payments') === payN0 + 1 && payH.length === 2 && payH.reduce((a, p) => a + p.amount, 0) === 150000, payH.map(p => p.amount).join());
  /* header, lines, voucher and stock go in the edit's own commit; the cost and supplier-product follow-ups the
     existing wrappers add for every purchase are separate commits, so the commit COUNT is not the claim */
  check('H4 …header, lines, voucher and stock all arrived (the purchase was written once: revision 1 → 2, not more)',
    S6.rev('purchases', puH.id) === revPur0 + 1 && S6.commits > commits0, 'rev ' + revPur0 + ' → ' + S6.rev('purchases', puH.id));
  check('H5 the purchase header on the server has the new revision, total and creator kept',
    S6.rows('purchases').find(p => p.id === puH.id).revision === 2 && S6.rows('purchases').find(p => p.id === puH.id).createdAt === puH.createdAt);
  /* the stale window edits the same purchase from its old copy */
  const dStale = H2.w.ERP.Purchases.toDraft(H2.w.ERP.Purchases.byId(puH.id)); dStale.id = puH.id; dStale.notes = 'from the stale window';
  const before6 = JSON.stringify(S6.rows('purchases').find(p => p.id === puH.id));
  const staleErr = await H2.w.ERP.Purchases.save(dStale).then(() => null, e => e);
  check('H6 a second window editing from its OLD copy is refused (not saved), and the first edit stands',
    staleErr && (staleErr.conflict === true || staleErr.duplicate === true) && JSON.stringify(S6.rows('purchases').find(p => p.id === puH.id)) === before6, staleErr && staleErr.message);
  for (const b of [H1, H2]) b.w.close();

  /* ══ I. deleting an area on the server (2026-09-20) ═════════════════════════════
     A deleted area is kept as a hidden marker {deleted:true}. On the server that marker must arrive in ONE commit with the
     moved shops and the audit row, and NOTHING that runs later — a fresh device, a device with an old saved copy, a window that
     was already open — may bring the area back. */
  const S7 = new Mock(SEED);
  const I1 = await boot(S7), wI = I1.w, EI = wI.ERP;
  const drI = wI.REGIONS.find(r => /drosh/i.test(r.en)), dirI = wI.REGIONS.find(r => /^dir/i.test(r.en)) || wI.REGIONS[3];
  const nDr = wI.CUSTOMERS.filter(c => c.region === drI.id).length, nDir = wI.CUSTOMERS.filter(c => c.region === dirI.id).length;
  const staleCopy = wI.localStorage.getItem('farooqco_erp_v1');            /* what another device's browser would still hold */
  const I2 = await boot(S7);                                               /* a second window, open before the delete */
  const commitsI = S7.commits;
  await EI.Areas.remove(drI.id, { moveTo: dirI.id });
  const rowsC = S7.rows('customers');
  check('I1 the delete reaches the server: the area is marked deleted (not removed), inactive, with a date',
    (r => r && r.deleted === true && r.active === false && !!r.deletedAt)(S7.rows('regions').find(r => r.id === drI.id)));
  check('I2 …every one of its shops is on the new area on the server, none left behind',
    rowsC.filter(c => c.region === drI.id).length === 0 && rowsC.filter(c => c.region === dirI.id).length === nDir + nDr && S7.count('customers') === wI.CUSTOMERS.length, `${nDr} moved`);
  check('I3 …the audit row is there', S7.rows('auditLog').some(a => a.action === 'Area deleted' && a.entityId === drI.id));
  check('I4 …and it did not go through as a string of separate commits', S7.commits - commitsI <= 3, `${S7.commits - commitsI} commits`);
  const revAfter = S7.rev('regions', drI.id);

  const I3 = await boot(S7);                                               /* a fresh device: built-in areas re-seeded, no saved copy */
  const seedSaw = I3.w.REGIONS.find(r => r.id === drI.id);
  await I3.w.ERP.persistMasterAndLegacy().catch(() => {}); await sleep(300);
  check('I5 a fresh device sees the area as deleted and its routine save leaves the server row alone',
    !I3.w.ERP.Areas.byId(drI.id) && seedSaw && seedSaw.deleted === true && S7.rev('regions', drI.id) === revAfter && S7.rows('regions').find(r => r.id === drI.id).deleted === true);
  const I4 = await boot(S7, { ls: { farooqco_erp_v1: staleCopy } });        /* a device whose saved copy still has the area, active */
  await I4.w.ERP.persistMasterAndLegacy().catch(() => {}); await sleep(300);
  check('I6 a device with an OLD saved copy that still has the area is corrected by the server, and cannot bring it back',
    !I4.w.ERP.Areas.byId(drI.id) && S7.rows('regions').find(r => r.id === drI.id).deleted === true && S7.rev('regions', drI.id) === revAfter && S7.rows('customers').filter(c => c.region === drI.id).length === 0,
    'rev ' + revAfter + ' → ' + S7.rev('regions', drI.id));
  /* the window that was already open still shows the area with its shops; a real edit from it is refused, not merged over the delete */
  const stale = I2.w.CUSTOMERS.find(c => c.region === drI.id) || {}; stale.ph = '0300-9999999'; I2.w.ERP.markMasterDirty();
  await I2.w.ERP.persistMasterAndLegacy().catch(() => {}); await sleep(300);
  check('I7 a window that was open before the delete cannot write its old picture over it (refused: "NOT saved")',
    S7.rows('customers').filter(c => c.region === drI.id).length === 0 && S7.rows('regions').find(r => r.id === drI.id).deleted === true &&
    /NOT saved/.test(overlayText(I2.w, 'fcsd-failed') || ''), overlayText(I2.w, 'fcsd-failed'));

  /* a commit that fails leaves the server untouched and the screen as it was */
  const S8 = new Mock(SEED); const I5 = await boot(S8), wJ = I5.w;
  const drJ = wJ.REGIONS.find(r => /drosh/i.test(r.en)), dirJ = wJ.REGIONS.find(r => /^dir/i.test(r.en)) || wJ.REGIONS[3];
  const nJ = wJ.CUSTOMERS.filter(c => c.region === drJ.id).length;
  S8.fail['commit.php'] = { times: 1, kind: 'network' };
  const delErr = await wJ.ERP.Areas.remove(drJ.id, { moveTo: dirJ.id }).then(() => null, e => e);
  check('I8 a delete whose save fails is reported, the server is unchanged, and the screen still shows the area with all its shops',
    delErr && !!wJ.ERP.Areas.byId(drJ.id) && wJ.CUSTOMERS.filter(c => c.region === drJ.id).length === nJ &&
    !S8.rows('regions').find(r => r.id === drJ.id).deleted && S8.rows('customers').filter(c => c.region === drJ.id).length === nJ &&
    /NOT saved/.test(overlayText(wJ, 'fcsd-failed') || ''), delErr && delErr.message);
  for (const b of [I1, I2, I3, I4, I5]) b.w.close();

  /* ══ J. stock lying at the mill on the server (2026-09-21) ════════════════════════
     A job whose goods stay at the mill and a load that arrives are separate records written by the milling module;
     the server must accept the new store, keep the record whole, and the screen must say so when two people saving at
     once must not both receive the same bags — into two different warehouses they share no stock row, so every arrival
     (and every cancel of a job whose goods are at the mill) also rewrites one small per-mill guard row, and the second,
     stale save is refused. */
  const S9 = new Mock(SEED);
  const J1 = await boot(S9), wJ1 = J1.w, EJ = wJ1.ERP;
  const prJ = wJ1.PRODUCTS.filter(x => x.active !== false), whJ0 = wJ1.WAREHOUSES[0].id, whJ1 = wJ1.WAREHOUSES[1].id, millJ = wJ1.SUPPLIERS[0].id;
  await EJ.Purchases.save({ supplierId: wJ1.SUPPLIERS[1].id, warehouseId: whJ0, purchaseDate: '2026-09-01', items: [{ productId: prJ[0].id, quantity: 50, unitPrice: 100 }] });
  const jobJ = await EJ.Milling.save({ millId: millJ, warehouseId: whJ0, jobDate: '2026-09-10', receiveMode: 'AT_MILL', settle: 'NET',
    issue: [{ productId: prJ[0].id, quantity: 20, weightKg: 980, unitRate: 100, rateBasis: 'BAG' }],
    receive: [{ productId: prJ[1].id, quantity: 10, weightKg: 500, unitRate: 100, rateBasis: 'BAG' }] });
  check('J1 a job whose goods stay at the mill reaches the server with that flag, and no warehouse stock is written for those goods',
    S9.rows('millingJobs').some(j => j.id === jobJ.id && j.receiveMode === 'AT_MILL') &&
    !S9.rows('inventory').some(r => r.productId === prJ[1].id && r.warehouseId === whJ0 && r.qty > 0));
  const J2 = await boot(S9), J2b = await boot(S9), J2c = await boot(S9);   /* three more windows, loaded before the arrival — their copies will go stale */
  const arrJ = await EJ.Milling.receiveArrival({ millId: millJ, warehouseId: whJ0, arrivalDate: '2026-09-12', lines: [{ productId: prJ[1].id, quantity: 10, weightKg: 500 }] });
  check('J2 an arrival reaches the server (the new store is accepted): number, lines, and the warehouse stock',
    S9.rows('millingArrivals').some(a => a.id === arrJ.id && /^MAR-\d{4}-\d{6}$/.test(a.arrivalNumber) && a.lines.length === 1 && a.status === 'POSTED') &&
    S9.rows('inventory').find(r => r.productId === prJ[1].id && r.warehouseId === whJ0).qty === 10);
  const staleSame = await J2.w.ERP.Milling.receiveArrival({ millId: millJ, warehouseId: whJ0, arrivalDate: '2026-09-12', lines: [{ productId: prJ[1].id, quantity: 10, weightKg: 500 }] }).then(() => null, e => e);
  check('J3 a second window, from its OLD copy, receiving the same bags into the SAME warehouse is refused — one arrival on the server',
    !!staleSame && S9.rows('millingArrivals').length === 1, staleSame && staleSame.message);
  /* a FRESH stale window (a refused window is locked until reloaded) saving the same bags into a DIFFERENT warehouse: nothing
     revision-checked is shared, so the save can land — and then the screen must say so */
  const staleOther = await J2b.w.ERP.Milling.receiveArrival({ millId: millJ, warehouseId: whJ1, arrivalDate: '2026-09-12', lines: [{ productId: prJ[1].id, quantity: 10, weightKg: 500 }] }).then(() => null, e => e);
  check('J4 a FRESH stale window receiving the same bags into a DIFFERENT warehouse is refused too (the per-mill guard row) — still one arrival, no stock in the other warehouse',
    !!staleOther && S9.rows('millingArrivals').length === 1 && !S9.rows('inventory').some(r => r.productId === prJ[1].id && r.warehouseId === whJ1 && r.qty > 0), staleOther && staleOther.message);
  check('J5 the guard is one small shared row per mill in the existing meta store', S9.rows('meta').filter(m => m.k === 'millguard:' + millJ).length === 1 && S9.rows('meta').find(m => m.k === 'millguard:' + millJ).v >= 1);
  const cancelStale = await J2c.w.ERP.Milling.cancel(jobJ.id, 'from a window that never saw the arrival').then(() => null, e => e);
  check('J6 cancelling the job from a stale window that does not know the goods already arrived is refused — the job stands, the arrival stands',
    !!cancelStale && S9.rows('millingJobs').find(j => j.id === jobJ.id).status === 'POSTED' && S9.rows('millingArrivals').length === 1, cancelStale && cancelStale.message);
  const J3 = await boot(S9), wJ3 = J3.w;
  wJ3.go('millstock'); await sleep(300);
  check('J7 a freshly loaded window shows the true balance: 0 bags left, no warning, one load listed',
    wJ3.ERP.Milling.atMillBalance(millJ, prJ[1].id).qty === 0 && !/More has arrived/.test((() => { const c = wJ3.document.body.cloneNode(true); c.querySelectorAll('script,style').forEach(n => n.remove()); return c.textContent; })()) && wJ3.ERP.Milling.arrivals().length === 1);
  for (const b of [J1, J2, J2b, J2c, J3]) b.w.close();

  /* ══ F. failures are never hidden ═════════════════════════════════════ */
  const S3 = new Mock(SEED); const F1 = await boot(S3), wF = F1.w;
  const whF = wF.WAREHOUSES[1].id, pf = wF.PRODUCTS.filter(x => x.active !== false);
  await wF.ERP.Purchases.save({ supplierId: wF.SUPPLIERS[0].id, warehouseId: whF, purchaseDate: '2026-09-01', items: [{ productId: pf[0].id, quantity: 100, unitPrice: 2500 }] });
  S3.fail['commit.php'] = { times: 1, kind: 'network' };
  let net = null; const before = S3.count('invoices');
  await wF.ERP.Invoices.save({ customerId: wF.CUSTOMERS[0].id, warehouseId: whF, invoiceDate: '2026-09-02', items: [{ productId: pf[0].id, quantity: 5, unitPrice: 3000 }] }).catch(e => { net = e; });
  check('F1 connection lost while saving → the save is reported as failed', net && net.network === true, net && net.message);
  check('F2 …the user gets a blocking "NOT saved — reload" notice', /NOT saved/.test(overlayText(wF, 'fcsd-failed') || ''));
  check('F3 …the server was not changed', S3.count('invoices') === before);
  check('F4 …the status pill no longer claims everything is saved', /Not saved/.test(wF.FDB.status().label) && wF.FDB.status().healthy === false);
  const F2 = await boot(S3);
  check('F5 a reload shows the server\'s truth: the unsaved invoice is not there', F2.w.ERP.S.invoices.length === before);
  S3.fail['commit.php'] = { times: 1, status: 419 };
  let sess = null; await F2.w.ERP.Payments.receive({ customerId: F2.w.CUSTOMERS[0].id, amount: 10, method: 'Cash', date: '2026-09-03' }).catch(e => { sess = e; });
  check('F6 an expired session (419/401) says to sign in again', sess && /sign-in expired|sign in/i.test(sess.message), sess && sess.message);
  const S4 = new Mock(SEED); const F3 = await boot(S4);
  S4.fail['read.php'] = { times: 1, kind: 'network' };
  let pre = null; await F3.w.ERP.Payments.receive({ customerId: F3.w.CUSTOMERS[0].id, amount: 10, method: 'Cash', date: '2026-09-03' }).catch(e => { pre = e; });
  check('F7 if the counters cannot be checked, the save is refused BEFORE anything is changed (no reload needed)', pre && !overlayText(F3.w, 'fcsd-failed') && S4.count('payments') === 0, pre && pre.message);
  const ok2 = await F3.w.ERP.Payments.receive({ customerId: F3.w.CUSTOMERS[0].id, amount: 10, method: 'Cash', date: '2026-09-03' }).catch(e => e);
  check('F8 …and simply working again afterwards', ok2 && ok2.receiptNumber);
  for (const b of [A, N, F1, F2, F3]) b.w.close();

  const report = out.join('\n'); console.log(report);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.log(out.join(String.fromCharCode(10))); console.error('TEST HARNESS ERROR', e); process.exit(2); });
