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

/* A tiny fetch mock standing in for the PHP API. Each test installs its own
   `w.fetch` implementation rather than hitting the network — this file never
   depends on the live server being reachable. */
function mockFetch(routes) {
  return async (url, opts) => {
    const path = String(url).replace(/^.*api\/auth\//, '');
    const handler = routes[path];
    if (!handler) throw new Error('no mock route for ' + path);
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const result = handler(body, opts);
    return {
      status: result.status || 200,
      json: async () => result.data !== undefined ? result.data : result,
    };
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
      w.matchMedia = q => ({ media: q, matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} });
      // jsdom's window.crypto has no .subtle — Node's webcrypto fills in for
      // the PBKDF2 offline-verifier code path. window.crypto itself is a
      // getter-only property in this jsdom version, so patch the members.
      w.crypto.subtle = webcrypto.subtle;
      if (!w.crypto.getRandomValues) w.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
      w.fetch = fetchImpl || (async () => { throw new Error('offline'); });
      // localStorage persists per-store across reboots, same pattern as idb.
      // window.localStorage is a getter-only accessor in this jsdom version,
      // so replace the property descriptor rather than assigning directly.
      store.ls = store.ls || {};
      Object.defineProperty(w, 'localStorage', {
        configurable: true,
        value: {
          getItem: k => (k in store.ls ? store.ls[k] : null),
          setItem: (k, v) => { store.ls[k] = String(v); },
          removeItem: k => { delete store.ls[k]; },
        },
      });
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

const OWNER_PERMS = ['*'];
const SALES_PERMS = ['MASTER_DATA_VIEW', 'SALES_CREATE', 'PAYMENT_CREATE', 'COLLECTION_VIEW', 'CUSTOMER_EDIT'];

function b64url(obj) {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fakeTicket(payload) { return b64url(payload) + '.deadbeef'; /* signature not checked client-side */ }

async function main() {
  /* ── A: no server identity — behaves exactly like before this module existed ── */
  {
    const store = { idb: new FDBFactory() };
    const w = boot(store, mockFetch({ 'me.php': () => ({ status: 401, data: { error: 'Not signed in.' } }) }));
    const ERP = await ready(w);
    await sleep(150);
    check('A1 with no server session, ERP.Auth has no identity', ERP.Auth.identity === null);
    check('A2 RBAC.can is untouched — still the module-19/22 client behaviour',
      ERP.RBAC.role() === 'OWNER' && ERP.RBAC.can('PROFIT_VIEW') === true);
    check('A3 the app still renders normally (observe mode never blocks)',
      !!w.document.getElementById('view') && w.document.getElementById('view').innerHTML.length > 0);
    w.close();
  }

  /* ── B: successful login switches Session/RBAC to the server identity ── */
  {
    const store = { idb: new FDBFactory() };
    let loggedIn = false;
    const w = boot(store, mockFetch({
      'me.php': () => loggedIn
        ? { status: 200, data: { user: { id: 'usr_1', username: 'owner', displayName: 'Farooq Ahmed' }, role: 'OWNER', permissions: OWNER_PERMS, csrf: 'c1' } }
        : { status: 401, data: { error: 'Not signed in.' } },
      'login.php': (body) => {
        if (body.username === 'owner' && body.password === 'right-pw') {
          loggedIn = true;
          return { status: 200, data: {
            user: { id: 'usr_1', username: 'owner', displayName: 'Farooq Ahmed' }, role: 'OWNER',
            permissions: OWNER_PERMS, csrf: 'c1', offlineTicket: fakeTicket({ uid: 'usr_1', role: 'OWNER', perms: OWNER_PERMS, exp: Math.floor(Date.now() / 1000) + 3600 }),
            expiresAt: '2099-01-01 00:00:00',
          } };
        }
        return { status: 401, data: { error: 'That username or password is not right.' } };
      },
    }));
    const ERP = await ready(w);
    await sleep(150);

    check('B1 a wrong password is rejected with the generic server message',
      await ERP.Auth.login('owner', 'wrong').then(() => false).catch(e => /not right/i.test(e.validation[0])));
    check('B2 the right password signs in', !!(await ERP.Auth.login('owner', 'right-pw')));
    check('B3 Session.name/role/id now read from the server identity',
      ERP.Session.name() === 'Farooq Ahmed' && ERP.Session.role() === 'OWNER' && ERP.Session.id() === 'usr_1');
    check('B4 RBAC.can defers to the server permission list', ERP.RBAC.can('PROFIT_VIEW') === true);
    check('B5 CURRENT_USER is updated too (existing modules read this global)', w.CURRENT_USER === 'Farooq Ahmed');
    check('B6 an offline ticket was cached', !!store.ls[ERP.Auth._internal.TICKET_KEY]);
    check('B7 an offline password verifier was cached (PBKDF2)', !!store.ls[ERP.Auth._internal.VERIFIER_KEY]);
    w.go('dashboard'); await sleep(150);
    check('B7b the "Company sign-in" link disappears once actually signed in',
      !w.document.getElementById('fcCompanyLink'));

    await ERP.Auth.logout();
    check('B8 signing out clears the identity', ERP.Auth.identity === null);
    check('B9 signing out clears the offline ticket too', !store.ls[ERP.Auth._internal.TICKET_KEY]);
    w.go('dashboard'); await sleep(150);
    check('B9b the "Company sign-in" link comes back after signing out',
      !!w.document.getElementById('fcCompanyLink'));
    w.close();
  }

  /* ── C: a non-owner role is denied permissions the server didn't grant ── */
  {
    const store = { idb: new FDBFactory() };
    const w = boot(store, mockFetch({
      'me.php': () => ({ status: 401, data: {} }),
      'login.php': () => ({ status: 200, data: {
        user: { id: 'usr_2', username: 'salesman', displayName: 'Kamran Sales' }, role: 'SALES',
        permissions: SALES_PERMS, csrf: 'c2',
      } }),
    }));
    const ERP = await ready(w);
    await ERP.Auth.login('salesman', 'x');
    check('C1 a SALES account gets exactly the server-issued permission list',
      ERP.RBAC.can('SALES_CREATE') === true && ERP.RBAC.can('PROFIT_VIEW') === false && ERP.RBAC.can('COLLECTION_EXPORT') === false);
    check('C2 a permission absent from the server response fails CLOSED, not open',
      ERP.RBAC.can('SOME_MADE_UP_PERM_NOT_IN_LIST') === false);
    w.close();
  }

  /* ── D: offline grace period — a cached, unexpired ticket is trusted ── */
  {
    const store = { idb: new FDBFactory() };
    const w = boot(store, mockFetch({})); // every route throws -> "offline" from the first boot
    // seed a still-valid ticket as if a prior online login had happened
    store.ls = {};
    const w0 = boot(store, mockFetch({
      'login.php': () => ({ status: 200, data: {
        user: { id: 'usr_3', username: 'owner2', displayName: 'Owner Two' }, role: 'OWNER', permissions: OWNER_PERMS, csrf: 'c3',
        offlineTicket: fakeTicket({ uid: 'usr_3', role: 'OWNER', perms: OWNER_PERMS, exp: Math.floor(Date.now() / 1000) + 3600 }),
      } }),
      'me.php': () => ({ status: 401, data: {} }),
    }));
    const ERP0 = await ready(w0);
    await ERP0.Auth.login('owner2', 'pw');
    await sleep(50);
    w0.close();

    // reboot fully offline (fetch always throws) with the SAME localStorage
    const wOff = boot(store, async () => { throw new Error('network down'); });
    const ERPoff = await ready(wOff);
    await sleep(200);
    check('D1 offline at boot, a still-valid cached ticket is trusted',
      ERPoff.Session.role() === 'OWNER' && ERPoff.RBAC.can('PROFIT_VIEW') === true);
    wOff.close();
  }

  /* ── E: offline grace period — an EXPIRED ticket is refused, not trusted ── */
  {
    const store = { ls: {} };
    store.ls[Object.keys({}).length ? '' : ''] = undefined; // no-op, keep shape explicit
    const key = 'farooqco_auth_ticket';
    store.ls[key] = JSON.stringify({
      ticket: fakeTicket({ uid: 'usr_4', role: 'OWNER', perms: OWNER_PERMS, exp: Math.floor(Date.now() / 1000) - 10 }),
      savedAt: Date.now() - 999999,
    });
    const w = boot(store, async () => { throw new Error('offline'); });
    const ERP = await ready(w);
    await sleep(200);
    check('E1 an expired offline ticket is NOT trusted', ERP.Auth.identity === null);
    check('E2 the app still renders (falls back to the pre-existing client-only behaviour)',
      !!w.document.getElementById('view'));
    w.close();
  }

  /* ── F: there is NO idle lock (removed 2026-09-21 at the owner's request); the sign-in screen that
         comes back when the session really ends can be released offline with the correct password via
         the PBKDF2 verifier ── */
  {
    const store = { idb: new FDBFactory() };
    const w = boot(store, mockFetch({
      'me.php': () => ({ status: 401, data: {} }),
      'login.php': (body) => body.password === 'secret123'
        ? { status: 200, data: {
            user: { id: 'usr_5', username: 'owner3', displayName: 'Owner Three' }, role: 'OWNER', permissions: OWNER_PERMS, csrf: 'c5',
            offlineTicket: fakeTicket({ uid: 'usr_5', role: 'OWNER', perms: OWNER_PERMS, exp: Math.floor(Date.now() / 1000) + 3600 }),
          } }
        : { status: 401, data: { error: 'That username or password is not right.' } },
    }));
    const ERP = await ready(w);
    ERP.Auth.IDLE_MS = 30;    /* what the old idle timer would have used — it must no longer be read by anything */
    await ERP.Auth.login('owner3', 'secret123');
    await sleep(250);
    w.document.dispatchEvent(new w.Event('mousemove')); await sleep(250);
    const lockEl = w.document.getElementById('fcAuthLock');
    check('F1 signed in and left alone: the screen is NOT locked for being idle (no password asked again)',
      ERP.Auth.locked === false && !(lockEl && lockEl.classList.contains('on')));
    check('F1b the idle lock code is gone (no lockScreen / idle-watch entry points, no idle timer)',
      !ERP.Auth._internal.lockScreen && !ERP.Auth._internal.startIdleWatch && !ERP.Auth._internal.stopIdleWatch && !ERP.Auth._idleTimer);

    // the session really ending is what brings the sign-in screen back
    ERP.Auth._internal.sessionEnded();
    check('F2 the sign-in screen appears when the session has ended', !!w.document.getElementById('fcAuthLock').classList.contains('on'));

    ERP.Auth.online = false; // simulate connectivity loss while locked
    check('F3 the wrong password is refused offline',
      await ERP.Auth._internal.unlockWith('wrong-one').then(() => false).catch(e => /not right/i.test(e.validation[0])));
    check('F4 still locked after a wrong attempt', ERP.Auth.locked === true);
    await ERP.Auth._internal.unlockWith('secret123');
    check('F5 the right password unlocks offline via the cached verifier', ERP.Auth.locked === false);
    w.close();
  }

  /* ── G: change password — forced on a must-change account, voluntary otherwise ── */
  {
    const store = { idb: new FDBFactory() };
    let currentHash = 'temp-pw-123';
    const w = boot(store, mockFetch({
      'me.php': () => ({ status: 401, data: {} }),
      'login.php': (body) => body.password === currentHash
        ? { status: 200, data: {
            user: { id: 'usr_6', username: 'owner4', displayName: 'Owner Four' }, role: 'OWNER',
            permissions: OWNER_PERMS, csrf: 'c6', mustChangePassword: true,
          } }
        : { status: 401, data: { error: 'That username or password is not right.' } },
      'change-password.php': (body) => {
        if (body.currentPassword !== currentHash) return { status: 401, data: { error: 'Your current password is not right.' } };
        currentHash = body.newPassword;
        return { status: 200, data: { ok: true } };
      },
    }));
    const ERP = await ready(w);
    await ERP.Auth.login('owner4', 'temp-pw-123');
    await sleep(50);
    check('G1 a must-change account is prompted automatically on login',
      !!w.document.getElementById('fcChangePw') && w.document.getElementById('fcChangePw').classList.contains('on'));
    check('G2 the forced prompt offers no Cancel — it cannot be dismissed without changing it',
      !w.document.getElementById('fcPwCancel'));

    const setVal = (id, v) => { const el = w.document.getElementById(id); el.value = v; };
    setVal('fcPwCur', 'temp-pw-123'); setVal('fcPwNew', 'short'); setVal('fcPwConf', 'short');
    w.document.getElementById('fcPwGo').click();
    await sleep(50);
    check('G3 a too-short new password is refused client-side before any request',
      /at least 8/i.test(w.document.getElementById('fcPwErr').textContent));

    setVal('fcPwNew', 'brand-new-password'); setVal('fcPwConf', 'does-not-match');
    w.document.getElementById('fcPwGo').click();
    await sleep(50);
    check('G4 mismatched confirmation is refused client-side', /do not match/i.test(w.document.getElementById('fcPwErr').textContent));

    setVal('fcPwConf', 'brand-new-password');
    w.document.getElementById('fcPwGo').click();
    await sleep(50);
    check('G5 the right current password and a valid new one succeed',
      /changed/i.test(w.document.getElementById('fcPwOk').textContent));
    check('G6 Auth.mustChangePassword clears once changed', ERP.Auth.mustChangePassword === false);
    await sleep(750);
    check('G7 the overlay closes itself shortly after success', !w.document.getElementById('fcChangePw').classList.contains('on'));

    // voluntary access once not forced: "Change password" on the Company accounts screen, with Cancel offered
    w.go('dashboard'); await sleep(150);
    check('G8 "Company sign-in" is gone once signed in, and there is no Change-password link in the top bar any more',
      !w.document.getElementById('fcChangePwLink') && !w.document.getElementById('fcCompanyLink'));
    w.go('accounts'); await sleep(200);
    check('G8b Change password lives in "My account" on the Company accounts screen',
      !!w.document.querySelector('#view [data-fc-chpw]') && /My account/.test(w.document.getElementById('view').innerHTML));
    w.document.querySelector('#view [data-fc-chpw]').click();
    check('G9 opening it voluntarily DOES offer Cancel', !!w.document.getElementById('fcPwCancel'));
    w.document.getElementById('fcPwCancel').click();
    check('G10 Cancel closes it without changing anything', !w.document.getElementById('fcChangePw').classList.contains('on'));
    w.close();
  }

  /* ── H: ENFORCE MODE (Phase 3) — the server says sign-in is mandatory ── */
  {
    const nowSec = () => Math.floor(Date.now() / 1000);
    const ticketFor = (perms, expIn) => fakeTicket({ uid: 'usr_1', role: perms.includes('*') ? 'OWNER' : 'SALES', perms, exp: nowSec() + expIn });
    const meOwner = (extra) => ({ status: 200, data: Object.assign({
      user: { id: 'usr_1', username: 'owner', displayName: 'Farooq Ahmed' }, role: 'OWNER', permissions: OWNER_PERMS,
      csrf: 'c1', enforce: true, offlineTicket: ticketFor(OWNER_PERMS, 43200),
    }, extra || {}) });

    let meMode = 'ok', meCalls = 0, logoutCalls = 0, loginCalls = 0;
    const routes = {
      'me.php': () => {
        meCalls++;
        if (meMode === 'ok') return meOwner();
        if (meMode === 'sales') return { status: 200, data: { user: { id: 'usr_1', username: 'owner', displayName: 'Farooq Ahmed' }, role: 'SALES', permissions: SALES_PERMS, csrf: 'c1', enforce: true } };
        if (meMode === '401') return { status: 401, data: { error: 'Not signed in.' } };
        if (meMode === '500') return { status: 500, data: { error: 'boom' } };
        if (meMode === 'down') throw new Error('network down');
        return meOwner();
      },
      'login.php': (body) => {
        loginCalls++;
        if (body.password === 'right-pw') { meMode = 'ok'; return meOwner(); }
        return { status: 401, data: { error: 'That username or password is not right.' } };
      },
      'logout.php': () => { logoutCalls++; return { status: 200, data: { ok: true } }; },
    };
    const store = { idb: new FDBFactory() };
    const w = boot(store, mockFetch(routes));
    const ERP = await ready(w);
    await sleep(200);
    let reloads = 0; ERP.Auth._reload = () => { reloads++; };

    check('H1 the server\'s enforce:true flips Auth.mode to "enforce"', ERP.Auth.mode === 'enforce');
    check('H2 the heartbeat starts in enforce mode', ERP.Auth._internal.heartbeatRunning() === true);
    check('H3 me.php\'s ticket was cached — a gate-signed-in device has NO other source for one',
      !!store.ls[ERP.Auth._internal.TICKET_KEY] && !!ERP.Auth._internal.validCachedTicket());

    w.go('dashboard'); await sleep(150);
    const chip = w.document.getElementById('fcUserChip');
    check('H4 the module-22 "switch user" chip is display-only (disabled)', !!chip && chip.disabled === true);
    chip && chip.click(); await sleep(50);
    const si = w.document.getElementById('fcSignin');
    check('H5 clicking it opens no local user picker', !si || !si.classList.contains('on'));
    check('H6 no "Company sign-in" link (already signed in) but a "Sign out" link is offered',
      !w.document.getElementById('fcCompanyLink') && !!w.document.getElementById('fcSignOutLink'));

    /* the heartbeat picks up a server-side role change without a reload */
    meMode = 'sales';
    await ERP.Auth._internal.beat();
    check('H7 a heartbeat refreshes permissions from the server (role change takes effect live)',
      ERP.Auth.role === 'SALES' && ERP.RBAC.can('PROFIT_VIEW') === false && ERP.RBAC.can('SALES_CREATE') === true);
    meMode = 'ok'; await ERP.Auth._internal.beat();
    check('H8 …and back again', ERP.Auth.role === 'OWNER' && ERP.RBAC.can('PROFIT_VIEW') === true);

    /* a blip is not a sign-out */
    meMode = '500'; await ERP.Auth._internal.beat();
    check('H9 a server 500 does NOT lock the screen', ERP.Auth.locked === false);
    meMode = 'down'; await ERP.Auth._internal.beat();
    check('H10 no network with a still-valid offline ticket does NOT lock (shop-floor signal loss)', ERP.Auth.locked === false && ERP.Auth.online === false);
    meMode = 'ok'; await ERP.Auth._internal.beat();

    /* hidden tab: no traffic, and it must not keep the server session alive */
    const before = meCalls;
    Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await ERP.Auth._internal.beat();
    check('H11 a hidden tab sends no heartbeat', meCalls === before);
    Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'visible' });

    /* the timer really drives beat() */
    ERP.Auth._internal.stopHeartbeat(); ERP.Auth.HEARTBEAT_MS = 40;
    const b2 = meCalls; ERP.Auth._internal.startHeartbeat(); await sleep(220);
    check('H12 the interval calls the server on its own', meCalls > b2, 'calls ' + b2 + ' -> ' + meCalls);
    ERP.Auth._internal.stopHeartbeat(); ERP.Auth.HEARTBEAT_MS = 60000; ERP.Auth._internal.startHeartbeat();

    /* the session dies mid-use */
    meMode = '401'; await ERP.Auth._internal.beat();
    const lock = w.document.getElementById('fcAuthLock');
    check('H13 a 401 while enforced locks the screen behind a sign-in', ERP.Auth.locked === true && !!lock && lock.classList.contains('on'));
    check('H14 …and says the session ended (not "you have been idle")', /session has ended/i.test(lock.textContent) && !/idle/i.test(lock.textContent));
    check('H15 the identity is kept, so the app does NOT quietly fall back to being the local Owner', !!ERP.Auth.identity && ERP.Auth.role === 'OWNER');
    const c1 = meCalls; await ERP.Auth._internal.beat();
    check('H16 while locked no further heartbeats are sent', meCalls === c1);

    /* wrong password stays locked; right password recovers */
    const pw = w.document.getElementById('fcLockPw'); pw.value = 'nope';
    w.document.getElementById('fcLockGo').click(); await sleep(150);
    check('H17 a wrong password leaves it locked, with the server\'s message',
      ERP.Auth.locked === true && /not right/i.test(w.document.getElementById('fcLockErr').textContent));
    w.document.getElementById('fcLockPw').value = 'right-pw';
    w.document.getElementById('fcLockGo').click(); await sleep(250);
    check('H18 the right password signs back in on the spot — no page reload, no lost work',
      ERP.Auth.locked === false && !w.document.getElementById('fcAuthLock').classList.contains('on') && loginCalls >= 2 && reloads === 0);

    /* offline for longer than the grace ticket */
    store.ls[ERP.Auth._internal.TICKET_KEY] = JSON.stringify({ ticket: ticketFor(OWNER_PERMS, -60), savedAt: Date.now() });
    meMode = 'down'; await ERP.Auth._internal.beat();
    const lock2 = w.document.getElementById('fcAuthLock');
    check('H19 offline AND the grace ticket has expired: locks, and says why',
      ERP.Auth.locked === true && lock2.classList.contains('on') && /offline too long/i.test(lock2.textContent));
    delete store.ls[ERP.Auth._internal.VERIFIER_KEY];
    ERP.Auth.online = false;
    w.document.getElementById('fcLockPw').value = 'right-pw';
    w.document.getElementById('fcLockGo').click(); await sleep(150);
    check('H20 offline unlock with no cached verifier says "connect" rather than blaming the password',
      /connect to the internet/i.test(w.document.getElementById('fcLockErr').textContent));
    ERP.Auth.online = true; meMode = 'ok';
    w.document.getElementById('fcLockPw').value = 'right-pw';
    w.document.getElementById('fcLockGo').click(); await sleep(250);
    check('H21 once back online it unlocks', ERP.Auth.locked === false);

    /* sign out */
    w.go('dashboard'); await sleep(150);
    w.document.getElementById('fcSignOutLink').click(); await sleep(250);
    check('H22 "Sign out" tells the server, clears the identity, stops the heartbeat and reloads to the gate',
      logoutCalls === 1 && ERP.Auth.identity === null && ERP.Auth._internal.heartbeatRunning() === false && reloads === 1);
    check('H23 signing out drops the cached ticket', !store.ls[ERP.Auth._internal.TICKET_KEY]);
    w.close();
  }

  /* ── I: the same module with the server NOT enforcing — must be the Phase 2 behaviour, untouched ── */
  {
    const store = { idb: new FDBFactory() };
    const w = boot(store, mockFetch({
      'me.php': () => ({ status: 200, data: { user: { id: 'usr_1', username: 'owner', displayName: 'Farooq Ahmed' }, role: 'OWNER', permissions: OWNER_PERMS, csrf: 'c1', enforce: false } }),
    }));
    const ERP = await ready(w);
    await sleep(200);
    check('I1 enforce:false keeps Auth.mode "observe"', ERP.Auth.mode === 'observe');
    check('I2 no heartbeat runs in observe mode', ERP.Auth._internal.heartbeatRunning() === false);
    w.go('dashboard'); await sleep(150);
    const chip = w.document.getElementById('fcUserChip');
    check('I3 the chip stays clickable and there is no Sign out link (Phase 2 UI unchanged)',
      !!chip && chip.disabled === false && !w.document.getElementById('fcSignOutLink'));
    let reloaded = 0; ERP.Auth._reload = () => { reloaded++; };
    await ERP.Auth.logout(); await sleep(50);
    check('I4 signing out in observe mode does not reload the page', reloaded === 0);
    w.close();
  }

  check('Z1 nothing threw during the whole session', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log('\n' + out.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
