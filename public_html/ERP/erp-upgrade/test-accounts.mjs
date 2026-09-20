/* Module 34 — COMPANY ACCOUNTS screen and who may open which screen.
   Drives the real built app in jsdom against a mocked users.php that applies the
   same rules as the real endpoint (owner only, CSRF, duplicate usernames, the
   last owner can't be removed). Never touches the network. */
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
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const result = handler(body, opts || {});
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
  await sleep(200);
  return w.ERP;
}
const type = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };

const PERMS = {
  OWNER: ['*'],
  MANAGER: ['MASTER_DATA_VIEW', 'PURCHASE_CREATE', 'SALES_CREATE', 'PAYMENT_CREATE', 'COLLECTION_VIEW', 'FINANCIAL_REPORT_VIEW', 'TRANSACTION_CORRECT'],
  ACCOUNTANT: ['MASTER_DATA_VIEW', 'PAYMENT_CREATE', 'COLLECTION_VIEW', 'FINANCIAL_REPORT_VIEW'],
  SALES: ['MASTER_DATA_VIEW', 'SALES_CREATE', 'PAYMENT_CREATE', 'COLLECTION_VIEW', 'CUSTOMER_EDIT'],
  INVENTORY: ['MASTER_DATA_VIEW', 'STOCK_MANAGE'],
};
const identityFor = role => ({
  user: { id: 'usr_1', username: 'owner', displayName: 'Farooq Ahmed' }, role, permissions: PERMS[role], csrf: 'c1', enforce: false,
});

async function signedInAs(role, extraRoutes) {
  const store = { idb: new FDBFactory() };
  const w = boot(store, mockFetch(Object.assign({
    'me.php': () => ({ status: 200, data: identityFor(role) }),
  }, extraRoutes || {})));
  const ERP = await ready(w);
  await sleep(200);
  return { w, ERP };
}

