/* Module 43 + the Warehouse page — A RELOAD STAYS ON THE SCREEN (no more Dashboard).
   Each "reload" is a NEW window over the same browser-tab storage (sessionStorage), the same
   IndexedDB and the same localStorage — exactly what a real reload keeps. A "new tab" is a new
   window with empty sessionStorage. Nothing here touches a network. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
import { webcrypto } from 'crypto';

const ERP_HTML = fs.readFileSync('dist/farooq-co-erp.html', 'utf8');
const WH_HTML = fs.readFileSync('dist/farooq-co-warehouse-pwa.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
const check = (n, c, d) => { if (c) { pass++; out.push('  ✔ ' + n); } else { fail++; out.push('  ✘ ' + n + (d ? '   → ' + d : '')); } };
const errors = [];

const mapStore = m => ({ getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } });
const newTab = () => ({ idb: new FDBFactory(), ls: {}, ss: {} });

function boot(html, tab, { identity = null, ssBlocked = false, giveUpMs = 0 } = {}) {
  tab.y = 0; tab.scrolls = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://erp.farooqandcotraders.online/e',
    beforeParse(w) {
      w.indexedDB = tab.idb; w.IDBKeyRange = FDBKeyRange; w.print = () => {}; w.confirm = () => true; w.prompt = () => 'r'; w.scrollTo = (x, y) => { tab.y = typeof y === 'number' ? y : 0; tab.scrolls.push(tab.y); }; w.open = () => null;
      if (giveUpMs) w.FC_REMEMBER_GIVE_UP_MS = giveUpMs;
      Object.defineProperty(w, 'pageYOffset', { configurable: true, get: () => tab.y || 0 });
      { const stv = new WeakMap(); Object.defineProperty(w.Element.prototype, 'scrollTop', { configurable: true, get() { return stv.get(this) || 0; }, set(v) { stv.set(this, +v || 0); } }); }
      w.URL.createObjectURL = () => 'b'; w.URL.revokeObjectURL = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
      w.matchMedia = q => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.crypto.subtle = webcrypto.subtle; if (!w.crypto.getRandomValues) w.crypto.getRandomValues = a => webcrypto.getRandomValues(a);
      w.fetch = async url => {
        const p = String(url).replace(/^.*api\/auth\//, '');
        if (identity && p === 'me.php') return { status: 200, json: async () => identity };
        if (p === 'logout.php') return { status: 200, json: async () => ({}) };
        return { status: 401, json: async () => ({}) };
      };
      Object.defineProperty(w, 'localStorage', { configurable: true, value: mapStore(tab.ls) });
      Object.defineProperty(w, 'sessionStorage', { configurable: true,
        get() { if (ssBlocked) throw new Error('blocked'); return mapStore(tab.ss); } });
    } });
  return dom.window;
}
async function ready(w) { for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25); await sleep(450); }
const $ = (w, s) => w.document.querySelector(s);
const shown = el => { const c = el.cloneNode(true); c.querySelectorAll('script,style').forEach(n => n.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
const stored = tab => { try { return JSON.parse(tab.ss['farooqco_erp_page'] || 'null'); } catch (e) { return 'bad'; } };
const navOn = w => { const a = $(w, '#nav a.on'); return a ? a.dataset.go : null; };

async function main() {
  /* ═══ A. THE OFFICE APP ═══ */
  const tab = newTab();
  {
    const w = boot(ERP_HTML, tab); await ready(w);
    check('A1 a new tab opens on the Dashboard', w.cur === 'dashboard' && /Business overview/.test(shown($(w, '#view'))));
    check('A2 the module is loaded and exposes its key', !!w.ERP.RememberPage && w.ERP.RememberPage.KEY === 'farooqco_erp_page');
    w.go('inventory'); await sleep(50);
    check('A3 opening Inventory remembers it for this tab', stored(tab).id === 'inventory', JSON.stringify(stored(tab)));
    w.close();
  }
  {
    /* the reload — polled every 2 ms so a flash of the Dashboard before the real screen cannot slip past */
    const w = boot(ERP_HTML, tab);
    let sawDashboard = false;
    const poll = setInterval(() => { try { const v = w.document.getElementById('view'); if (v && /Business overview/.test(v.textContent)) sawDashboard = true; } catch (e) {} }, 2);
    await ready(w); clearInterval(poll);
    check('A4 after a reload the app is on Inventory, not the Dashboard', w.cur === 'inventory' && /Inventory/.test($(w, '#ttl').textContent) && !/Business overview/.test(shown($(w, '#view'))), w.cur);
    check('A5 the sidebar highlights Inventory', navOn(w) === 'inventory', String(navOn(w)));
    check('A6 the Dashboard never flashed up on the way (only the loading skeleton)', !sawDashboard);
    w.go('dashboard'); await sleep(50);
    check('A7 going back to the Dashboard is remembered too', stored(tab).id === 'dashboard');
    w.close();
  }
  {
    const w = boot(ERP_HTML, tab); await ready(w);
    check('A8 …and a reload then stays on the Dashboard', w.cur === 'dashboard');
    /* a shop's own page */
    const shop = w.CUSTOMERS[0];
    w.go('customerProfile', shop.id); await sleep(60);
    check('A9 a shop page is remembered with the shop', stored(tab).id === 'customerProfile' && stored(tab).arg === shop.id);
    w.go('payments'); await sleep(50);
    check('A10 a page without a record stores no stale record id', stored(tab).id === 'payments' && !('arg' in stored(tab)), JSON.stringify(stored(tab)));
    w.go('customerProfile', shop.id); await sleep(60);
    w.close();
    const w2 = boot(ERP_HTML, tab); await ready(w2);
    check('A11 a reload returns to the same shop', w2.cur === 'customerProfile' && w2.curArg === shop.id && $(w2, '#ttl').textContent === shop.sh, w2.cur + ' ' + $(w2, '#ttl').textContent);
    w2.go('supplierProfile', w2.SUPPLIERS[0].id); await sleep(60);
    w2.close();
    const w3 = boot(ERP_HTML, tab); await ready(w3);
    check('A12 a reload returns to the same supplier', w3.cur === 'supplierProfile' && w3.curArg === w3.SUPPLIERS[0].id, w3.cur);
    w3.close();
  }
  {
    /* records that are gone, and screens that should not come back */
    const t2 = newTab(); t2.ss['farooqco_erp_page'] = JSON.stringify({ id: 'customerProfile', arg: 'no-such-shop' });
    const w = boot(ERP_HTML, t2); await ready(w);
    check('B1 a shop that no longer exists → Dashboard (not a broken page)', w.cur === 'dashboard' && /Business overview/.test(shown($(w, '#view'))), w.cur);
    w.close();
    const t3 = newTab(); t3.ss['farooqco_erp_page'] = JSON.stringify({ id: 'supplierProfile' });
    const w3 = boot(ERP_HTML, t3); await ready(w3);
    check('B2 a supplier page with no supplier id → Dashboard', w3.cur === 'dashboard');
    w3.close();
    const t4 = newTab(); t4.ss['farooqco_erp_page'] = JSON.stringify({ id: 'a-screen-that-was-removed' });
    const w4 = boot(ERP_HTML, t4); await ready(w4);
    check('B3 an unknown screen name → Dashboard', w4.cur === 'dashboard');
    w4.close();
    const t5 = newTab(); t5.ss['farooqco_erp_page'] = '{not json';
    const w5 = boot(ERP_HTML, t5); await ready(w5);
    check('B4 damaged stored text → Dashboard, no error', w5.cur === 'dashboard');
    w5.close();
    const t6 = newTab(); t6.ss['farooqco_erp_page'] = JSON.stringify({ id: 'invoiceBuilder' });
    const w6 = boot(ERP_HTML, t6); await ready(w6);
    check('B5 the unsaved invoice form is never reopened blank', w6.cur === 'dashboard');
    w6.close();
    const t7 = newTab(); const w7 = boot(ERP_HTML, t7); await ready(w7);
    w7.go('invoices'); await sleep(40); w7.go('invoiceBuilder'); await sleep(60);
    check('B6 opening the invoice form does not replace the remembered list', stored(t7).id === 'invoices', JSON.stringify(stored(t7)));
    w7.close();
    const w8 = boot(ERP_HTML, t7); await ready(w8);
    check('B7 a reload from the invoice form lands on the list the person came from', w8.cur === 'invoices', w8.cur);
    w8.close();
  }
  {
    /* another tab is separate */
    const other = newTab(); const w = boot(ERP_HTML, other); await ready(w);
    check('C1 another tab (its own storage) is not moved by the first tab\'s screen', w.cur === 'dashboard');
    w.close();
    /* storage unavailable */
    const w2 = boot(ERP_HTML, newTab(), { ssBlocked: true }); await ready(w2);
    w2.go('inventory'); await sleep(40);
    check('C2 with browser storage blocked the app still runs (Dashboard, screens still open)', w2.cur === 'inventory' && /Inventory/.test($(w2, '#ttl').textContent));
    w2.close();
  }
  {
    /* permissions still apply after a reload */
    const t = newTab(); t.ss['farooqco_erp_page'] = JSON.stringify({ id: 'payroll' });
    const sales = { user: { id: 'u2', username: 'ali', displayName: 'Ali' }, role: 'SALES', permissions: ['SALE_CREATE'], csrf: 'c', enforce: true };
    const w = boot(ERP_HTML, t, { identity: sales }); await ready(w); await sleep(300);
    check('D1 a person without access is shown the lock notice, not Payroll', w.cur === 'payroll' && /is not open to you/.test(shown($(w, '#view'))), shown($(w, '#view')).slice(0, 120));
    w.close();
    const owner = { user: { id: 'u1', username: 'owner', displayName: 'Owner' }, role: 'OWNER', permissions: ['*'], csrf: 'c', enforce: true };
    const t2 = newTab(); t2.ss['farooqco_erp_page'] = JSON.stringify({ id: 'payroll' });
    const w2 = boot(ERP_HTML, t2, { identity: owner }); await ready(w2); await sleep(300);
    check('D2 the owner gets Payroll itself', w2.cur === 'payroll' && !/is not open to you/.test(shown($(w2, '#view'))));
    /* signing out forgets it */
    t2.ss['farooqco_wh_page'] = JSON.stringify({ s: 'stock' });
    w2.ERP.Auth._reload = () => {};
    await w2.ERP.Auth.logout(); await sleep(50);
    check('D3 signing out forgets the remembered screen (office and warehouse)', !t2.ss['farooqco_erp_page'] && !t2.ss['farooqco_wh_page'], JSON.stringify(t2.ss));
    w2.close();
  }

  /* ═══ F. WHO IT BELONGS TO, AND A SLOW BOOT ═══ */
  {
    const A = { user: { id: 'usr_A', username: 'a', displayName: 'A' }, role: 'OWNER', permissions: ['*'], csrf: 'c', enforce: true };
    const tb = newTab(); tb.ss['farooqco_erp_page'] = JSON.stringify({ id: 'inventory', u: 'usr_B' });
    const w = boot(ERP_HTML, tb, { identity: A }); await ready(w); await sleep(300);
    check('F1 another person signing in on the same tab does not inherit the last screen', w.cur === 'dashboard', w.cur);
    check('F2 …and the record now belongs to the new person', stored(tb).u === 'usr_A', JSON.stringify(stored(tb)));
    w.close();
    const ta = newTab(); ta.ss['farooqco_erp_page'] = JSON.stringify({ id: 'inventory', u: 'usr_A' });
    const w2 = boot(ERP_HTML, ta, { identity: A }); await ready(w2); await sleep(300);
    check('F3 the same person gets their screen back', w2.cur === 'inventory');
    w2.close();

    /* a restricted screen must never flash open before the lock notice */
    const SALES = { user: { id: 'u2', username: 'ali', displayName: 'Ali' }, role: 'SALES', permissions: ['SALE_CREATE'], csrf: 'c', enforce: true };
    const tp = newTab(); tp.ss['farooqco_erp_page'] = JSON.stringify({ id: 'payroll', u: 'u2' });
    const w3 = boot(ERP_HTML, tp, { identity: SALES });
    let sawOpen = false;
    const poll = setInterval(() => { try { if (/Pay salary/.test(w3.document.getElementById('view').textContent)) sawOpen = true; } catch (e) {} }, 2);
    await ready(w3); await sleep(300); clearInterval(poll);
    check('F4 a screen the person may not open is never drawn open, not even for a moment', !sawOpen && /is not open to you/.test(shown($(w3, '#view'))));
    w3.close();

    /* boot slower than the give-up time (forced to 1 ms here) */
    const tg = newTab(); tg.ss['farooqco_erp_page'] = JSON.stringify({ id: 'inventory' });
    const w4 = boot(ERP_HTML, tg, { giveUpMs: 1 });
    let sawDash = false, overwritten = false;
    const poll2 = setInterval(() => { try { if (/Business overview/.test(w4.document.getElementById('view').textContent)) sawDash = true; if (stored(tg) && stored(tg).id === 'dashboard') overwritten = true; } catch (e) {} }, 2);
    await ready(w4); clearInterval(poll2);
    check('F5 slow boot: the app showed something usable meanwhile (the give-up path really ran)', sawDash);
    check('F6 …that fallback never overwrote the remembered screen (not even for a moment), and the person still lands on it', w4.cur === 'inventory' && stored(tg).id === 'inventory' && !overwritten, w4.cur + ' ' + JSON.stringify(stored(tg)));
    w4.close();
    /* …but someone who already moved on is not pulled back */
    const tg2 = newTab(); tg2.ss['farooqco_erp_page'] = JSON.stringify({ id: 'inventory' });
    const w5 = boot(ERP_HTML, tg2, { giveUpMs: 1 }); await sleep(60); w5.go('payments');
    await ready(w5);
    check('F7 slow boot: a person who already chose another screen stays on it', w5.cur === 'payments', w5.cur);
    w5.close();
  }

  /* ═══ G. THE SCROLL PLACE ═══ */
  {
    const t = newTab(); const w = boot(ERP_HTML, t); await ready(w);
    w.go('inventory'); await sleep(60);
    t.y = 640; w.dispatchEvent(new w.Event('scroll')); await sleep(320);
    check('G1 scrolling down a screen is remembered', stored(t).id === 'inventory' && stored(t).y === 640, JSON.stringify(stored(t)));
    w.go('payments'); await sleep(60);
    check('G2 a different screen starts at the top', stored(t).id === 'payments' && stored(t).y === 0, JSON.stringify(stored(t)));
    w.go('inventory'); await sleep(60); t.y = 640; w.dispatchEvent(new w.Event('scroll')); await sleep(320);
    w.close();
    const w2 = boot(ERP_HTML, t); await ready(w2);
    check('G3 after a reload the page is scrolled back to the same place', t.scrolls.includes(640), JSON.stringify(t.scrolls));
    check('G4 …and that place survives a second reload too', stored(t).id === 'inventory' && stored(t).y === 640, JSON.stringify(stored(t)));
    w2.close();
  }

  /* ═══ E. THE WAREHOUSE APP ═══ */
  {
    const wt = newTab();
    const w = boot(WH_HTML, wt); await sleep(1600);
    check('E1 the Warehouse opens on Home in a new tab', w.eval('S.screen') === 'home');
    w.eval("go('stock')"); await sleep(60);
    check('E2 the Stock screen is remembered', JSON.parse(wt.ss['farooqco_wh_page']).s === 'stock');
    w.close();
    const w2 = boot(WH_HTML, wt); await sleep(1600);
    check('E3 after a reload the Warehouse is on Stock, not Home', w2.eval('S.screen') === 'stock' && /Stock/.test($(w2, '#tbarTitle').textContent) && !!$(w2, '#view .row[data-prod]'), w2.eval('S.screen'));
    const pid = w2.eval('PRODUCTS[3].id');
    w2.eval('S.prod=PRODUCTS[3].id;go("product")'); await sleep(60);
    check('E4 a product page is remembered with its product', JSON.parse(wt.ss['farooqco_wh_page']).p === pid);
    w2.close();
    const w3 = boot(WH_HTML, wt); await sleep(1600);
    check('E5 a reload returns to the same product', w3.eval('S.screen') === 'product' && w3.eval('S.prod') === pid && !!$(w3, '#view .back'), w3.eval('S.screen'));
    w3.eval("go('send')"); await sleep(60);
    w3.close();
    const w4 = boot(WH_HTML, wt); await sleep(1600);
    check('E6 a reload returns to Dispatch Stock', w4.eval('S.screen') === 'send' && /Send Stock/.test($(w4, '#tbarTitle').textContent), w4.eval('S.screen'));
    w4.eval("S.last={title:'Done',body:'ok',note:'n',again:['Again','add']};S.screen='done';paint()"); await sleep(60);
    check('E7 the "Done" result page is remembered as Home', JSON.parse(wt.ss['farooqco_wh_page']).s === 'home');
    w4.close();

    const bad = newTab(); bad.ss['farooqco_wh_page'] = JSON.stringify({ s: 'product', p: 'no-such-product' });
    const w5 = boot(WH_HTML, bad); await sleep(1600);
    check('E8 a product that no longer exists → Home', w5.eval('S.screen') === 'home');
    w5.close();
    const junk = newTab(); junk.ss['farooqco_wh_page'] = JSON.stringify({ s: 'nonsense' });
    const w6 = boot(WH_HTML, junk); await sleep(1600);
    check('E9 an unknown screen → Home', w6.eval('S.screen') === 'home');
    w6.close();
    const w7 = boot(WH_HTML, wt); await sleep(1500);
    /* the person clicks Home while the page is still loading: their choice wins over the remembered screen */
    check('E10 a fresh tab, blocked storage: Warehouse still opens', (() => { const x = boot(WH_HTML, newTab(), { ssBlocked: true }); const ok = x.eval('S.screen') === 'home'; x.close(); return ok; })());
    w7.close();
  }

  {
    /* scroll place */
    const ws = newTab();
    const x1 = boot(WH_HTML, ws); await sleep(1600);
    x1.eval("go('stock')"); await sleep(60);
    const cv = $(x1, '.canvas'); cv.scrollTop = 420; cv.dispatchEvent(new x1.Event('scroll')); await sleep(320);
    check('E11 the Warehouse remembers how far the list was scrolled', JSON.parse(ws.ss['farooqco_wh_page']).y === 420, ws.ss['farooqco_wh_page']);
    x1.eval("go('home')"); await sleep(60);
    check('E12 a different screen starts at the top', JSON.parse(ws.ss['farooqco_wh_page']).y === 0);
    x1.eval("go('stock')"); await sleep(60); cv.scrollTop = 420; cv.dispatchEvent(new x1.Event('scroll')); await sleep(320);
    x1.close();
    const x2 = boot(WH_HTML, ws); await sleep(1600);
    check('E13 after a reload the Warehouse list is scrolled back', $(x2, '.canvas').scrollTop === 420 && JSON.parse(ws.ss['farooqco_wh_page']).y === 420, String($(x2, '.canvas').scrollTop));
    x2.close();
  }

  check('Z no script errors were raised in any window', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
