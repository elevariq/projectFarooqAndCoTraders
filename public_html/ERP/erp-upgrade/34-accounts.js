/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 34
   COMPANY ACCOUNTS  +  WHO MAY OPEN WHICH SCREEN

   Two jobs, both prerequisites for making sign-in mandatory (auth Phase 3):

   1. COMPANY ACCOUNTS — the owner's screen for the server accounts that
      `api/auth/users.php` already knew how to manage (create, change role,
      reset a password, switch off / on) but that had no screen at all. Until
      now the only account that could exist was the `owner` one, so turning
      the login gate on would have locked everybody else out with no way to
      let them back in. All the rules live on the SERVER (owner only, CSRF,
      the last owner can't be demoted or switched off, every change is
      audit-logged); this screen only asks and reports.

   2. SCREEN ACCESS — Payroll, Milling, Statement of Account and Company
      accounts had NO permission check at all, so the moment a non-owner has
      an account they would see salaries. Each is now tied to a permission:
          Payroll ............ PAYROLL_MANAGE   (given to no role — owner only)
          Company accounts ... ACCOUNTS_MANAGE  (given to no role — owner only)
          Milling ............ PURCHASE_CREATE  (owner, manager)
          Statement of acct .. COLLECTION_VIEW  (owner, manager, accountant, sales)
      The two new names are deliberately NOT added to any role, exactly like
      the LANDED_COST_* precedent: the owner ('*') has everything, nobody else
      does, and no change to the server's permission table is needed.
      HONEST LIMIT: this hides a screen in the browser. It is not a data
      boundary — the business data itself lives in each browser's IndexedDB
      (see CLAUDE.md, "Known limits"). It stops a member of staff wandering
      into salaries; it does not stop someone determined with devtools.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP; if (!ERP) return;
var D = global.document; if (!D) return;

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function I(n) { return global.icon ? global.icon(n) : ''; }
function say(m) { try { global.say(m); } catch (e) {} }
function can(p) { return ERP.Can ? ERP.Can(p) : true; }
function pill(cls, t) { return '<span class="pill ' + cls + '">' + t + '</span>'; }

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN ACCESS
   ══════════════════════════════════════════════════════════════════════════ */
var ACCESS = ERP.PageAccess = {
  payroll:  ['PAYROLL_MANAGE',  'Payroll'],
  accounts: ['ACCOUNTS_MANAGE', 'Company accounts'],
  milling:  ['PURCHASE_CREATE', 'Milling'],
  soa:      ['COLLECTION_VIEW', 'Statement of Account']
};

function lockedPage(what) {
  return '<div class="card"><div class="card-b"><div class="empty"><div class="ei">' + I('lock') + '</div>' +
    '<b>' + esc(what) + ' is not open to you</b>' +
    '<p>Ask the owner if you need access to this.</p></div></div></div>';
}

function guard(id) {
  var orig = global.PAGES && global.PAGES[id];
  if (typeof orig !== 'function' || orig.__fcGuarded) return;
  var wrapped = function () {
    var a = ACCESS[id];
    if (a && !can(a[0])) return lockedPage(a[1]);
    return orig.apply(this, arguments);
  };
  wrapped.__fcGuarded = true;
  global.PAGES[id] = wrapped;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMPANY ACCOUNTS — data
   ══════════════════════════════════════════════════════════════════════════ */
var ROLE_ORDER = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'SALES', 'INVENTORY'];
function roleLabel(r) {
  var R = ERP.RBAC && ERP.RBAC.roles;
  return (R && R[r] && R[r].label) || r;
}

var ACC = { list: null, loading: false, error: '', form: null };

function request(path, opts) {
  var A = ERP.Auth;
  if (!A || !A._request) return Promise.reject(new Error('The sign-in module is not available.'));
  return A._request(path, opts);
}

function load() {
  ACC.loading = true; ACC.error = '';
  return request('users.php').then(function (r) {
    ACC.loading = false;
    if (r.status === 200) ACC.list = (r.data && r.data.users) || [];
    else ACC.error = (r.data && r.data.error) || 'Could not load the accounts.';
    try { global.paint(); } catch (e) {}
  }).catch(function () {
    ACC.loading = false; ACC.error = 'Could not reach the server.';
    try { global.paint(); } catch (e) {}
  });
}

/* An easy-to-read temporary password (no 0/O, 1/l/I) the owner can say aloud.
   The account is flagged must-change-password by the server, so this only has
   to survive until the person's first sign-in. */