async function main() {
  /* ── A: SCREEN ACCESS ── */
  const isLocked = html => /is not open to you/.test(html);
  {
    const store = { idb: new FDBFactory() };
    const w = boot(store, mockFetch({ 'me.php': () => ({ status: 401, data: {} }) }));
    await ready(w); await sleep(150);
    check('A1 with no server session (today\'s live state) Payroll, Milling and Statements open exactly as before',
      !isLocked(w.PAGES.payroll()) && !isLocked(w.PAGES.milling()) && !isLocked(w.PAGES.soa()));
    check('A2 …and Company accounts tells the owner to sign in first instead of failing',
      /Sign in with your company account first/.test(w.PAGES.accounts()));
    check('A2b the guards are applied exactly once (no stacked wrappers)', ['payroll', 'milling', 'soa'].every(k => w.PAGES[k].__fcGuarded === true));
    check('A2c Company accounts is NOT a wholesale-guarded screen: everyone signed in may open it for "My account"', !w.PAGES.accounts.__fcGuarded);
    w.close();
  }
  const expect = {
    OWNER:      { payroll: true,  milling: true,  soa: true  },
    MANAGER:    { payroll: false, milling: true,  soa: true  },
    ACCOUNTANT: { payroll: false, milling: false, soa: true  },
    SALES:      { payroll: false, milling: false, soa: true  },
    INVENTORY:  { payroll: false, milling: false, soa: false },
  };
  for (const role of Object.keys(expect)) {
    let usersCalls = 0;
    const { w } = await signedInAs(role, { 'users.php': () => { usersCalls++; return { status: 200, data: { users: [] } }; } });
    const got = {}; for (const k of Object.keys(expect[role])) got[k] = !isLocked(w.PAGES[k]());
    check('A3 ' + role + ': screens open = ' + JSON.stringify(expect[role]), JSON.stringify(got) === JSON.stringify(expect[role]), JSON.stringify(got));
    /* Company accounts: My account for everyone, the staff list for the owner only */
    const acc = w.PAGES.accounts(); await sleep(150);
    check('A3b ' + role + ': Company accounts opens with "My account" and a Change password button',
      !isLocked(acc) && /My account/.test(acc) && /data-fc-chpw/.test(acc) && /Farooq Ahmed/.test(acc));
    check('A3c ' + role + ': the staff list ' + (role === 'OWNER' ? 'is shown' : 'is NOT shown, and the accounts are never even requested'),
      role === 'OWNER' ? (/data-acct-add|Loading accounts/.test(acc) && usersCalls === 1)
                       : (!/data-acct-add|Loading accounts|Add account/.test(acc) && usersCalls === 0), 'calls=' + usersCalls);
    if (role === 'SALES') {
      check('A4 a locked screen says so plainly and points at the owner', /Payroll is not open to you/.test(w.PAGES.payroll()) && /Ask the owner/.test(w.PAGES.payroll()));
    }
    w.close();
  }

  /* ── B: THE ACCOUNTS SCREEN ── */
  let users, posts, mode, hostileName = '<img src=x onerror=window.__pwned=1>';
  const reset = () => {
    users = [
      { id: 'usr_1', username: 'owner', displayName: 'Farooq Ahmed', role: 'OWNER', phone: null, isActive: true, lastLoginAt: '2026-09-17 06:59:45', createdAt: '2026-09-16 10:00:00' },
      { id: 'usr_2', username: 'kamran.sales', displayName: 'Kamran Sales', role: 'SALES', phone: '0300 1112223', isActive: true, lastLoginAt: null, createdAt: '2026-09-18 10:00:00' },
      { id: 'usr_3', username: 'old.helper', displayName: 'Old Helper', role: 'INVENTORY', phone: null, isActive: false, lastLoginAt: '2026-09-10 08:00:00', createdAt: '2026-09-11 10:00:00' },
    ];
    posts = []; mode = 'ok';
  };
  reset();
  const usersRoute = (body, opts) => {
    if (mode === 'down') throw new Error('network down');
    if (opts.method === 'GET') {
      if (mode === '500') return { status: 500, data: { error: 'Could not reach the database.' } };
      return { status: 200, data: { users: users.map(u => ({ ...u })) } };
    }
    posts.push({ body, csrf: opts.headers && opts.headers['X-CSRF-Token'] });
    if (mode === '403') return { status: 403, data: { error: 'Only the owner can manage accounts.' } };
    const find = id => users.find(u => u.id === id);
    switch (body.action) {
      case 'create':
        if (users.some(u => u.username === body.username)) return { status: 422, data: { validation: ['That username is taken.'] } };
        users.push({ id: 'usr_' + (users.length + 10), username: body.username, displayName: body.displayName, role: body.role, phone: body.phone || null, isActive: true, lastLoginAt: null });
        return { data: { user: {} } };
      case 'update': { const u = find(body.id); if (!u) return { status: 404, data: { error: 'That account no longer exists.' } };
        u.displayName = body.displayName; u.role = body.role; u.phone = body.phone || null; return { data: { ok: true } }; }
      case 'archive': { const u = find(body.id); if (u.role === 'OWNER') return { status: 422, data: { validation: ['This is the only owner account — it cannot be switched off.'] } };
        u.isActive = false; return { data: { ok: true } }; }
      case 'restore': find(body.id).isActive = true; return { data: { ok: true } };
      case 'reset_password': return { data: { ok: true } };
    }
    return { status: 400, data: { error: 'Unknown action.' } };
  };

  const { w, ERP } = await signedInAs('OWNER', { 'users.php': usersRoute });
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const said = []; w.say = m => said.push(m);
  const view = () => w.document.getElementById('view').innerHTML;
  const settle = async () => { await sleep(120); };

  check('B1 "Company accounts" is in the Admin menu group',
    w.NAVGROUPS.some(g => g[0] === 'Admin' && g[1].includes('accounts')) && w.NAV.some(n => n.id === 'accounts'));
  w.go('accounts'); await sleep(400);
  check('B2 the screen lists every account with name, username and last sign-in',
    /Farooq Ahmed/.test(view()) && /kamran\.sales/.test(view()) && /Old Helper/.test(view()) && /2026-09-17 06:59/.test(view()) && /Never/.test(view()));
  check('B3 your own row is marked "You" and offers no "Switch off"',
    /Farooq Ahmed<\/b> <span class="pill neu">You/.test(view()) && $$('[data-acct-off]').length === 1 && $$('[data-acct-off]')[0].dataset.acctOff === 'usr_2');
  check('B4 a switched-off account offers "Switch on" and is shown as switched off', $$('[data-acct-on]').length === 1 && /Switched off/.test(view()));

  /* add */
  $('[data-acct-add]').click(); await sleep(30);
  check('B5 "Add account" opens the form with the Sales role preselected', $('#fcAcctForm').classList.contains('on') && $('#fcAcctRole').value === 'SALES');
  check('B5b every role is offered', ['OWNER', 'MANAGER', 'ACCOUNTANT', 'SALES', 'INVENTORY'].every(r => !!$('#fcAcctRole option[value="' + r + '"]')));
  $('#fcAcctGen').click();
  const gen = $('#fcAcctPw').value;
  check('B6 "Make one" fills a 12-character temporary password with no look-alike characters', /^[a-hj-km-np-zA-HJ-NP-Z2-9]{12}$/.test(gen), gen);
  $('#fcAcctGen').click();
  check('B6b …and a different one each time', $('#fcAcctPw').value !== gen);

  $('#fcAcctSave').click(); await settle();
  check('B7 saving an empty form is refused with a reason and sends nothing', /Enter the person/.test($('#fcAcctErr').textContent) && posts.length === 0);
  type(w, $('#fcAcctName'), 'Bilal Accounts'); type(w, $('#fcAcctUser'), 'a b'); $('#fcAcctSave').click(); await settle();
  check('B7b a bad username is refused client-side', /Username must be/.test($('#fcAcctErr').textContent) && posts.length === 0);
  type(w, $('#fcAcctUser'), 'bilal.acc'); type(w, $('#fcAcctPw'), 'short'); $('#fcAcctSave').click(); await settle();
  check('B7c a short password is refused client-side', /at least 8/.test($('#fcAcctErr').textContent) && posts.length === 0);

  /* duplicate username: the form must stay open, keep what was typed, and say why */
  type(w, $('#fcAcctUser'), 'kamran.sales'); type(w, $('#fcAcctPw'), 'Temp-pass-1'); $('#fcAcctRole').value = 'ACCOUNTANT';
  $('#fcAcctSave').click(); await settle();
  check('B8 a taken username keeps the form open with the server\'s reason',
    $('#fcAcctForm').classList.contains('on') && /username is taken/.test($('#fcAcctErr').textContent));
  check('B8b …keeps everything already typed and re-enables Save',
    $('#fcAcctName').value === 'Bilal Accounts' && $('#fcAcctPw').value === 'Temp-pass-1' && $('#fcAcctSave').disabled === false);

  type(w, $('#fcAcctUser'), 'bilal.acc'); $('#fcAcctSave').click(); await sleep(350);
  const created = posts[posts.length - 1];
  check('B9 a valid account is created with the right fields and the CSRF token',
    created && created.body.action === 'create' && created.body.username === 'bilal.acc' && created.body.displayName === 'Bilal Accounts' &&
    created.body.role === 'ACCOUNTANT' && created.body.password === 'Temp-pass-1' && created.csrf === 'c1', JSON.stringify(created));
  check('B9b the form closes, the list refreshes with the new person, and the owner is told what to hand over',
    !$('#fcAcctForm').classList.contains('on') && /Bilal Accounts/.test(view()) && said.some(m => /temporary password/.test(m)));

  /* edit */
  $$('[data-acct-edit]').find(b => b.dataset.acctEdit === 'usr_2').click(); await sleep(30);
  check('B10 Edit pre-fills the person and shows their username but does not let it be changed',
    $('#fcAcctName').value === 'Kamran Sales' && $('#fcAcctRole').value === 'SALES' && $('#fcAcctPhone').value === '0300 1112223' && !$('#fcAcctUser') && /kamran\.sales/.test($('#fcAcctForm').textContent));
  $('#fcAcctRole').value = 'MANAGER'; $('#fcAcctSave').click(); await sleep(350);
  const upd = posts[posts.length - 1];
  check('B11 changing a role sends an update for that person only, and the list shows it',
    upd.body.action === 'update' && upd.body.id === 'usr_2' && upd.body.role === 'MANAGER' && !('password' in upd.body) && /Manager/.test(view()));

  /* reset password */
  $$('[data-acct-pw]').find(b => b.dataset.acctPw === 'usr_2').click(); await sleep(30);
  check('B12 Reset password shows only the password field', !!$('#fcAcctPw') && !$('#fcAcctName') && /Kamran Sales/.test($('#fcAcctForm').textContent));
  type(w, $('#fcAcctPw'), 'abc'); $('#fcAcctSave').click(); await settle();
  check('B12b a short reset is refused', /at least 8/.test($('#fcAcctErr').textContent) && posts[posts.length - 1].body.action === 'update');
  type(w, $('#fcAcctPw'), 'Fresh-temp-77'); $('#fcAcctSave').click(); await sleep(350);
  check('B12c a good reset is sent and confirmed',
    posts[posts.length - 1].body.action === 'reset_password' && posts[posts.length - 1].body.password === 'Fresh-temp-77' && said.some(m => /Password reset/.test(m)));

  /* switch off / on */
  w.confirm = () => false;
  const before = posts.length;
  $$('[data-acct-off]').find(b => b.dataset.acctOff === 'usr_2').click(); await settle();
  check('B13 switching off asks first, and "No" changes nothing', posts.length === before);
  w.confirm = () => true;
  $$('[data-acct-off]').find(b => b.dataset.acctOff === 'usr_2').click(); await sleep(350);
  check('B14 confirming switches the account off and the row updates',
    posts[posts.length - 1].body.action === 'archive' && posts[posts.length - 1].body.id === 'usr_2' &&
    $$('[data-acct-on]').some(b => b.dataset.acctOn === 'usr_2'));
  $$('[data-acct-on]').find(b => b.dataset.acctOn === 'usr_2').click(); await sleep(350);
  check('B15 "Switch on" restores it', posts[posts.length - 1].body.action === 'restore' && !$$('[data-acct-on]').some(b => b.dataset.acctOn === 'usr_2'));

  /* the server says no */
  mode = '403'; said.length = 0;
  $$('[data-acct-off]').find(b => b.dataset.acctOff === 'usr_2').click(); await settle();
  check('B16 a server refusal is reported to the owner, not swallowed', said.some(m => /Only the owner/.test(m)));
  mode = 'ok';

  /* hostile / awkward data */
  users.push({ id: 'usr_9', username: 'x.y', displayName: hostileName, role: 'SALES', phone: 'a"b', isActive: true, lastLoginAt: null });
  await ERP.Accounts.load(); await sleep(100);
  check('B17 a name containing HTML is shown as text, never executed', !w.__pwned && !$('#view img') && /&lt;img/.test(view()));
  $$('[data-acct-edit]').find(b => b.dataset.acctEdit === 'usr_9').click(); await sleep(30);
  check('B17b …and comes back byte-for-byte in the edit form (quotes included)', $('#fcAcctName').value === hostileName && $('#fcAcctPhone').value === 'a"b');
  $('#fcAcctCancel').click();
  check('B18 Cancel closes the form without sending anything', !$('#fcAcctForm').classList.contains('on'));

  /* load failures */
  ERP.Accounts._reset(); mode = '500'; w.go('accounts'); await sleep(300);
  check('B19 if the list can\'t load it says so and offers "Try again"', /Could not reach the database/.test(view()) && !!$('[data-acct-reload]'));
  mode = 'ok'; $('[data-acct-reload]').click(); await sleep(400);
  check('B19b "Try again" recovers', /Farooq Ahmed/.test(view()) && !$('[data-acct-reload]'));
  ERP.Accounts._reset(); mode = 'down'; w.go('accounts'); await sleep(300);
  check('B20 a dead connection is reported, not a blank screen', /Could not reach the server/.test(view()));
  mode = 'ok';
  w.close();

  check('Z1 nothing threw during the whole session', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log('\n' + out.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
