/* Shell, notifications, layout and the Warehouse frame (modules 40, 41, 42 and the Warehouse page's own shell).
   jsdom draws no CSS, so this proves structure, state, handlers and text; the pixels were checked in real headless Chrome
   (desktop, 1080px, 1024px, phone, dark mode). */
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

function boot(html, { width = 1400, ls = {} } = {}) {
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const idb = new FDBFactory();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://erp.farooqandcotraders.online/e',
    beforeParse(w) {
      w.indexedDB = idb; w.IDBKeyRange = FDBKeyRange; w.print = () => {}; w.confirm = () => true; w.prompt = () => 'r'; w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'b'; w.URL.revokeObjectURL = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
      Object.defineProperty(w, 'innerWidth', { value: width, configurable: true, writable: true });
      w.matchMedia = q => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.crypto.subtle = webcrypto.subtle; if (!w.crypto.getRandomValues) w.crypto.getRandomValues = a => webcrypto.getRandomValues(a);
      w.fetch = async () => ({ status: 401, json: async () => ({}) });
      Object.defineProperty(w, 'localStorage', { configurable: true, value: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } } });
    } });
  return dom.window;
}
async function ready(w) { for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25); await sleep(500); }
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
const shown = el => { const c = el.cloneNode(true); c.querySelectorAll('script,style').forEach(n => n.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
const emoji = /\p{Extended_Pictographic}/u;

async function main() {
  const ls = {};
  const w = boot(ERP_HTML, { ls }); await ready(w);

  /* ═══ A. ONE ICON PER SCREEN ═══ */
  {
    const ids = w.NAVGROUPS.flatMap(g => g[1]);
    const icons = ids.map(id => (w.NAV.find(n => n.id === id) || {}).i);
    const dupes = icons.filter((x, i) => icons.indexOf(x) !== i);
    check('A1 every menu entry has an icon of its own (' + ids.length + ' screens)', ids.length >= 20 && dupes.length === 0, 'shared: ' + [...new Set(dupes)].join(','));
    check('A2 every one of those icons has a drawing in the icon set', icons.every(i => w.P[i] && w.P[i].length > 8), icons.filter(i => !(w.P[i] && w.P[i].length > 8)).join(','));
    check('A3 the sidebar links draw an SVG each', $$(w, '#nav a[data-go] svg').length >= ids.length - 1);
    check('A4 ERP.Nav.ICONS matches what NAV uses', ids.every(id => !w.ERP.Nav.ICONS[id] || w.ERP.Nav.ICONS[id] === w.NAV.find(n => n.id === id).i));
  }

  /* ═══ B. GROUPS THAT LOOK LIKE GROUPS ═══ */
  {
    const groups = $$(w, '#nav .nav-grp');
    check('B1 the menu is built as groups (one per group name)', groups.length === w.NAVGROUPS.length, groups.length + ' vs ' + w.NAVGROUPS.length);
    const heads = $$(w, '#nav .nav-grp > .nav-sec');
    check('B2 every group header is a real <button> with aria-expanded', heads.length === groups.length && heads.every(h => h.tagName === 'BUTTON' && h.hasAttribute('aria-expanded')));
    check('B3 no loose text header is left between the links', $$(w, '#nav > .nav-sec').length === 0 && $$(w, '#nav > a').length === 0);
    check('B4 every link lives inside its group\'s item list, named by its header', $$(w, '#nav .nav-items').every(b => b.getAttribute('aria-labelledby') && b.querySelector('a[data-go]')));
    check('B5 each link carries its label as a tooltip (the icon rail shows only the icon)', $$(w, '#nav a[data-go]').every(a => a.getAttribute('title')));
    check('B6 the open screen is marked aria-current and its group header is highlighted', !!$(w, '#nav a.on[aria-current="page"]') && !!$(w, '#nav .nav-grp.here'));

    /* fold a group that does not hold the open screen */
    const inv = $$(w, '#nav .nav-grp').find(g => g.getAttribute('data-g') === 'Inventory & supply');
    const head = inv.querySelector('.nav-sec');
    head.click(); await sleep(20);
    check('B7 clicking a header folds its group', $$(w, '#nav .nav-grp').find(g => g.getAttribute('data-g') === 'Inventory & supply').classList.contains('closed') && head.getAttribute('aria-expanded') === 'false');
    check('B8 the choice is remembered on this device', JSON.parse(ls.farooqco_nav_closed || '[]').includes('Inventory & supply'));
    check('B9 folding did not navigate anywhere', w.cur === 'dashboard');
    /* a re-draw (every screen change) keeps it folded */
    w.go('sales'); await sleep(60);
    check('B10 the group stays folded after moving to another screen', $$(w, '#nav .nav-grp').find(g => g.getAttribute('data-g') === 'Inventory & supply').classList.contains('closed'));
    /* the group holding the open screen cannot be folded */
    const salesHead = $$(w, '#nav .nav-grp').find(g => g.getAttribute('data-g') === 'Sales').querySelector('.nav-sec');
    salesHead.click(); await sleep(20);
    check('B11 the group holding the open screen refuses to fold', !$$(w, '#nav .nav-grp').find(g => g.getAttribute('data-g') === 'Sales').classList.contains('closed'));
    /* opening a screen inside a folded group opens it again */
    w.go('inventory'); await sleep(60);
    check('B12 going to a screen in a folded group shows that group again', !$$(w, '#nav .nav-grp').find(g => g.getAttribute('data-g') === 'Inventory & supply').classList.contains('closed'));
    /* unfold */
    const salesG = () => $$(w, '#nav .nav-grp').find(g => g.getAttribute('data-g') === 'Sales');
    salesG().querySelector('.nav-sec').click(); await sleep(20);
    const folded = salesG().classList.contains('closed') && JSON.parse(ls.farooqco_nav_closed || '[]').includes('Sales');
    salesG().querySelector('.nav-sec').click(); await sleep(20);
    check('B13 a folded group unfolds on the next click and is forgotten', folded && !salesG().classList.contains('closed') && !JSON.parse(ls.farooqco_nav_closed || '[]').includes('Sales'));
    /* profit link stays hidden for a role without PROFIT_VIEW (module 19 hides it after paintNav; grouping must keep the node) */
    check('B14 the links other modules hide by id are still found by id', !!$(w, '#nav [data-go="dashboard"]'));
    /* the logo */
    const mk = $(w, '#markLogo');
    check('B15 the logo is shown as an emblem (the name is written once, beside it)', mk.classList.contains('emblem') && mk.querySelector('img').getAttribute('alt') === '');
  }

  /* fresh window with a folded group in storage */
  {
    const w2 = boot(ERP_HTML, { ls: { farooqco_nav_closed: JSON.stringify(['Finance']) } }); await ready(w2);
    const fin = $$(w2, '#nav .nav-grp').find(g => g.getAttribute('data-g') === 'Finance');
    check('B16 a fold saved earlier is applied on the next visit', fin.classList.contains('closed') && fin.querySelector('.nav-sec').getAttribute('aria-expanded') === 'false');
    w2.close();
  }

  /* ═══ C. THE BELL ═══ */
  {
    const bell = $(w, '#bellBtn');
    w.go('dashboard'); await sleep(60);
    bell.click(); await sleep(30);
    const panel = $(w, '#fcNotif');
    check('C1 the bell opens a panel, not a toast', !!panel && panel.classList.contains('on') && (!$(w, '#toast') || !$(w, '#toast').classList.contains('on')));
    check('C2 the panel is a labelled dialog and the bell says it is expanded', panel.getAttribute('role') === 'dialog' && bell.getAttribute('aria-expanded') === 'true');
    const txt = shown(panel);
    check('C3 it names WHAT is wrong (products with no stock, with product names) instead of a bare count', /products have no stock/.test(txt) && /Al Mamu Sella/.test(txt), txt.slice(0, 200));
    { const n = +$(w, '#nav .nav-count').textContent; const rowTxt = [...panel.querySelectorAll('.fcn-row b')].map(b => b.textContent); const num = re => { const r = rowTxt.map(t => re.exec(t)).find(Boolean); return r ? +r[1] : 0; }; const sum = num(/^(\d+) products? (?:have|has) no stock/) + num(/^(\d+) products? (?:is|are) running low/);
      check('C4 the number agrees with the sidebar badge and the dashboard card', n === sum, 'badge ' + n + ' vs bell ' + sum + ' — ' + txt.slice(0, 120)); }
    check('C5 it links on to the alerts settings', !!panel.querySelector('[data-fcn-go="alerts"]'));
    check('C6 it draws icons, no emoji', panel.querySelectorAll('svg').length >= 3 && !emoji.test(txt));
    /* seen state */
    check('C7 opening it marks what is listed as seen: the red dot goes', bell.querySelector('.dot').classList.contains('fcn-seen') && !!ls.farooqco_notif_seen);
    /* a row takes you to the fix, already filtered */
    panel.querySelector('[data-fcn-go="inventory"][data-fcn-status="No stock"]').click(); await sleep(80);
    check('C8 a row opens the screen that fixes it', w.cur === 'inventory');
    check('C9 …with the list already filtered (No stock)', w.FIL.status === 'No stock' && $(w, 'select[data-status]').value === 'No stock');
    check('C10 …and the panel closed', !$(w, '#fcNotif').classList.contains('on'));
    /* Escape */
    bell.click(); await sleep(20);
    check('C11 it opens again', $(w, '#fcNotif').classList.contains('on'));
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(20);
    check('C12 Escape closes it and the bell is collapsed again', !$(w, '#fcNotif').classList.contains('on') && bell.getAttribute('aria-expanded') === 'false');
    /* a click elsewhere */
    bell.click(); await sleep(20); w.document.body.click(); await sleep(20);
    check('C13 a click anywhere else closes it', !$(w, '#fcNotif').classList.contains('on'));
    /* the dot returns when something changes */
    const before = ls.farooqco_notif_seen;
    w.PRODUCTS[0].min = 999999; w.STOCKMAP[Object.keys(w.STOCKMAP)[0] || 'x'] = 0;
    w.ERP.Notifications.refresh();
    const sig1 = w.ERP.Notifications.items().length;
    ls.farooqco_notif_seen = 'something older'; w.ERP.Notifications.refresh();
    check('C14 the dot comes back when what is listed differs from what was seen', !bell.querySelector('.dot').classList.contains('fcn-seen') && sig1 >= 1 && before !== ls.farooqco_notif_seen);
    /* the empty state */
    const real = w.PRODUCTS; w.PRODUCTS = []; w.ERP.Notifications.open(); await sleep(20);
    const emptyTxt = shown($(w, '#fcNotif'));
    check('C15 with nothing to report it says so', /all caught up/i.test(emptyTxt), emptyTxt.slice(0, 120));
    w.ERP.Notifications.close(); w.PRODUCTS = real;
  }
  {
    /* on a phone it is a sheet with a scrim */
    const wp = boot(ERP_HTML, { width: 390 }); await ready(wp);
    $(wp, '#bellBtn').click(); await sleep(30);
    check('C16 on a phone the panel comes with a scrim (a bottom sheet)', $(wp, '#fcNotifScrim').classList.contains('on') && $(wp, '#fcNotif').classList.contains('on'));
    $(wp, '#fcNotifScrim').click(); await sleep(20);
    check('C17 tapping the scrim closes it', !$(wp, '#fcNotif').classList.contains('on') && !$(wp, '#fcNotifScrim').classList.contains('on'));
    wp.close();
  }

  /* ═══ D. LAYOUT ═══ */
  {
    w.go('inventory'); await sleep(80);
    const head = $(w, '#view .page-head');
    const r = head && head.querySelector('.r');
    const labels = r ? [...r.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
    check('D1 the action buttons sit in the title row (Edit products, Pricing settings, Add Stock…)', /Pricing settings/.test(labels.join('|')) && /Add Stock/.test(labels.join('|')) && labels.length >= 3, labels.join('|'));
    check('D2 no button-only strip is left under the title', !w.document.querySelector('#view .page-head + .bar'));
    check('D3 the search / filter bar stays where it was', !!$(w, '#view .bar .tsearch') && !!$(w, '#view .bar select[data-wh]'));
    check('D4 a moved button still works (Pricing settings goes to Settings)', (() => { const b = [...r.querySelectorAll('button')].find(x => /Pricing settings/.test(x.textContent)); b.click(); return true; })());
    await sleep(80); check('D4b …and it opened Settings', w.cur === 'settings');

    /* long lists */
    w.ERP.Layout.limit = 48;
    w.go('customers'); await sleep(120);
    const grid = () => [...$$(w, '#view [data-row]')].filter(e => e.parentNode.children.length > 100 || true);
    const cards = () => $$(w, '#view [data-row]');
    const vis = () => cards().filter(e => e.style.display !== 'none' && !e.classList.contains('fc-lim'));
    check('D5 Customers shows the first 48 shops, not all 409', vis().length === 48 && cards().length >= 409, vis().length + ' of ' + cards().length);
    const bar = $(w, '#view .fc-more');
    check('D6 a "Show more" bar says how many are shown', !!bar && /Showing 48 of 409/.test(bar.textContent), bar && bar.textContent);
    bar.querySelector('[data-fcmore="1"]').click(); await sleep(30);
    check('D7 Show more adds another 48', vis().length === 96 && /Showing 96 of 409/.test($(w, '#view .fc-more').textContent));
    $(w, '#view .fc-more [data-fcmore="all"]').click(); await sleep(30);
    check('D8 Show all shows every shop and removes the bar', vis().length === 409 && !$(w, '#view .fc-more'));
    /* search covers the whole list, not just the page */
    w.go('customers'); await sleep(120);
    const target = w.CUSTOMERS[w.CUSTOMERS.length - 1];
    w.FIL.q = target.sh.toLowerCase(); w.applyFilters();
    const hit = vis();
    check('D9 a search finds a shop that was beyond the first page', hit.length >= 1 && hit.some(e => e.dataset.row.toLowerCase().includes(target.sh.toLowerCase())), hit.length + ' shown');
    check('D10 a narrow search needs no bar', !$(w, '#view .fc-more'));
    w.FIL.q = ''; w.applyFilters();
    check('D11 clearing the search returns to the first page with its bar', vis().length === 48 && !!$(w, '#view .fc-more'));
    /* rows hidden by the page limit are not hidden by the filter engine (CSV / print take every matching row) */
    check('D12 rows past the limit are hidden by class only (inline display untouched), so CSV export still sees them',
      cards().filter(e => e.classList.contains('fc-lim')).every(e => e.style.display !== 'none'));
    w.dispatchEvent(new w.Event('beforeprint')); await sleep(10);
    check('D13 printing expands the list first', vis().length === cards().filter(e => e.style.display !== 'none').length);
    w.dispatchEvent(new w.Event('afterprint')); await sleep(10);
    check('D14 …and folds it back afterwards', vis().length === 48);

    w.go('dashboard'); await sleep(120);
    const big = $$(w, '#view tbody').map(b => [...b.querySelectorAll(':scope > tr[data-row]')]).sort((a, b) => b.length - a.length)[0] || [];
    const dashVis = big.filter(e => !e.classList.contains('fc-lim'));
    check('D15 the dashboard "needing attention" table shows a page, with a bar', big.length > 48 && dashVis.length === 48 && !!$(w, '#view .fc-more'), big.length + ' rows, ' + dashVis.length + ' shown');
    check('D16 the table is still one table (the bar sits after its scroll wrapper)', !!big[0] && !!big[0].closest('.tw') && big[0].closest('.tw').nextElementSibling.classList.contains('fc-more'));

    /* a table straight in a card gets a scroll wrapper */
    w.go('landed'); await sleep(120);
    const bare = $$(w, '#view table').filter(t => !t.closest('.tw,.lc-tablewrap'));
    check('D17 no table sits without a scroll wrapper (it pushed a phone sideways)', bare.length === 0, bare.length + ' bare');
  }

  /* ═══ E. NO EMOJI ANYWHERE ═══ */
  {
    const modules = fs.readdirSync('.').filter(f => /^\d.*\.js$/.test(f));
    const bad = [];
    modules.forEach(f => fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (emoji.test(l)) bad.push(f + ':' + (i + 1)); }));
    check('E1 no emoji in any module source', bad.length === 0, bad.slice(0, 5).join(' '));
    const strip = h => h.replace(/<script>window\.FAROOQ_ERP_MASTER[\s\S]*?<\/script>/, '');
    const page = strip(fs.readFileSync('../app/farooq-co-warehouse-pwa.html', 'utf8')).split('\n').filter(l => emoji.test(l));
    check('E2 no emoji in the Warehouse page', page.length === 0, page[0] && page[0].slice(0, 80));
    const launcher = fs.readFileSync('../app/index.html', 'utf8').slice(0, 20000);
    check('E3 no emoji in the launcher', !emoji.test(launcher));
    check('E4 no text-glyph buttons left (a cross, a pencil, arrows) in the modules', !modules.some(f => /(>|')(✕|✎)(<| )/.test(fs.readFileSync(f, 'utf8'))));
    /* the WhatsApp text is plain */
    const inv = { invoiceNumber: 'INV-1', invoiceDate: '2026-09-21', shopNameSnapshot: 'Shop', id: 'x', lineCount: 2, totalAmount: 100, paidAmount: 0 };
    let text = ''; try { text = w.ERP.Wa.invoiceText(inv); } catch (e) { text = String(e); }
    check('E5 the WhatsApp invoice message has no emoji', text.length > 20 && !emoji.test(text), text.slice(0, 60));
  }
  w.close();

  /* ═══ F. THE WAREHOUSE APP WEARS THE OFFICE FRAME ═══ */
  {
    const ww = boot(WH_HTML); await sleep(1500);
    const ev = s => ww.eval(s);
    check('F1 the menu button is in the top bar, before the title (as in the office)', !!$(ww, '#tbar > #collapse') && $(ww, '#tbar').firstElementChild.id === 'collapse');
    check('F2 the old "Hide menu" button at the foot of the rail is gone', !$(ww, '.rail button.collapse') && !/Hide menu/.test(shown($(ww, '.rail'))));
    check('F3 the frame has a rail, a top bar and a page (no floating island)', !!$(ww, '.shell > .rail') && !!$(ww, '.shell > .canvas > #tbar') && !!$(ww, '.canvas > #view'));
    check('F4 there is no fixed person\'s name in the rail', !/Kashif/.test(ww.document.body.innerHTML) && !!$(ww, '#whName'));
    check('F5 the logo is a mark (emblem) beside the name, not a second name', !!$(ww, '#logo img') && !/Farooq/i.test($(ww, '#logo img').getAttribute('alt') || 'x'.repeat(0)));
    /* collapse */
    $(ww, '#collapse').click(); await sleep(20);
    check('F6 the menu button folds the menu to icons and says "Expand menu"', ww.document.body.classList.contains('mini') && $(ww, '#collapse').getAttribute('aria-label') === 'Expand menu');
    $(ww, '#collapse').click(); await sleep(20);
    check('F7 and unfolds it again', !ww.document.body.classList.contains('mini') && $(ww, '#collapse').getAttribute('aria-label') === 'Collapse menu');

    /* hero card */
    const css = ww.document.querySelector('style').textContent;
    check('F8 the stock card is a light card like the office (no dark gradient)', !/\.b\.tall\{[^}]*#12101F/.test(css) && !/\.stat\.hero\{[^}]*#12101F/.test(css) && !/\.math\{[^}]*#12101F/.test(css));

    /* long lists */
    ev("go('stock')"); await sleep(60);
    const rows = () => $$(ww, '#view .row[data-prod]');
    check('F9 the stock list shows a first page of 40 with a bar', rows().length === 40 && /Showing 40 of \d+/.test(shown($(ww, '#view .more') || ww.document.body)), rows().length + '');
    $(ww, '#view [data-more="rows"]:not([data-all])').click(); await sleep(30);
    check('F10 Show more adds 40', rows().length === 80);
    $(ww, '#view [data-more="rows"][data-all]').click(); await sleep(30);
    check('F11 Show all shows every product', rows().length === ev('PRODUCTS.length') && !$(ww, '#view .more'));
    ev("go('stock')"); await sleep(40);
    /* level filter */
    const low = $$(ww, '#view .lvlbar button');
    check('F12 the stock list has All / Low stock / No stock filters with counts', low.length === 3 && low.every(b => b.querySelector('.n')));
    low[2].click(); await sleep(30);
    check('F13 "No stock" filters the list', ev('S.lvl') === 'out' && rows().length === 40 && ww.document.querySelector('.lvlbar button[aria-pressed="true"]').dataset.lvl === 'out');
    /* the bell */
    $(ww, '#bellBtn').click(); await sleep(30);
    const wn = $(ww, '#wn');
    check('F14 the bell opens a panel that names the products', wn.classList.contains('on') && /have no stock/.test(shown(wn)) && /Al Mamu Sella/.test(shown(wn)));
    wn.querySelector('[data-wngo="stock"][data-wnlvl="out"]').click(); await sleep(40);
    check('F15 a row opens Stock already filtered', ev('S.screen') === 'stock' && ev('S.lvl') === 'out' && !$(ww, '#wn').classList.contains('on'));
    ww.document.dispatchEvent(new ww.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    /* a search resets the page */
    ev("S.lim.rows=120"); ev("S.q='mian'"); ww.document.getElementById('q').dispatchEvent(new ww.Event('input', { bubbles: true })); await sleep(40);
    check('F16 typing in the search goes back to the first page', ev('JSON.stringify(S.lim)') === '{}');
    /* the receive flow and the dispatch flow lists */
    ev("go('add')"); await sleep(50);
    check('F17 the Receive product picker shows a first page too', $$(ww, '#pickHost .pick').length === 40 && !!$(ww, '#pickHost .more'));
    ev("go('send')"); await sleep(50);
    check('F18 the shop picker in Dispatch is paged (or empty when there are no shops on this device)', $$(ww, '.pick[data-oshop]').length <= 40);
    /* the shop icon exists (it was missing: shop rows had an empty box) */
    check('F19 the "shop" icon exists in the Warehouse icon set', ev("I('shop').includes('<path d=\"M3 9')"));
    ev("go('home')"); await sleep(40);
    check('F20 the Warehouse page threw nothing while doing all of that', errors.filter(e => !/Could not load|not implemented|Not implemented|fonts/i.test(e)).length === 0, errors.slice(0, 2).join(' | '));
    ww.close();
  }
}

main().then(() => {
  console.log(out.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (errors.length) console.log('page errors:', errors.slice(0, 3));
  process.exit(fail ? 1 : 0);
}).catch(e => { console.log(out.join('\n')); console.error(e); process.exit(1); });