function genPassword() {
  var alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var out = '', bytes = new Uint8Array(12);
  var c = global.crypto;
  if (c && c.getRandomValues) c.getRandomValues(bytes);
  else for (var k = 0; k < bytes.length; k++) bytes[k] = Math.floor(Math.random() * 256);
  for (var i = 0; i < bytes.length; i++) out += alphabet.charAt(bytes[i] % alphabet.length);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMPANY ACCOUNTS — the screen
   ══════════════════════════════════════════════════════════════════════════ */
global.PAGES.accounts = function () {
  var A = ERP.Auth;
  if (!A || !A.identity) {
    return '<div class="card"><div class="card-b"><div class="empty"><div class="ei">' + I('lock') + '</div>' +
      '<b>Sign in with your company account first</b>' +
      '<p>Company accounts are checked by the server. Use “Company sign-in” at the top of the screen, ' +
      'then come back here to add your team.</p></div></div></div>';
  }
  if (ACC.list === null && !ACC.loading && !ACC.error) load();

  if (ACC.error) {
    return '<div class="card"><div class="card-b"><div class="banner err">' + I('alert') +
      '<div><b>' + esc(ACC.error) + '</b></div></div>' +
      '<button class="btn" data-acct-reload style="margin-top:10px">Try again</button></div></div>';
  }
  if (ACC.list === null) {
    return '<div class="card"><div class="card-b"><p class="hint">Loading accounts…</p></div></div>';
  }

  var me = A.identity && A.identity.id;
  var rows = ACC.list.map(function (u) {
    var self = u.id === me;
    var acts = '<button class="btn sm" data-acct-edit="' + esc(u.id) + '">Edit</button>' +
      '<button class="btn sm" data-acct-pw="' + esc(u.id) + '">Reset password</button>' +
      (self ? ''
        : u.isActive
          ? '<button class="btn sm" data-acct-off="' + esc(u.id) + '">Switch off</button>'
          : '<button class="btn sm pri" data-acct-on="' + esc(u.id) + '">Switch on</button>');
    return '<tr>' +
      '<td data-label="Name"><b>' + esc(u.displayName) + '</b>' + (self ? ' ' + pill('neu', 'You') : '') +
        '<div class="sub">' + esc(u.username) + '</div></td>' +
      '<td data-label="Role">' + esc(roleLabel(u.role)) + '</td>' +
      '<td data-label="Phone">' + esc(u.phone || '—') + '</td>' +
      '<td data-label="Last sign-in">' + esc(u.lastLoginAt ? String(u.lastLoginAt).slice(0, 16) : 'Never') + '</td>' +
      '<td data-label="Status">' + (u.isActive ? pill('ok', 'Active') : pill('neu', 'Switched off')) + '</td>' +
      '<td data-label="" class="c fcb-rowacts">' + acts + '</td></tr>';
  }).join('');

  return '<div class="card"><div class="card-h"><h3>Company accounts</h3>' +
      '<span class="pill neu">' + ACC.list.length + '</span><div class="grow"></div>' +
      '<button class="btn pri" data-acct-add>' + I('plus') + 'Add account</button></div>' +
    '<div class="card-b" style="padding:0"><div class="tw"><table class="tbl"><thead><tr>' +
      '<th>Name</th><th>Role</th><th>Phone</th><th>Last sign-in</th><th>Status</th><th></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div></div></div>' +
    '<div class="card" style="margin-top:14px"><div class="card-b">' +
      '<p class="hint"><b>How this works.</b> Each person signs in with their own username and password, from any device. ' +
      'A new account (or a reset) gets a temporary password that the person must change the first time they sign in. ' +
      'Switching an account off signs that person out everywhere within a minute and stops them signing back in. ' +
      'The server refuses to switch off, or change the role of, the last owner.</p>' +
    '</div></div>';
};

/* ══════════════════════════════════════════════════════════════════════════
   COMPANY ACCOUNTS — the form (own overlay: it must stay open and show the
   server's reason when something like "that username is taken" comes back,
   which the app's slide-in panels — they close the instant Save is pressed —
   cannot do)
   ══════════════════════════════════════════════════════════════════════════ */
var FORM_CSS = '' +
  '#fcAcctForm{position:fixed;inset:0;z-index:180;display:none;align-items:center;justify-content:center;' +
  'padding:16px;background:rgba(12,10,20,.55)}' +
  '#fcAcctForm.on{display:flex}' +
  '#fcAcctForm .box{max-width:400px;width:100%;max-height:92vh;overflow:auto;background:var(--surface);border-radius:16px;padding:20px}' +
  '#fcAcctForm label{display:block;font-size:12px;font-weight:700;margin-top:12px}' +
  '#fcAcctForm input,#fcAcctForm select{width:100%;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-sm);margin-top:5px;font:inherit}' +
  '#fcAcctForm .err{color:#C0392B;font-size:12.5px;margin-top:10px;min-height:16px}' +
  '#fcAcctForm .row{display:flex;gap:8px;margin-top:14px}#fcAcctForm .row .btn{flex:1}';
(function () { var s = D.createElement('style'); s.id = 'fc-acct-css'; s.textContent = FORM_CSS; D.head.appendChild(s); })();

function findUser(id) {
  return (ACC.list || []).filter(function (u) { return u.id === id; })[0] || null;
}

function roleOptions(sel) {
  return ROLE_ORDER.map(function (r) {
    return '<option value="' + r + '"' + (r === sel ? ' selected' : '') + '>' + esc(roleLabel(r)) + '</option>';
  }).join('');
}

function openForm(mode, id) {
  var u = id ? findUser(id) : null;
  if (id && !u) return;
  ACC.form = { mode: mode, id: id || null, busy: false };
  var host = D.getElementById('fcAcctForm');
  if (!host) { host = D.createElement('div'); host.id = 'fcAcctForm'; D.body.appendChild(host); }
  var title = mode === 'create' ? 'Add an account' : mode === 'edit' ? 'Edit account' : 'Reset password';
  var body = '';
  if (mode === 'reset') {
    body = '<p style="color:var(--muted);font-size:13px">Set a new temporary password for <b>' + esc(u.displayName) +
      '</b>. They will be asked to choose their own the next time they sign in.</p>' + pwField();
  } else {
    body = '<label>Name<input id="fcAcctName" value="' + esc(u ? u.displayName : '') + '" autocomplete="off"></label>' +
      (mode === 'create' ? '<label>Username<input id="fcAcctUser" autocapitalize="none" spellcheck="false" autocomplete="off" ' +
        'placeholder="e.g. kamran.sales"></label>' : '<div class="hint" style="margin-top:10px">Username: <b>' + esc(u.username) + '</b></div>') +
      '<label>Role<select id="fcAcctRole">' + roleOptions(u ? u.role : 'SALES') + '</select></label>' +
      '<label>Phone<input id="fcAcctPhone" value="' + esc(u ? u.phone || '' : '') + '" inputmode="tel" autocomplete="off"></label>' +
      (mode === 'create' ? pwField() : '');
  }
  host.innerHTML = '<div class="box"><b>' + title + '</b>' + body +
    '<div class="err" id="fcAcctErr" role="alert"></div>' +
    '<div class="row"><button class="btn" id="fcAcctCancel">Cancel</button>' +
    '<button class="btn pri" id="fcAcctSave">' + (mode === 'create' ? 'Create account' : mode === 'edit' ? 'Save' : 'Set password') + '</button></div></div>';
  host.classList.add('on');
  var f = D.getElementById('fcAcctName') || D.getElementById('fcAcctPw');
  if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 20);
}
function pwField() {
  return '<label>Temporary password<div style="display:flex;gap:6px"><input id="fcAcctPw" autocomplete="off" spellcheck="false" ' +
    'placeholder="At least 8 characters" style="margin-top:5px"><button class="btn sm" type="button" id="fcAcctGen" ' +
    'style="margin-top:5px;white-space:nowrap">Make one</button></div></label>';
}
function closeForm() {
  var h = D.getElementById('fcAcctForm');
  if (h) { h.classList.remove('on'); h.innerHTML = ''; }
  ACC.form = null;
}
function formError(m) { var e = D.getElementById('fcAcctErr'); if (e) e.textContent = m || ''; }
function val(id) { var e = D.getElementById(id); return e ? String(e.value || '').trim() : ''; }

