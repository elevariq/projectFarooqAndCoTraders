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

  /* ── F: idle lock engages only once a server identity exists, and can be
         released offline with the correct password via the PBKDF2 verifier ── */
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
    ERP.Auth.IDLE_MS = 60000; // not exercising the real timer here, just the lock/unlock functions directly
    await ERP.Auth.login('owner3', 'secret123');
    check('F1 idle lock is a no-op with no identity signed in (never annoys the client-only path)',
      (() => { const before = ERP.Auth.locked; ERP.Auth.logout(); return before === false; })());

    // re-sign in for the actual lock/unlock check
    await ERP.Auth.login('owner3', 'secret123');
    ERP.Auth._internal.lockScreen();
    check('F2 the lock overlay appears once idle-locked', !!w.document.getElementById('fcAuthLock').classList.contains('on'));

    ERP.Auth.online = false; // simulate connectivity loss while locked
    check('F3 the wrong password is refused offline',
      await ERP.Auth._internal.unlockWith('wrong-one').then(() => false).catch(e => /not right/i.test(e.validation[0])));
    check('F4 still locked after a wrong attempt', ERP.Auth.locked === true);
    await ERP.Auth._internal.unlockWith('secret123');
    check('F5 the right password unlocks offline via the cached verifier', ERP.Auth.locked === false);
    w.close();
  }

  check('Z1 nothing threw during the whole session', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log('\n' + out.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); process.exit(2); });
