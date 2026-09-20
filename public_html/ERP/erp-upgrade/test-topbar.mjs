/* Module 35 — THE TOP BAR.
   Drives the real built app in jsdom (no network). jsdom does not do layout, so
   this proves the STRUCTURE the CSS relies on: the two dead controls are gone,
   everything else sits in one row, the account menu holds what other modules
   create (moved, not copied) and keeps working, and the small behaviours —
   avatar initials, the bell's dot, the warning dot, opening/closing the menu.
   The visual result (58px tall, no overflow from 320px up) was checked with a
   real Chrome at phone / tablet / desktop widths. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
import { webcrypto } from 'crypto';

const HTML = fs.readFileSync('dist/farooq-co-erp.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
const check = (n, c, d) => { if (c) { pass++; out.push('  ✔ ' + n); } else { fail++; out.push('  ✘ ' + n + (d ? '   → ' + d : '')); } };
const errors = [];

function mockFetch(routes) {
  return async (url, opts) => {
    const path = String(url).replace(/^.*api\/auth\//, '');
    const handler = routes[path];
    if (!handler) throw new Error('no mock route for ' + path);
    const result = handler(opts && opts.body ? JSON.parse(opts.body) : {}, opts || {});
    return { status: result.status || 200, json: async () => (result.data !== undefined ? result.data : result) };
  };
}
function boot(store, fetchImpl) {
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'https://erp.farooqandcotraders.online/e',
    beforeParse(w) {
      w.indexedDB = store.idb; w.IDBKeyRange = FDBKeyRange; w.print = () => {}; w.confirm = () => true;
      w.prompt = () => 'reason'; w.scrollTo = () => {}; w.open = () => null;
      w.URL.createObjectURL = () => 'b'; w.URL.revokeObjectURL = () => {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.matchMedia = q => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.crypto.subtle = webcrypto.subtle;
      if (!w.crypto.getRandomValues) w.crypto.getRandomValues = arr => webcrypto.getRandomValues(arr);
      w.fetch = fetchImpl || (async () => { throw new Error('offline'); });
      store.ls = store.ls || {};
      Object.defineProperty(w, 'localStorage', { configurable: true, value: {
        getItem: k => (k in store.ls ? store.ls[k] : null),
        setItem: (k, v) => { store.ls[k] = String(v); },
        removeItem: k => { delete store.ls[k]; } } });
    }
  });
  return dom.window;
}
async function ready(w) {
  for (let i = 0; i < 400 && !(w.ERP && w.ERP.ready); i++) await sleep(25);
  for (let i = 0; i < 80 && !w.ERP.usersReady; i++) await sleep(25);
  await sleep(250);
  return w.ERP;
}

const OWNER = {
  user: { id: 'usr_1', username: 'owner', displayName: 'Farooq Ahmed' }, role: 'OWNER', permissions: ['*'], csrf: 'c1', enforce: true,
};

async function main() {
  /* ── A: nobody signed in to the server (the observe-mode fallback) ── */
  {
    const w = boot({ idb: new FDBFactory() }, mockFetch({ 'me.php': () => ({ status: 401, data: {} }) }));
    await ready(w);
    const D = w.document, $ = id => D.getElementById(id);
    const top = D.querySelector('.top');

    check('A1 the warehouse picker is gone (nothing ever read it)', !$('whBtn') && !$('whName'));
    check('A2 the "Connected · last synced 2 minutes ago" pill is gone', !$('syncBtn') && !/last synced/i.test(top.textContent));
    check('A3 the bar still has its real controls',
      !!$('hamb') && !!$('ttl') && !!$('gq') && !!$('themeBtn') && !!$('bellBtn') && !!$('avBtn'));
    check('A4 the search icon (for screens without room for the box) sits in the bar, not inside the bell\'s wrapper',
      !!$('fcSearchBtn') && $('fcSearchBtn').parentNode === top.querySelector('.top-r') && !$('bellBtn').parentNode.contains($('fcSearchBtn')));

    const menu = $('fcAcctMenu');
    check('A5 the account menu exists next to the avatar and starts closed',
      !!menu && menu.parentNode === $('avBtn').parentNode && !menu.classList.contains('on') && $('avBtn').getAttribute('aria-expanded') === 'false');
    check('A6 the signed-in user chip, the Saved status and Company sign-in were MOVED into the menu (not copied)',
      menu.contains($('fcUserChip')) && menu.contains($('fcDbChip')) && menu.contains($('fcCompanyLink')) &&
      D.querySelectorAll('#fcUserChip').length === 1 && D.querySelectorAll('#fcDbChip').length === 1);
    check('A7 the chips other modules create live only in the menu, and the old Change-password link is not in the bar',
      ['fcUserChip', 'fcDbChip', 'fcCompanyLink', 'fcSignOutLink'].every(id => !$(id) || $(id).parentNode === menu) &&
      !D.querySelector('.top #fcChangePwLink'));
    check('A8 no Sign out while sign-in is not enforced, and no Company accounts shortcut with no server identity',
      !$('fcSignOutLink') && $('fcmAccounts').style.display === 'none');
    check('A9 the avatar shows the real initials, not a hard-coded "FA"', /^[A-Z?]{1,2}$/.test($('avBtn').textContent) && $('avBtn').getAttribute('aria-label').startsWith('Account menu'));

    /* open / close */
    $('avBtn').click();
    check('A10 clicking the avatar opens the menu and says so for screen readers',
      menu.classList.contains('on') && $('avBtn').getAttribute('aria-expanded') === 'true');
    $('avBtn').click();
    check('A11 clicking it again closes it', !menu.classList.contains('on'));
    $('avBtn').click();
    D.body.click();
    check('A12 clicking anywhere else closes it', !menu.classList.contains('on'));
    $('avBtn').click();
    D.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('A13 Escape closes it', !menu.classList.contains('on'));

    /* theme lives in the menu too (the bar's own switch is hidden on a phone) */
    const before = D.documentElement.getAttribute('data-theme') === 'dark';
    $('avBtn').click(); $('fcmTheme').click(); await sleep(30);
    const after = D.documentElement.getAttribute('data-theme') === 'dark';
    check('A14 "Dark mode" in the menu switches the theme through the app\'s own switch and closes the menu',
      before !== after && !menu.classList.contains('on'));
    check('A15 …and its label follows the state', $('fcmThemeLbl').textContent === (after ? 'Light mode' : 'Dark mode'));

    /* bell */
    const dot = $('bellBtn').querySelector('.dot');
    const low = (w.PRODUCTS || []).filter(p => w.levelOf(p) !== 'ok').length;
    check('A16 the bell\'s red dot shows exactly when some product is low or out (' + low + ' now)', dot.classList.contains('fcm-none') === (low === 0));
    const saved = w.PRODUCTS.slice(); w.PRODUCTS.length = 0; w.ERP.TopBar.refresh();
    check('A17 with no products needing attention the dot is hidden', dot.classList.contains('fcm-none'));
    saved.forEach(p => w.PRODUCTS.push(p)); w.ERP.TopBar.refresh();

    /* database-status warning must never be hidden by living in a menu */
    const chip = $('fcDbChip');
    chip.className = 'fcdb warn'; w.ERP.TopBar.refresh();
    check('A18 a database warning puts a dot on the avatar (so it cannot hide inside the closed menu)', $('avBtn').classList.contains('fcm-warn') && !$('avBtn').classList.contains('fcm-bad'));
    chip.className = 'fcdb bad'; w.ERP.TopBar.refresh();
    check('A19 …and a red one when the problem is serious', $('avBtn').classList.contains('fcm-bad'));
    chip.className = 'fcdb'; w.ERP.TopBar.refresh();
    check('A20 …and clears when it is healthy again', !$('avBtn').classList.contains('fcm-warn'));

    /* survives repaints: nothing duplicated, nothing lost */
    for (let i = 0; i < 4; i++) { w.go(i % 2 ? 'inventory' : 'dashboard'); await sleep(30); }
    check('A21 after several page changes there is still exactly one of each element',
      ['fcAcctMenu', 'fcUserChip', 'fcDbChip', 'fcSearchBtn', 'avBtn'].every(id => D.querySelectorAll('#' + id).length === 1) &&
      D.querySelectorAll('#fcCompanyLink').length === 1 && !$('whBtn') && !$('syncBtn'));
    check('A22 the moved chips are still inside the menu after the repaints', menu.contains($('fcUserChip')) && menu.contains($('fcDbChip')));

    /* the moved sign-in chip must still do its job */
    $('fcUserChip').click(); await sleep(100);
    check('A23 the signed-in-user chip still opens the "who is using the ERP" screen from inside the menu', !!D.querySelector('#fcSignin.on'));
    w.close();
  }

  /* ── B: signed in to the server, sign-in enforced ── */
  {
    const w = boot({ idb: new FDBFactory() }, mockFetch({ 'me.php': () => ({ status: 200, data: OWNER }), 'logout.php': () => ({ status: 200, data: { ok: true } }) }));
    await ready(w);
    const D = w.document, $ = id => D.getElementById(id);
    const menu = $('fcAcctMenu');
    check('B1 signed in: the menu shows the name, and Company accounts is offered', menu.contains($('fcUserChip')) && /Farooq Ahmed/.test($('fcUserChip').textContent) && $('fcmAccounts').style.display !== 'none');
    check('B2 the avatar shows the person\'s initials', $('avBtn').textContent === 'FA');
    check('B3 the owner\'s Company accounts row says what it is for', /manage staff/.test($('fcmAccountsSub').textContent));
    check('B4 enforced: Sign out is in the menu and the user chip is display-only',
      !!$('fcSignOutLink') && menu.contains($('fcSignOutLink')) && $('fcUserChip').disabled === true);
    check('B5 "Company sign-in" and the old Change-password link are gone', !$('fcCompanyLink') && !$('fcChangePwLink'));
    $('avBtn').click(); $('fcmAccounts').click(); await sleep(250);
    check('B6 "Company accounts" in the menu opens that screen and closes the menu',
      w.cur === 'accounts' && !menu.classList.contains('on') && /My account/.test(D.getElementById('view').innerHTML));
    check('B7 the screen carries the Change password button', !!D.querySelector('#view [data-fc-chpw]'));
    D.querySelector('#view [data-fc-chpw]').click();
    check('B8 that button opens the change-password box (with Cancel, since it is voluntary)', !!D.querySelector('#fcChangePw.on') && !!$('fcPwCancel'));
    $('fcPwCancel').click();
    w.close();
  }

  /* ── C: a non-owner sees a smaller menu ── */
  {
    const me = { ...OWNER, role: 'SALES', permissions: ['SALES_CREATE', 'COLLECTION_VIEW'], user: { id: 'usr_2', username: 'kamran', displayName: 'Kamran Sales' } };
    const w = boot({ idb: new FDBFactory() }, mockFetch({ 'me.php': () => ({ status: 200, data: me }) }));
    await ready(w);
    const $ = id => w.document.getElementById(id);
    check('C1 a non-owner\'s Company accounts row only talks about their own password', $('fcmAccountsSub').textContent === 'Change your password');
    check('C2 the avatar shows their initials', $('avBtn').textContent === 'KS');
    w.close();
  }

  check('Z1 nothing threw during the whole session', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(out.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.log(out.join('\n')); console.error('CRASH', e); process.exit(1); });