function submitForm() {
  var F = ACC.form; if (!F || F.busy) return;
  formError('');
  var body;
  if (F.mode === 'create') {
    var username = val('fcAcctUser'), name = val('fcAcctName'), pw = val('fcAcctPw');
    if (!name) return formError('Enter the person’s name.');
    if (!/^[a-zA-Z0-9_.\-]{3,64}$/.test(username)) return formError('Username must be 3–64 characters: letters, numbers, . _ -');
    if (pw.length < 8) return formError('The temporary password must be at least 8 characters.');
    body = { action: 'create', username: username, displayName: name, role: val('fcAcctRole'), phone: val('fcAcctPhone'), password: pw };
  } else if (F.mode === 'edit') {
    if (!val('fcAcctName')) return formError('Enter the person’s name.');
    body = { action: 'update', id: F.id, displayName: val('fcAcctName'), role: val('fcAcctRole'), phone: val('fcAcctPhone') };
  } else {
    var np = val('fcAcctPw');
    if (np.length < 8) return formError('The temporary password must be at least 8 characters.');
    body = { action: 'reset_password', id: F.id, password: np };
  }
  F.busy = true;
  var btn = D.getElementById('fcAcctSave'); if (btn) btn.disabled = true;
  request('users.php', { method: 'POST', body: body }).then(function (r) {
    F.busy = false; if (btn) btn.disabled = false;
    if (r.status === 200) {
      var msg = F.mode === 'create' ? 'Account created. Give them the temporary password — they change it at first sign-in.'
        : F.mode === 'edit' ? 'Account updated.' : 'Password reset. They must choose a new one at next sign-in.';
      closeForm(); say(msg); return load();
    }
    var d = r.data || {};
    formError((d.validation && d.validation[0]) || d.error || 'Could not save that.');
  }).catch(function () {
    F.busy = false; if (btn) btn.disabled = false;
    formError('Could not reach the server. Nothing was changed.');
  });
}

