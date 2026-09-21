/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 31
   SERVER-SIDE AUTHENTICATION
   Module 22 gave every account a name and a role, but nothing made signing
   in mandatory, the PIN was a hand-rolled hash anyone with devtools could
   read past, and a role was only ever a setting this device chose to honour.
   This module adds a real account on a real server: a bcrypt password, a
   session the server can revoke, and a permission list the server — not
   this browser — decides.

   PHASED ROLLOUT (see docs/OPERATIONS.md and the auth project plan):
     Phase 2 (this file, AUTH_MODE = 'observe'): a server account, once
       signed into, becomes the source of truth for identity and
       permissions — but nobody is forced to sign in yet, and the app keeps
       rendering exactly as before if the API is unreachable or nobody has
       signed in with a server account. Nothing that worked yesterday stops
       working today.
     Phase 3 (the login gate — api/gate.php, switched by 'enforce_login' in
       the server's private/erp-config.php): the app files can only be
       fetched with a valid session, so by the time this code runs the person
       is already signed in. The server tells us it is enforcing (`enforce:
       true` on /me.php and /login.php), and Auth.mode becomes 'enforce'.
       There is no client-side switch to flip: a browser can never be the
       thing that decides the gate is open. What enforce mode adds here:
         - a session that ends mid-use (12 h cap, account switched off, sign-out
           on another device) locks the screen behind a sign-in instead of
           quietly carrying on as the local Owner — see the heartbeat below;
         - "Sign out" returns to the server's sign-in page;
         - the module-22 "switch user" chip becomes display-only, since the
           server account is the identity now.

   OFFLINE GRACE PERIOD: the ERP is used on shop-floor devices that lose
   signal. A successful online sign-in returns a short-lived signed ticket
   (see api/_session.php make_offline_ticket) good for
   CFG.offline_grace_hours. While that ticket is unexpired, this module
   trusts the role/permissions it carries without asking the server again.
   This module cannot verify the ticket's HMAC signature itself — the
   secret that signs it never reaches the browser — so an expiry check on
   the ticket's own claimed `exp` is what actually gates re-use, not proof
   the ticket is untampered. That is the same honest limit as everywhere
   else client-side state is trusted (see 22-users.js's own PIN comment):
   it raises the cost of tampering, it does not remove the device from the
   trust boundary.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP; if (!ERP) return;
var D = global.document;
if (!D) return;

var AUTH_MODE = 'observe';           /* starting value only; the server's `enforce` flag sets it — see header */
var API_BASE = 'api/auth/';
var TICKET_KEY = 'farooqco_auth_ticket';
/* Every heartbeat is a database connection on the server, and Hostinger caps the auth database user at 500 connections an hour (the site
   went down on 2026-09-21 when open tabs used them all up) — so this is every 3 minutes, not every minute. A session that ends (account
   switched off, signed out elsewhere, 12 h cap) is noticed within this time. */
var HEARTBEAT_MS_DEFAULT = 180 * 1000;

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function say(m) { return global.say ? global.say(m) : null; }

/* ══════════════════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════════════════ */
var Auth = ERP.Auth = {
  mode: AUTH_MODE,
  HEARTBEAT_MS: HEARTBEAT_MS_DEFAULT,
  identity: null,        /* { id, username, displayName } once signed in server-side */
  role: null,
  permissions: null,      /* array; ['*'] means "all", matching the API */
  csrf: null,
  online: true,
  locked: false
};

function api(path) {
  /* relative, not absolute — same-origin whether served from the ERP root
     or through the base64 srcdoc launcher, which inherits that origin */
  return API_BASE + path;
}

var REQUEST_TIMEOUT_MS = 4000;    /* bounds how long a dead/slow connection can stall a call —
                                      without this, a shop with no signal waits on the OS's own
                                      DNS/connect timeout (which can be much longer) before this
                                      module falls back to the offline ticket. */

function request(path, opts) {
  opts = opts || {};
  try {
    if (typeof global.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (Auth.csrf && opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = Auth.csrf;
    var fetchOpts = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    };
    if (typeof global.AbortSignal !== 'undefined' && global.AbortSignal.timeout) {
      fetchOpts.signal = global.AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    }
    return global.fetch(api(path), fetchOpts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.status, status: res.status, data: data };
      });
    });
  } catch (e) {
    return Promise.reject(e);
  }
}

