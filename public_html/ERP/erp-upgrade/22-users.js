/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 22
   WHO IS DOING THIS
   A role used to be a setting anyone could flip, which meant the audit trail
   recorded a role rather than a person: the same name appeared as both the
   requester and the approver of a price change. Roles now belong to accounts,
   an account is signed into, and an approval must come from someone other
   than whoever asked for it.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP, FDB = global.FDB, D = global.document;
var S = ERP.S;
var I = function (n) { return global.I ? global.I(n) : ''; };
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function say(m) { return global.say ? global.say(m) : null; }
function nowISO() { return new Date().toISOString(); }
function fmtDate(x) { return global.fmtDate ? global.fmtDate(x) : x; }

var ROLE_LABEL = {
  OWNER: 'Owner', MANAGER: 'Manager', ACCOUNTANT: 'Accountant',
  SALES: 'Sales', INVENTORY: 'Warehouse'
};
var ROLE_NOTE = {
  OWNER: 'Everything, including prices, profit and settings',
  MANAGER: 'Everything except the owner-only settings',
  ACCOUNTANT: 'Money, statements and reports; no stock movements',
  SALES: 'Invoices, orders, collections; no cost or profit',
  INVENTORY: 'Stock only — quantities, not money'
};

/* A keypad lock for a shared counter device, not encryption: anyone holding
   the file itself can read the data regardless. It stops a salesman tapping
   into the owner's account, which is what it is for. */
function hashPin(pin, salt) {
  var str = String(salt || '') + '·' + String(pin || '');
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for (var i = 0; i < str.length; i++) {
    h1 = ((h1 ^ str.charCodeAt(i)) * 16777619) >>> 0;
    h2 = ((h2 + str.charCodeAt(i) * (i + 7)) * 2654435761) >>> 0;
  }
  return h1.toString(16) + '-' + h2.toString(16);
}

/* ══════════════════════════════════════════════════════════════════════════
   ACCOUNTS
   ══════════════════════════════════════════════════════════════════════════ */