function setActive(id, on) {
  var u = findUser(id); if (!u) return;
  if (!on && !global.confirm('Switch off ' + u.displayName + '? They will be signed out and cannot sign in again until you switch them back on.')) return;
  request('users.php', { method: 'POST', body: { action: on ? 'restore' : 'archive', id: id } }).then(function (r) {
    if (r.status === 200) { say(u.displayName + (on ? ' switched on.' : ' switched off.')); return load(); }
    var d = r.data || {};
    say((d.validation && d.validation[0]) || d.error || 'Could not do that.');
  }).catch(function () { say('Could not reach the server. Nothing was changed.'); });
}

D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var t;
  if (e.target.closest('[data-acct-add]')) { e.preventDefault(); openForm('create'); return; }
  if ((t = e.target.closest('[data-acct-edit]'))) { e.preventDefault(); openForm('edit', t.dataset.acctEdit); return; }
  if ((t = e.target.closest('[data-acct-pw]'))) { e.preventDefault(); openForm('reset', t.dataset.acctPw); return; }
  if ((t = e.target.closest('[data-acct-off]'))) { e.preventDefault(); setActive(t.dataset.acctOff, false); return; }
  if ((t = e.target.closest('[data-acct-on]'))) { e.preventDefault(); setActive(t.dataset.acctOn, true); return; }
  if (e.target.closest('[data-acct-reload]')) { e.preventDefault(); ACC.list = null; ACC.error = ''; global.paint(); return; }
  if (e.target.id === 'fcAcctCancel') { closeForm(); return; }
  if (e.target.id === 'fcAcctSave') { submitForm(); return; }
  if (e.target.id === 'fcAcctGen') { var p = D.getElementById('fcAcctPw'); if (p) p.value = genPassword(); return; }
}, true);

/* ══════════════════════════════════════════════════════════════════════════
   NAV + guards
   ══════════════════════════════════════════════════════════════════════════ */
try {
  var NAV = global.NAV, GROUPS = global.NAVGROUPS;
  if (!NAV.some(function (n) { return n.id === 'accounts'; })) {
    var at = NAV.map(function (n) { return n.id; }).indexOf('users');
    NAV.splice(at < 0 ? NAV.length : at + 1, 0, { id: 'accounts', l: 'Company accounts', i: 'users' });
  }
  GROUPS.forEach(function (g) {
    if (g[0] === 'Admin' && g[1].indexOf('accounts') === -1) {
      var pos = g[1].indexOf('users');
      g[1].splice(pos < 0 ? g[1].length : pos + 1, 0, 'accounts');
    }
  });
  if (global.PAGEMETA) {
    global.PAGEMETA.accounts = ['Company accounts',
      'The people who sign in to this ERP — add someone, change their role, reset a password, or switch them off.'];
  }
} catch (e) {}

Object.keys(ACCESS).forEach(guard);

/* test-only surface */
ERP.Accounts = {
  load: load, genPassword: genPassword, roleOrder: ROLE_ORDER.slice(),
  _state: ACC, _reset: function () { ACC.list = null; ACC.loading = false; ACC.error = ''; closeForm(); }
};

})(typeof window !== 'undefined' ? window : globalThis);