function hasPerm(perm) {
  if (!Auth.permissions) return null;               /* no server identity — caller should fall back */
  if (Auth.permissions.indexOf('*') > -1) return true;
  return Auth.permissions.indexOf(perm) > -1;
}

/* ══════════════════════════════════════════════════════════════════════════
   OFFLINE TICKET
   ══════════════════════════════════════════════════════════════════════════ */
function decodeTicketPayload(ticket) {
  if (!ticket || ticket.indexOf('.') === -1) return null;
  var b64 = ticket.split('.')[0];
  try {
    var pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    var std = b64.replace(/-/g, '+').replace(/_/g, '/') + pad;
    var json = (global.atob || function (s) { return Buffer.from(s, 'base64').toString('binary'); })(std);
    /* atob returns a binary string; decode UTF-8 bytes back to text */
    var bytes = [];
    for (var i = 0; i < json.length; i++) bytes.push(json.charCodeAt(i));
    var text = (typeof TextDecoder !== 'undefined')
      ? new TextDecoder('utf-8').decode(new Uint8Array(bytes))
      : json;
    return JSON.parse(text);
  } catch (e) { return null; }
}

function storeTicket(ticket) {
  try { global.localStorage.setItem(TICKET_KEY, JSON.stringify({ ticket: ticket, savedAt: Date.now() })); }
  catch (e) {}
}
function loadTicket() {
  try {
    var raw = global.localStorage.getItem(TICKET_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearTicket() {
  try { global.localStorage.removeItem(TICKET_KEY); } catch (e) {}
  try { global.localStorage.removeItem(VERIFIER_KEY); } catch (e) {}
}

/* ── offline password verifier ────────────────────────────────────────────
   The idle lock (below) has to be releasable with no connection, or a grace
   period that only works while online isn't a grace period. There is no way
   to check a password offline without storing *something* derived from it,
   so a salted PBKDF2 hash is kept alongside the ticket and discarded with
   it. This is exactly as strong, and exactly as limited, as the ticket
   itself — see the module header. */
var VERIFIER_KEY = 'farooqco_auth_verifier';
var PBKDF2_ITERATIONS = 200000;

function bytesToB64(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return global.btoa(bin);
}
function b64ToBytes(b64) {
  var bin = global.atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function deriveHash(password, saltBytes) {
  var subtle = global.crypto && global.crypto.subtle;
  if (!subtle) return Promise.resolve(null);
  var enc = new TextEncoder();
  return subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits'])
    .then(function (key) {
      return subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        key, 256
      );
    })
    .then(function (bits) { return bytesToB64(new Uint8Array(bits)); });
}
function storeVerifier(password) {
  var subtle = global.crypto && global.crypto.subtle;
  if (!subtle || !global.crypto.getRandomValues) return Promise.resolve();
  var salt = global.crypto.getRandomValues(new Uint8Array(16));
  return deriveHash(password, salt).then(function (hashB64) {
    if (!hashB64) return;
    try {
      global.localStorage.setItem(VERIFIER_KEY, JSON.stringify({ saltB64: bytesToB64(salt), hashB64: hashB64 }));
    } catch (e) {}
  });
}
function hasVerifier() {
  try { return !!global.localStorage.getItem(VERIFIER_KEY); } catch (e) { return false; }
}
function checkVerifier(password) {
  var raw;
  try { raw = global.localStorage.getItem(VERIFIER_KEY); } catch (e) { raw = null; }
  if (!raw) return Promise.resolve(false);
  var rec;
  try { rec = JSON.parse(raw); } catch (e) { return Promise.resolve(false); }
  if (!rec || !rec.saltB64 || !rec.hashB64) return Promise.resolve(false);
  return deriveHash(password, b64ToBytes(rec.saltB64)).then(function (hashB64) {
    return !!hashB64 && hashB64 === rec.hashB64;
  });
}

/** A valid, unexpired cached ticket, or null. */
function validCachedTicket() {
  var rec = loadTicket();
  if (!rec || !rec.ticket) return null;
  var payload = decodeTicketPayload(rec.ticket);
  if (!payload || !payload.exp) return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

/* ══════════════════════════════════════════════════════════════════════════
   IDENTITY APPLICATION — this is what "becomes the source of truth" means
   ══════════════════════════════════════════════════════════════════════════ */
function applyIdentity(resp) {
  Auth.identity = resp.user;
  Auth.role = resp.role;
  Auth.permissions = resp.permissions || [];
  Auth.csrf = resp.csrf || null;
  Auth.mustChangePassword = !!resp.mustChangePassword;
  if (resp.enforce !== undefined) Auth.mode = resp.enforce ? 'enforce' : 'observe';
  if (resp.offlineTicket) storeTicket(resp.offlineTicket);

  if (ERP.Session) {
    ERP.Session.name = function () { return Auth.identity ? Auth.identity.displayName : 'Owner'; };
    ERP.Session.role = function () { return Auth.role || 'OWNER'; };
    ERP.Session.id = function () { return Auth.identity ? Auth.identity.id : null; };
  }
  if (ERP.RBAC) {
    ERP.RBAC.can = function (perm) {
      var v = hasPerm(perm);
      return v === null ? false : v;                 /* fail CLOSED once a server identity exists */
    };
    ERP.RBAC.label = function () { return Auth.role || ''; };
  }
  try { global.CURRENT_USER = Auth.identity ? Auth.identity.displayName : global.CURRENT_USER; } catch (e) {}
  if (Auth.mode === 'enforce') startHeartbeat();
}

function applyFromTicket(payload) {
  Auth.identity = Auth.identity || { id: payload.uid, username: '', displayName: Auth.identity && Auth.identity.displayName || global.CURRENT_USER || 'Owner' };
  Auth.role = payload.role;
  Auth.permissions = payload.perms || [];
  if (ERP.Session) {
    ERP.Session.role = function () { return Auth.role || 'OWNER'; };
    ERP.Session.id = function () { return Auth.identity ? Auth.identity.id : null; };
  }
  if (ERP.RBAC) {
    ERP.RBAC.can = function (perm) {
      var v = hasPerm(perm);
      return v === null ? false : v;
    };
  }
}

function clearIdentity() {
  Auth.identity = null; Auth.role = null; Auth.permissions = null; Auth.csrf = null;
  clearTicket();
}

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC API
   ══════════════════════════════════════════════════════════════════════════ */
Auth.login = function (username, password) {
  return request('login.php', { method: 'POST', body: { username: username, password: password } })
    .then(function (r) {
      if (r.status !== 200) {
        var msg = (r.data && r.data.error) || 'Could not sign in.';
        return Promise.reject({ validation: [msg], status: r.status });
      }
      Auth.online = true;
      applyIdentity(r.data);
      return storeVerifier(password).then(function () {
        try { global.paint(); } catch (e) {}
        if (Auth.mustChangePassword) openChangePw(true);
        return r.data;
      });
    });
};

Auth.logout = function () {
  return request('logout.php', { method: 'POST' }).catch(function () { /* best effort */ })
    .then(function () {
      clearIdentity();
      stopHeartbeat();
      try { global.paint(); } catch (e) {}
      /* enforced: there is nothing to go back to in this page — reload the
         top window and the gate will answer with its sign-in page */
      if (Auth.mode === 'enforce') Auth._reload();
    });
};

/* reloads the WHOLE page, not just the app iframe the launcher runs us in.
   A separate function so the test harness can observe it (jsdom cannot navigate). */
Auth._reload = function () {
  try { global.top.location.reload(); }
  catch (e) { try { global.location.reload(); } catch (e2) {} }
};

Auth.changePassword = function (currentPassword, newPassword) {
  return request('change-password.php', {
    method: 'POST', body: { currentPassword: currentPassword, newPassword: newPassword }
  }).then(function (r) {
    if (r.status !== 200) {
      var msg = (r.data && r.data.error) || (r.data && r.data.validation && r.data.validation[0]) || 'Could not change the password.';
      return Promise.reject({ validation: [msg] });
    }
    Auth.mustChangePassword = false;
    /* the offline verifier was derived from the old password — a fresh
       online sign-in is needed before it can be trusted again, so it's
       safer to drop it now than to leave a verifier that no longer matches
       what unlocks the account */
    try { global.localStorage.removeItem(VERIFIER_KEY); } catch (e) {}
    return r.data;
  });
};

/* the authenticated request helper, for 34-accounts.js (adds the CSRF header on writes, times out, same-origin) */
Auth._request = request;

Auth.can = function (perm) {
  var v = hasPerm(perm);
  return v === null ? null : v;
};

/** Called on boot and can be called again any time connectivity is regained. */
Auth.refresh = function () {
  return request('me.php').then(function (r) {
    if (r.status === 200) {
      Auth.online = true;
      applyIdentity(r.data);
      return true;
    }
    if (r.status === 401) {
      /* server reachable, no session — an offline ticket doesn't apply here,
         a live "not signed in" answer is authoritative */
      Auth.online = true;
      clearIdentity();
      return false;
    }
    throw new Error('unexpected status ' + r.status);
  }).catch(function () {
    /* unreachable — fall back to the offline ticket if one is still valid */
    Auth.online = false;
    var payload = validCachedTicket();
    if (payload) { applyFromTicket(payload); return true; }
    clearIdentity();
    return false;
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   SESSION HEARTBEAT — enforce mode only.
   The gate proved who you were when the page loaded; this notices when that
   stops being true while the page stays open (12 h session cap, an owner
   switching the account off, signing out from another device). Without it an
   open tab would keep running as if nothing happened — and, worse, fall back
   to the local "Owner" role, which is precisely what enforcing is meant to end.
   Asks the server every three minutes, only while the screen is unlocked and the tab
   is visible, so an abandoned tab neither keeps the server session alive nor
   hammers the API. There is deliberately NO idle lock: an unattended screen stays as it is
   (removed 2026-09-21 at the owner's request — nobody is asked for the password again just
   because they stopped typing). The only things that ask again are the session really ending
   (12 h cap, account switched off, signed out elsewhere) — see sessionEnded below.
   A network failure never locks by itself — shop-floor devices lose signal —
   unless the offline grace ticket has also run out.
   ══════════════════════════════════════════════════════════════════════════ */
var HB = { timer: null, wired: false };

function beat() {
  if (Auth.mode !== 'enforce' || !Auth.identity || Auth.locked) return Promise.resolve();
  if (D.visibilityState === 'hidden') return Promise.resolve();
  return request('me.php').then(function (r) {
    if (r.status === 200) { Auth.online = true; applyIdentity(r.data); return; }
    if (r.status === 401) { sessionEnded(); return; }
    /* anything else (a 5xx blip): not evidence the session is gone */
  }).catch(function () {
    Auth.online = false;
    if (!validCachedTicket()) sessionEnded('offline');
  });
}
function onVisible() { if (D.visibilityState === 'visible') beat(); }
function onOnline() { beat(); }

function startHeartbeat() {
  if (HB.timer) return;
  HB.timer = global.setInterval(beat, Auth.HEARTBEAT_MS);
  if (!HB.wired) {
    HB.wired = true;
    D.addEventListener('visibilitychange', onVisible);
    global.addEventListener('online', onOnline);
  }
}
function stopHeartbeat() {
  if (HB.timer) global.clearInterval(HB.timer);
  HB.timer = null;
  if (HB.wired) {
    HB.wired = false;
    D.removeEventListener('visibilitychange', onVisible);
    global.removeEventListener('online', onOnline);
  }
}

/* the server says we are no longer signed in (or the offline window is over) */
function sessionEnded(why) {
  if (!Auth.identity || Auth.locked) return;
  Auth.locked = true;
  renderLock(why === 'offline'
    ? 'You have been offline too long. Reconnect to keep working.'
    : 'Your session has ended. Sign in again to continue.');
}

/* ══════════════════════════════════════════════════════════════════════════
   THE SIGN-IN SCREEN THAT COMES BACK — only when the session has really ended (never for
   being idle: the idle lock was removed 2026-09-21). unlockWith is what its button calls.
   ══════════════════════════════════════════════════════════════════════════ */
function unlockWith(password) {
  var username = Auth.identity ? Auth.identity.username : '';
  var finish = function () {
    Auth.locked = false;
    var el = D.getElementById('fcAuthLock');
    if (el) el.classList.remove('on');
  };
  if (Auth.online) {
    /* prefer a real server check — it also refreshes the session and ticket */
    return Auth.login(username, password).then(finish);
  }
  /* offline: the only check available is the local verifier, and only for
     as long as the cached ticket itself hasn't expired */
  var payload = validCachedTicket();
  if (!payload) {
    return Promise.reject({ validation: ['The offline sign-in window has expired. Connect to the internet to continue.'] });
  }
  if (!hasVerifier()) {
    /* signed in through the gate's own page, so no password was ever cached on
       this device — nothing offline can honestly check it against */
    return Promise.reject({ validation: ['Connect to the internet to unlock.'] });
  }
  return checkVerifier(password).then(function (ok) {
    if (!ok) return Promise.reject({ validation: ['That password is not right.'] });
    applyFromTicket(payload);
    finish();
  });
}

var LOCK_CSS = `
#fcAuthLock{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;
  padding:16px;background:rgba(12,10,20,.72);backdrop-filter:blur(4px)}
#fcAuthLock.on{display:flex}
#fcAuthLock .box{max-width:360px;width:100%;background:var(--surface);border-radius:16px;padding:22px;
  text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)}
#fcAuthLock input{width:100%;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-sm);
  margin-top:14px;text-align:center;font-size:16px}
#fcAuthLock .err{color:#C0392B;font-size:12.5px;margin-top:8px;min-height:16px}
`;
(function () { var s = D.createElement('style'); s.id = 'fc-authlock-css'; s.textContent = LOCK_CSS; D.head.appendChild(s); })();

function renderLock(message) {
  var host = D.getElementById('fcAuthLock');
  if (!host) { host = D.createElement('div'); host.id = 'fcAuthLock'; D.body.appendChild(host); }
  var name = Auth.identity ? Auth.identity.displayName : '';
  host.innerHTML =
    '<div class="box"><b>' + (message ? esc(message) : esc(name) + ', please sign in again') + '</b>' +
    '<p style="color:var(--muted);font-size:13px">Enter your password to keep going.</p>' +
    '<input id="fcLockPw" type="password" placeholder="Password" autocomplete="off">' +
    '<div class="err" id="fcLockErr"></div>' +
    '<button class="btn pri" id="fcLockGo" style="width:100%;margin-top:10px">Unlock</button>' +
    '<button class="btn" id="fcLockOut" style="width:100%;margin-top:8px">Sign out instead</button></div>';
  host.classList.add('on');
  var pw = D.getElementById('fcLockPw');
  setTimeout(function () { pw && pw.focus(); }, 20);
}

D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  if (e.target.id === 'fcLockGo') {
    var pw = D.getElementById('fcLockPw');
    unlockWith(pw ? pw.value : '').catch(function (err) {
      var el = D.getElementById('fcLockErr');
      if (el) el.textContent = (err && err.validation && err.validation[0]) || 'Could not unlock.';
      if (pw) { pw.value = ''; pw.focus(); }
    });
  }
  if (e.target.id === 'fcLockOut') {
    Auth.logout().then(function () {
      var el = D.getElementById('fcAuthLock');
      if (el) el.classList.remove('on');
    });
  }
}, true);

/* ══════════════════════════════════════════════════════════════════════════
   SERVER SIGN-IN ENTRY POINT
   A small, self-contained overlay alongside the module-22 PIN dialog rather
   than rewritten into it — Phase 3 retires the PIN dialog entirely, so this
   is deliberately not entangled with it.
   ══════════════════════════════════════════════════════════════════════════ */
var FORM_CSS = `
#fcServerAuth{position:fixed;inset:0;z-index:190;display:none;align-items:center;justify-content:center;
  padding:16px;background:rgba(12,10,20,.55)}
#fcServerAuth.on{display:flex}
#fcServerAuth .box{max-width:360px;width:100%;background:var(--surface);border-radius:16px;padding:20px}
#fcServerAuth input{width:100%;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-sm);margin-top:10px}
#fcServerAuth .err{color:#C0392B;font-size:12.5px;margin-top:8px;min-height:16px}
#fcCompanyLink,#fcSignOutLink{font-size:12px;color:var(--muted);background:none;border:none;cursor:pointer;text-decoration:underline;padding:4px}
`;
(function () { var s = D.createElement('style'); s.id = 'fc-serverauth-css'; s.textContent = FORM_CSS; D.head.appendChild(s); })();

function openServerAuth() {
  var host = D.getElementById('fcServerAuth');
  if (!host) { host = D.createElement('div'); host.id = 'fcServerAuth'; D.body.appendChild(host); }
  host.innerHTML =
    '<div class="box"><b>Company account sign-in</b>' +
    '<p style="color:var(--muted);font-size:13px">This account works from any device and is checked by the server.</p>' +
    '<input id="fcAuthUser" placeholder="Username" autocomplete="username">' +
    '<input id="fcAuthPass" type="password" placeholder="Password" autocomplete="current-password">' +
    '<div class="err" id="fcAuthErr"></div>' +
    '<button class="btn pri" id="fcAuthGo" style="width:100%;margin-top:10px">Sign in</button>' +
    '<button class="btn" id="fcAuthCancel" style="width:100%;margin-top:8px">Cancel</button></div>';
  host.classList.add('on');
}
function closeServerAuth() {
  var h = D.getElementById('fcServerAuth');
  if (h) { h.classList.remove('on'); h.innerHTML = ''; }
}

D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  if (e.target.id === 'fcCompanyLink') { e.preventDefault(); openServerAuth(); return; }
  if (e.target.id === 'fcSignOutLink') { e.preventDefault(); Auth.logout(); return; }
  if (e.target.id === 'fcAuthCancel') { closeServerAuth(); return; }
  if (e.target.id === 'fcAuthGo') {
    var u = D.getElementById('fcAuthUser'), p = D.getElementById('fcAuthPass');
    Auth.login(u ? u.value : '', p ? p.value : '').then(function () {
      closeServerAuth();
      say('Signed in as ' + Auth.identity.displayName + '.');
    }).catch(function (err) {
      var el = D.getElementById('fcAuthErr');
      if (el) el.textContent = (err && err.validation && err.validation[0]) || 'Could not sign in.';
    });
  }
}, true);

/* ══════════════════════════════════════════════════════════════════════════
   CHANGE PASSWORD
   Reachable voluntarily from "My account" on the Company accounts screen
   (module 34: any button carrying data-fc-chpw opens it) once signed in, and
   shown automatically — with no way to dismiss it — when the
   server says this account must change its password (set on the account
   the owner bootstrap script creates, and whenever an owner resets someone
   else's password from api/auth/users.php).
   ══════════════════════════════════════════════════════════════════════════ */
var PW_CSS = `
#fcChangePw{position:fixed;inset:0;z-index:195;display:none;align-items:center;justify-content:center;
  padding:16px;background:rgba(12,10,20,.6)}
#fcChangePw.on{display:flex}
#fcChangePw .box{max-width:360px;width:100%;background:var(--surface);border-radius:16px;padding:20px}
#fcChangePw input{width:100%;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-sm);margin-top:10px}
#fcChangePw .err{color:#C0392B;font-size:12.5px;margin-top:8px;min-height:16px}
#fcChangePw .ok{color:#1E7A34;font-size:12.5px;margin-top:8px;min-height:16px}
`;
(function () { var s = D.createElement('style'); s.id = 'fc-changepw-css'; s.textContent = PW_CSS; D.head.appendChild(s); })();

function openChangePw(forced) {
  var host = D.getElementById('fcChangePw');
  if (!host) { host = D.createElement('div'); host.id = 'fcChangePw'; D.body.appendChild(host); }
  host.dataset.forced = forced ? '1' : '';
  host.innerHTML =
    '<div class="box"><b>Change your password</b>' +
    '<p style="color:var(--muted);font-size:13px">' +
    (forced ? 'This account was set up with a temporary password. Choose your own before continuing.'
            : 'You can change your password any time.') + '</p>' +
    '<input id="fcPwCur" type="password" placeholder="Current password" autocomplete="current-password">' +
    '<input id="fcPwNew" type="password" placeholder="New password (at least 8 characters)" autocomplete="new-password">' +
    '<input id="fcPwConf" type="password" placeholder="Confirm new password" autocomplete="new-password">' +
    '<div class="err" id="fcPwErr"></div><div class="ok" id="fcPwOk"></div>' +
    '<button class="btn pri" id="fcPwGo" style="width:100%;margin-top:10px">Change password</button>' +
    (forced ? '' : '<button class="btn" id="fcPwCancel" style="width:100%;margin-top:8px">Cancel</button>') +
    '</div>';
  host.classList.add('on');
}
function closeChangePw() {
  var h = D.getElementById('fcChangePw');
  if (h) { h.classList.remove('on'); h.innerHTML = ''; }
}

D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  if (e.target.closest('[data-fc-chpw]')) { e.preventDefault(); openChangePw(false); return; }
  if (e.target.id === 'fcPwCancel') { closeChangePw(); return; }
  if (e.target.id === 'fcPwGo') {
    var cur = D.getElementById('fcPwCur'), nw = D.getElementById('fcPwNew'), conf = D.getElementById('fcPwConf');
    var errEl = D.getElementById('fcPwErr'), okEl = D.getElementById('fcPwOk');
    if (errEl) errEl.textContent = ''; if (okEl) okEl.textContent = '';
    if (nw && conf && nw.value !== conf.value) { if (errEl) errEl.textContent = 'The new passwords do not match.'; return; }
    if (nw && nw.value.length < 8) { if (errEl) errEl.textContent = 'The new password must be at least 8 characters.'; return; }
    Auth.changePassword(cur ? cur.value : '', nw ? nw.value : '').then(function () {
      if (okEl) okEl.textContent = 'Password changed.';
      say('Password changed.');
      setTimeout(closeChangePw, 700);
    }).catch(function (err) {
      if (errEl) errEl.textContent = (err && err.validation && err.validation[0]) || 'Could not change the password.';
    });
  }
}, true);

/* Offer "Company sign-in" while nobody has a server identity and "Sign out"
   once sign-in is enforced. They are placed next to the sign-in chip, which
   module 35 keeps inside the account menu (top right). "Change password" is
   no longer a link here — it is on the Company accounts screen. */
function ensureCompanyLink() {
  var chip = D.getElementById('fcUserChip');
  if (!chip) return;
  var signInBtn = D.getElementById('fcCompanyLink');
  var outBtn = D.getElementById('fcSignOutLink');
  var enforced = Auth.mode === 'enforce' && !!Auth.identity;
  /* enforced: the server account IS the identity, so the module-22 "tap to
     switch user" chip must not offer to become someone else. Disabled buttons
     dispatch no click, which also covers keyboard activation. */
  chip.disabled = enforced;
  if (enforced) chip.title = 'Signed in as ' + (Auth.identity.displayName || '') + ' — use Sign out to change user';
  if (enforced) {
    if (!outBtn) {
      outBtn = D.createElement('button');
      outBtn.id = 'fcSignOutLink';
      outBtn.textContent = 'Sign out';
      chip.parentNode.insertBefore(outBtn, chip);
    }
  } else if (outBtn) { outBtn.remove(); }
  var legacyPw = D.getElementById('fcChangePwLink');
  if (legacyPw) legacyPw.remove();
  if (Auth.identity) {
    if (signInBtn) signInBtn.remove();
  } else if (!signInBtn) {
    signInBtn = D.createElement('button');
    signInBtn.id = 'fcCompanyLink';
    signInBtn.textContent = 'Company sign-in';
    chip.parentNode.insertBefore(signInBtn, chip);
  }
}

var origPaint = global.paint;
if (typeof origPaint === 'function') {
  global.paint = function () {
    origPaint.apply(global, arguments);
    try { ensureCompanyLink(); } catch (e) {}
  };
}

/* test-only surface — exercised directly by test-auth-client.mjs, never
   relied on by any other module or by the UI */
Auth._internal = {
  TICKET_KEY: TICKET_KEY, VERIFIER_KEY: VERIFIER_KEY,
  decodeTicketPayload: decodeTicketPayload, validCachedTicket: validCachedTicket,
  unlockWith: unlockWith, sessionEnded: sessionEnded,
  openChangePw: openChangePw, closeChangePw: closeChangePw,
  beat: beat, startHeartbeat: startHeartbeat, stopHeartbeat: stopHeartbeat,
  heartbeatRunning: function () { return !!HB.timer; }
};

/* ══════════════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════════════ */
(ERP.bootPromise || Promise.resolve()).then(function () {
  return Auth.refresh().then(function (signedIn) {
    try { global.paint(); } catch (e) {}
    if (signedIn && Auth.mustChangePassword) openChangePw(true);
  });
}).catch(function () { /* observe mode: never block boot on this */ });

})(typeof window !== 'undefined' ? window : globalThis);