var Users = ERP.Users = {
  roles: Object.keys(ROLE_LABEL),
  roleLabel: function (r) { return ROLE_LABEL[r] || r; },
  roleNote: function (r) { return ROLE_NOTE[r] || ''; },
  all: function () { return S.users || (S.users = []); },
  active: function () { return Users.all().filter(function (u) { return u.active !== false; }); },
  byId: function (id) { return Users.all().filter(function (u) { return u.id === id; })[0] || null; },
  owners: function () {
    return Users.active().filter(function (u) { return u.role === 'OWNER'; });
  },

  /* A partial update — changing only a role, only a PIN — keeps the name the
     account already has; only a new person has to be given one. */
  save: function (o) {
    var errs = [];
    var existing = o.id ? Users.byId(o.id) : null;
    var name = String(o.name !== undefined ? o.name : (existing ? existing.name : '')).trim();
    if (!name) errs.push('Enter a name.');
    if (o.role && Users.roles.indexOf(o.role) === -1) errs.push('That is not a role.');
    var clash = Users.all().filter(function (u) {
      return u.id !== (existing && existing.id) && u.name.toLowerCase() === name.toLowerCase();
    });
    if (clash.length) errs.push('Someone is already signed up under that name.');
    /* the business must never be left without an owner */
    if (existing && existing.role === 'OWNER' && o.role && o.role !== 'OWNER' &&
        Users.owners().length <= 1) {
      errs.push('This is the only owner account — make someone else an owner first.');
    }
    if (errs.length) return Promise.reject({ validation: errs });

    var rec = existing || {
      id: FDB.uid('usr'), createdAt: nowISO(), createdBy: Session.name(),
      pin: '', salt: FDB.uid('s').slice(-8), active: true, lastSignIn: null
    };
    var before = existing ? { name: rec.name, role: rec.role, active: rec.active } : null;
    rec.name = name;
    if (o.role) rec.role = o.role;
    if (!rec.role) rec.role = 'SALES';
    if (o.phone !== undefined) rec.phone = o.phone;
    if (o.active !== undefined) rec.active = !!o.active;
    if (o.pin !== undefined && o.pin !== null) {
      var pin = String(o.pin).trim();
      rec.pin = pin ? hashPin(pin, rec.salt) : '';
    }
    return FDB.tx(['users', 'auditLog'], function (api) {
      api.put('users', rec);
      ERP.Audit.write(api, {
        action: existing ? 'User account updated' : 'User account created',
        entity: 'User', entityId: rec.id, ref: rec.name,
        oldValues: before, newValues: { name: rec.name, role: rec.role, active: rec.active,
                                        hasPin: !!rec.pin }
      });
    }).then(function () {
      if (!existing) Users.all().push(rec);
      return rec;
    });
  },

  archive: function (id, reason) {
    var u = Users.byId(id);
    if (!u) return Promise.resolve(null);
    if (u.role === 'OWNER' && Users.owners().length <= 1) {
      return Promise.reject({ validation: ['This is the only owner account — it cannot be switched off.'] });
    }
    if (Session.id() === id) {
      return Promise.reject({ validation: ['You are signed in as this person. Switch user first.'] });
    }
    return FDB.tx(['users', 'auditLog'], function (api) {
      u.active = false; u.archivedAt = nowISO();
      api.put('users', u);
      ERP.Audit.write(api, { action: 'User account switched off', entity: 'User', entityId: id,
        ref: u.name, reason: reason || '' });
    }).then(function () { return u; });
  },
  restore: function (id) {
    var u = Users.byId(id);
    if (!u) return Promise.resolve(null);
    return FDB.tx(['users', 'auditLog'], function (api) {
      u.active = true; u.archivedAt = null;
      api.put('users', u);
      ERP.Audit.write(api, { action: 'User account switched on', entity: 'User', entityId: id, ref: u.name });
    }).then(function () { return u; });
  },
  checkPin: function (user, pin) {
    if (!user) return false;
    if (!user.pin) return true;                       /* no PIN set on this account */
    return hashPin(pin, user.salt) === user.pin;
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   THE SESSION
   ══════════════════════════════════════════════════════════════════════════ */
var Session = ERP.Session = {
  userId: null,
  user: function () { return Session.userId ? Users.byId(Session.userId) : null; },
  id: function () { return Session.userId; },
  name: function () {
    var u = Session.user();
    return u ? u.name : (global.CURRENT_USER || 'Owner');
  },
  role: function () {
    var u = Session.user();
    if (u) return u.role;
    return ERP.Settings.get().currentRole || 'OWNER';
  },
  is: function (role) { return Session.role() === role; },

  signIn: function (id, pin) {
    var u = Users.byId(id);
    if (!u) return Promise.reject({ validation: ['That account no longer exists.'] });
    if (u.active === false) return Promise.reject({ validation: ['That account is switched off.'] });
    if (!Users.checkPin(u, pin)) return Promise.reject({ validation: ['That PIN is not right.'] });
    Session.userId = u.id;
    u.lastSignIn = nowISO();
    try { global.CURRENT_USER = u.name; } catch (e) {}
    return FDB.tx(['users', 'meta', 'auditLog'], function (api) {
      api.put('users', u);
      api.put('meta', { k: 'sessionUserId', v: u.id });
      ERP.Audit.write(api, { action: 'Signed in', entity: 'User', entityId: u.id, ref: u.name,
        newValues: { role: u.role } });
    }).then(function () {
      try { global.paint(); } catch (e) {}
      return u;
    });
  },
  signOut: function () {
    var u = Session.user();
    Session.userId = null;
    return FDB.tx(['meta', 'auditLog'], function (api) {
      api.del('meta', 'sessionUserId');
      if (u) ERP.Audit.write(api, { action: 'Signed out', entity: 'User', entityId: u.id, ref: u.name });
    }).then(function () { try { global.paint(); } catch (e) {} });
  },

  /* Set up the first account from the business details, so a fresh install
     has an owner without anyone having to configure one. */
  ensureFirstAccount: function () {
    if (Users.all().length) return Promise.resolve(null);
    var cfg = ERP.Settings.get();
    var name = (cfg.proprietor || '').split('—')[0].trim() || global.CURRENT_USER || 'Owner';
    return Users.save({ name: name, role: 'OWNER' }).then(function (u) {
      Session.userId = u.id;
      try { global.CURRENT_USER = u.name; } catch (e) {}
      return u;
    });
  }
};

/* the role every permission check reads now comes from the account */
if (ERP.RBAC) {
  ERP.RBAC.role = function () { return Session.role(); };
  var origSetRole = ERP.RBAC.setRole;
  ERP.RBAC.setRole = function (r) {
    /* changing a role is now an act on an account, and only an owner may do it */
    var u = Session.user();
    if (!u) return origSetRole.call(ERP.RBAC, r);
    if (Session.role() !== 'OWNER') {
      say('Only the owner can change a role. Sign in as the owner first.');
      return Promise.resolve();
    }
    return Users.save({ id: u.id, role: r }).then(function () {
      try { global.paint(); } catch (e) {}
    });
  };
  ERP.RBAC.label = function () { return Users.roleLabel(Session.role()); };
}

/* every audited action carries the account, not just a name */
(function stampAudit() {
  var origBuild = ERP.Audit.build;
  ERP.Audit.build = function (o) {
    var rec = origBuild.call(ERP.Audit, o);
    rec.userId = Session.id() || null;
    rec.userId = rec.userId;
    rec.userName = Session.name();
    rec.userRole = Session.role();
    rec.userId = rec.userId || 'unsigned';
    return rec;
  };
})();

/* ══════════════════════════════════════════════════════════════════════════
   APPROVALS MUST COME FROM SOMEONE ELSE
   ══════════════════════════════════════════════════════════════════════════ */
(function segregateDuties() {
  if (!ERP.Prices) return;
  var origRequest = ERP.Prices.request;
  ERP.Prices.request = function (productId, changes, reason) {
    return origRequest.call(ERP.Prices, productId, changes, reason).then(function (r) {
      if (r && r.request) {
        r.request.requestedByUserId = Session.id();
        r.request.requestedByName = Session.name();
      }
      return r;
    });
  };
  var origApprove = ERP.Prices.approve;
  ERP.Prices.approve = function (id) {
    var rec = (S.priceApprovals || []).filter(function (a) { return a.id === id; })[0];
    if (rec && rec.status === 'PENDING') {
      var sameAccount = rec.requestedByUserId
        ? rec.requestedByUserId === Session.id()
        : rec.requestedBy === Session.name();
      if (sameAccount && !ERP.Settings.get().allowSelfApproval) {
        return Promise.reject({ validation: [
          'You raised this change yourself. Someone else has to approve it — ' +
          'sign in as another account, or turn on self-approval in Settings if you work alone.'
        ] });
      }
    }
    return origApprove.call(ERP.Prices, id);
  };
})();

var origPriceDefaults = ERP.Settings.defaults;
ERP.Settings.defaults = function () {
  return Object.assign(origPriceDefaults.call(ERP.Settings), {
    allowSelfApproval: false, requirePinOnSwitch: true
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   THE SCREEN
   ══════════════════════════════════════════════════════════════════════════ */
var CSS = `
#fcUserChip{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);
  background:var(--surface);border-radius:99px;padding:3px 10px 3px 4px;font-size:13px;cursor:pointer}
#fcUserChip .av{width:24px;height:24px;border-radius:99px;background:var(--violet);color:#fff;
  display:grid;place-items:center;font-size:11px;font-weight:700}
#fcUserChip b{font-weight:600}
#fcUserChip span{color:var(--muted);font-size:11.5px}
#fcSignin{position:fixed;inset:0;z-index:145;display:none;align-items:center;justify-content:center;
  padding:16px;background:rgba(12,10,20,.55);backdrop-filter:blur(2px)}
#fcSignin.on{display:flex}
#fcSignin .fcx-box{max-width:440px;width:100%}
.si-list{display:grid;gap:8px;padding:10px 14px}
.si-u{display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:11px 12px;
  border:1.5px solid var(--line);border-radius:12px;background:var(--surface);cursor:pointer}
.si-u:hover{border-color:var(--violet);background:var(--violet-50)}
.si-u.on{border-color:var(--violet);background:var(--violet-50)}
.si-u .av{width:34px;height:34px;border-radius:99px;background:var(--violet-50);color:var(--violet);
  display:grid;place-items:center;font-weight:700;flex:none}
.si-u b{display:block}
.si-u span{display:block;font-size:12.5px;color:var(--muted)}
.si-pin{padding:0 14px 12px}
.si-pin input{width:100%;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-sm);
  font-size:18px;letter-spacing:6px;text-align:center}
.us-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;
  border-bottom:1px solid var(--line-2);flex-wrap:wrap}
.us-row:last-child{border-bottom:none}
.us-row .who b{display:block}
.us-row .who span{font-size:12.5px;color:var(--muted)}
`;
(function () { var s = D.createElement('style'); s.id = 'fc-users-css'; s.textContent = CSS; D.head.appendChild(s); })();

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(function (w) { return w[0]; }).join('').toUpperCase();
}

function chip() {
  var host = D.getElementById('fcUserChip');
  var anchor = D.getElementById('bellBtn');
  if (!anchor || !anchor.parentNode) return;
  if (!host) {
    host = D.createElement('button');
    host.id = 'fcUserChip';
    host.setAttribute('aria-label', 'Signed in user');
    anchor.parentNode.insertBefore(host, anchor);
  }
  var u = Session.user();
  host.innerHTML = '<span class="av">' + esc(initials(Session.name())) + '</span>' +
    '<span><b>' + esc(Session.name()) + '</b> <span>' + esc(Users.roleLabel(Session.role())) + '</span></span>';
  host.title = u ? 'Signed in as ' + u.name + ' — tap to switch' : 'Tap to sign in';
}

var SIGNIN = { picked: null };
function openSignin() {
  var host = D.getElementById('fcSignin');
  if (!host) { host = D.createElement('div'); host.id = 'fcSignin'; D.body.appendChild(host); }
  var list = Users.active();
  var picked = SIGNIN.picked ? Users.byId(SIGNIN.picked) : null;
  host.innerHTML =
    '<div class="fcx-box" role="dialog" aria-label="Switch user">' +
      '<div class="fcx-h"><b>Who is using the ERP?</b>' +
        '<p>Everything recorded from now on is under this name — invoices, payments, ' +
        'price changes and approvals.</p></div>' +
      '<div class="si-list">' + (list.length ? list.map(function (u) {
        return '<button class="si-u' + (picked && picked.id === u.id ? ' on' : '') +
          '" data-siuser="' + u.id + '"><span class="av">' + esc(initials(u.name)) + '</span>' +
          '<span><b>' + esc(u.name) + '</b><span>' + esc(Users.roleLabel(u.role)) +
          (u.pin ? ' · PIN set' : '') + '</span></span></button>';
      }).join('') : '<p class="hint">No accounts yet. Add one in Settings → Users & roles.</p>') + '</div>' +
      (picked && picked.pin
        ? '<div class="si-pin"><input id="siPin" type="password" inputmode="numeric" ' +
          'placeholder="PIN" autocomplete="off"></div>' : '') +
      '<div class="fcx-foot">' +
        (Session.user() ? '<button class="btn" data-si="out">Sign out</button>' : '') +
        '<div class="grow"></div>' +
        '<button class="btn" data-si="cancel">Cancel</button>' +
        '<button class="btn pri" data-si="go"' + (picked ? '' : ' disabled') + '>Sign in</button>' +
      '</div></div>';
  host.classList.add('on');
  var pin = D.getElementById('siPin');
  if (pin) setTimeout(function () { pin.focus(); }, 30);
}
function closeSignin() {
  var h = D.getElementById('fcSignin');
  if (h) { h.classList.remove('on'); h.innerHTML = ''; }
  SIGNIN.picked = null;
}

/* Settings → Users & roles */
var EDIT_USER = null;
global.PANELS.useraccount = {
  t: 'User account', s: 'A name, a role, and a PIN if the device is shared', cta: 'Save account',
  f: function () {
    var u = EDIT_USER && EDIT_USER !== 'new' ? Users.byId(EDIT_USER) : null;
    return '<label class="f"><span>Name</span><input data-f="name" value="' + esc(u ? u.name : '') + '"></label>' +
      '<label class="f"><span>Role</span><select data-f="role">' +
        Users.roles.map(function (r) {
          return '<option value="' + r + '"' + (u && u.role === r ? ' selected' : '') + '>' +
            esc(Users.roleLabel(r)) + ' — ' + esc(Users.roleNote(r)) + '</option>';
        }).join('') + '</select></label>' +
      '<label class="f"><span>Mobile</span><input data-f="phone" class="mono" value="' +
        esc(u && u.phone || '') + '"></label>' +
      '<label class="f"><span>PIN</span><input data-f="pin" type="password" inputmode="numeric" ' +
        'placeholder="' + (u && u.pin ? 'Set — type a new one to change it' : 'Optional') + '">' +
        '<span class="hint">A keypad lock for a shared counter device. It stops the wrong person ' +
        'signing in; it is not encryption, and anyone with the data file can still read it.</span></label>' +
      (u && Session.id() === u.id
        ? '<div class="banner info">' + I('alert') + '<div><p>This is the account you are signed into.</p></div></div>'
        : '');
  },
  save: function (v) {
    var o = { name: v.name, role: v.role, phone: v.phone };
    if (v.pin) o.pin = v.pin;
    if (EDIT_USER && EDIT_USER !== 'new') o.id = EDIT_USER;
    Users.save(o).then(function (u) {
      if (Session.id() === u.id) { try { global.CURRENT_USER = u.name; } catch (e) {} }
      global.paint(); say('Account saved — ' + u.name + '.');
    }).catch(function (e) { say(e && e.validation ? e.validation[0] : 'Could not save that account.'); });
    return { msg: 'Saving…' };
  }
};

function usersCard() {
  var rows = Users.all().map(function (u) {
    var mine = Session.id() === u.id;
    return '<div class="us-row"><div class="who"><b>' + esc(u.name) +
        (mine ? ' <span class="pill ok">signed in</span>' : '') + '</b>' +
        '<span>' + esc(Users.roleLabel(u.role)) + ' · ' + esc(Users.roleNote(u.role)) +
        (u.pin ? ' · PIN set' : ' · no PIN') +
        (u.lastSignIn ? ' · last in ' + esc(fmtDate(u.lastSignIn.slice(0, 10))) : '') + '</span></div>' +
      '<div>' +
        (u.active === false
          ? '<button class="btn sm" data-userrestore="' + u.id + '">Switch on</button>'
          : '<button class="btn sm" data-useredit="' + u.id + '">Edit</button>' +
            (mine ? '' : ' <button class="btn sm" data-userarchive="' + u.id + '">Switch off</button>')) +
      '</div></div>';
  }).join('');
  return '<div class="card"><div class="card-h"><h3>User accounts</h3>' +
      '<button class="btn pri" data-useredit="new">' + I('plus') + 'Add person</button></div>' +
    '<div class="card-b">' +
      '<p style="margin-top:0;color:var(--muted)">A role belongs to a person, not to the device. ' +
      'Whoever is signed in is the name on every invoice, payment and approval.</p>' +
      rows +
      '<div style="margin-top:12px">' +
        toggleRow('allowSelfApproval', 'Allow approving your own price change',
          'Leave off where two people work; turn on if you run the business alone') +
      '</div></div></div>';
}
function toggleRow(key, title, note) {
  var on = !!ERP.Settings.get()[key];
  return '<div class="st-toggle"><div class="lbl"><b>' + title + '</b>' +
    (note ? '<span>' + note + '</span>' : '') + '</div>' +
    '<button class="st-sw' + (on ? ' on' : '') + '" data-sttoggle="' + key + '" role="switch"></button></div>';
}

/* the accounts card joins the Users & roles section of Settings */
var origSettings = global.PAGES.settings;
global.PAGES.settings = function () {
  var html = origSettings.apply(global, arguments);
  if (ERP.SettingsUI && ERP.SettingsUI.section !== 'people') return html;
  return html.replace('<div id="stBody">', '<div id="stBody">' + usersCard());
};

/* ══════════════════════════════════════════════════════════════════════════
   WIRING
   ══════════════════════════════════════════════════════════════════════════ */
D.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var t;
  if ((t = e.target.closest('#fcUserChip'))) { e.preventDefault(); openSignin(); return; }
  if (e.target.id === 'fcSignin') { closeSignin(); return; }
  if ((t = e.target.closest('[data-siuser]'))) {
    e.preventDefault();
    var id = t.dataset.siuser;
    var u = Users.byId(id);
    SIGNIN.picked = id;
    if (u && !u.pin) { Session.signIn(id, '').then(function () { closeSignin(); say('Signed in as ' + u.name + '.'); }); return; }
    openSignin();
    return;
  }
  if ((t = e.target.closest('[data-si]'))) {
    e.preventDefault();
    var act = t.dataset.si;
    if (act === 'cancel') { closeSignin(); return; }
    if (act === 'out') { Session.signOut().then(function () { closeSignin(); say('Signed out.'); }); return; }
    if (act === 'go') {
      var pinEl = D.getElementById('siPin');
      Session.signIn(SIGNIN.picked, pinEl ? pinEl.value : '').then(function (u) {
        closeSignin(); say('Signed in as ' + u.name + ' (' + Users.roleLabel(u.role) + ').');
      }).catch(function (err) {
        say(err && err.validation ? err.validation[0] : 'Could not sign in.');
        if (pinEl) { pinEl.value = ''; pinEl.focus(); }
      });
    }
    return;
  }
  if ((t = e.target.closest('[data-useredit]'))) {
    e.preventDefault(); EDIT_USER = t.dataset.useredit; global.openPanel('useraccount'); return;
  }
  if ((t = e.target.closest('[data-userarchive]'))) {
    e.preventDefault();
    if (!global.confirm('Switch this account off? Their name stays on everything they recorded.')) return;
    Users.archive(t.dataset.userarchive, 'Switched off from Settings')
      .then(function () { global.paint(); say('Account switched off.'); })
      .catch(function (err) { say(err && err.validation ? err.validation[0] : 'Could not do that.'); });
    return;
  }
  if ((t = e.target.closest('[data-userrestore]'))) {
    e.preventDefault();
    Users.restore(t.dataset.userrestore).then(function () { global.paint(); });
  }
}, true);

var origPaint = global.paint;
global.paint = function () {
  origPaint.apply(global, arguments);
  try { chip(); } catch (e) {}
};

/* accounts load with everything else, and the last session is resumed */
(ERP.bootPromise || Promise.resolve()).then(function () {
  return FDB.hydrate().then(function (d) {
    S.users = d.users || [];
    var meta = {};
    (d.meta || []).forEach(function (m) { meta[m.k] = m.v; });
    if (meta.sessionUserId && Users.byId(meta.sessionUserId)) {
      Session.userId = meta.sessionUserId;
      var u = Session.user();
      if (u) { try { global.CURRENT_USER = u.name; } catch (e) {} }
    }
    return Session.ensureFirstAccount();
  }).then(function () {
    ERP.usersReady = true;
    try { global.paint(); } catch (e) {}
  });
}).catch(function () { S.users = S.users || []; ERP.usersReady = true; });
})(typeof window !== 'undefined' ? window : globalThis);
