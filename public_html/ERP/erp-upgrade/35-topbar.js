/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 35
   THE TOP BAR

   The bar along the top of every screen had grown by accretion: the original
   app put a warehouse picker, a search box, a theme switch, a bell, a
   "Connected · last synced 2 minutes ago" pill and an avatar in it, and then
   modules 06 / 11 / 22 / 31 each pushed their own chip or link in next to
   the bell (a database status chip, a search icon, the signed-in user, and
   "Company sign-in" / "Change password" / "Sign out" text links). All of
   those landed inside the bell's block-level wrapper, so on a phone the bar
   wrapped to ~180px tall and squeezed the page title down to a sliver.

   What this module decides:
     · The warehouse picker is REMOVED. Nothing ever read it — the app's only
       warehouse filters are the dropdowns on Inventory and the other lists.
       A control that says "All warehouses" and does nothing is worse than none.
     · The "Connected · last synced 2 minutes ago" pill is REMOVED. The text
       was hard-coded (it never changed) and the button did nothing. The real
       signal — is my data being saved? — is the "Saved" chip from module 06,
       which now lives in the account menu, with a warning dot on the avatar
       whenever it is not healthy so a problem can never be hidden by it.
     · ONE row on every screen: page title, search, (theme), bell, avatar.
     · The avatar is the account menu. It holds who is signed in, the saved
       status, Company accounts (where the password is changed), the dark-mode
       switch, Company sign-in when nobody is, and Sign out when it is enforced.
       The elements other modules create are MOVED into it, not re-created, so
       their own behaviour and ids are untouched.
     · Search is the box on a desktop and an icon everywhere else (it used to
       vanish entirely between 761 and 900px wide).
     · The bell's red dot now means something: it only shows while at least one
       product is low or out of stock.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';
var ERP = global.ERP; if (!ERP) return;
var D = global.document; if (!D) return;
var I = function (n) { try { return global.I ? global.I(n) : ''; } catch (e) { return ''; } };

var CSS = `
/* ── one row, never wraps ── */
body .top{flex-wrap:nowrap;gap:8px;
  min-height:calc(58px + env(safe-area-inset-top,0px));padding-top:env(safe-area-inset-top,0px)}
body .top h1{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.top-r{flex:0 0 auto;margin-left:auto;gap:6px;flex-wrap:nowrap}
.top-r .rel{display:flex;align-items:center}
#whBtn,#syncBtn{display:none !important}

/* search: the box on a desktop, an icon on anything narrower */
#fcSearchBtn{display:none}
@media (max-width:900px){
  #fcSearchBtn{display:grid}
  #mini{display:none}
  body .top{padding-left:10px;padding-right:12px;gap:4px}
  body .top .icon-btn{width:40px;height:40px}
  body .top h1{font-size:17px}
}
/* the theme switch moves into the account menu on a phone */
@media (max-width:600px){ #themeBtn{display:none} }

/* the bell's dot only when something needs attention */
.top #bellBtn .dot.fcm-none{display:none}

/* ── avatar = the account button ── */
.top-av{position:relative;border:none;cursor:pointer;flex:0 0 auto}
.top-av.fcm-warn::after{content:'';position:absolute;top:-3px;right:-3px;width:11px;height:11px;
  border-radius:50%;background:var(--ochre,#C08023);border:2px solid var(--surface)}
.top-av.fcm-bad::after{background:var(--clay,#B4482F)}
.top-av:focus-visible,.fcm button:focus-visible{outline:2px solid var(--violet);outline-offset:2px}

/* ── the account menu ── */
.fcm{position:absolute;top:calc(100% + 8px);right:0;width:300px;max-width:calc(100vw - 20px);
  display:none;flex-direction:column;gap:2px;padding:6px;z-index:120;
  background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh-lg)}
.fcm.on{display:flex}
.fcm .fcm-row,.fcm #fcUserChip,.fcm #fcCompanyLink,.fcm #fcSignOutLink{
  display:flex;align-items:center;gap:11px;width:100%;min-height:46px;padding:8px 12px;
  border:none;border-radius:10px;background:none;font:inherit;font-size:14px;font-weight:500;
  color:var(--ink);text-align:left;text-decoration:none;cursor:pointer}
.fcm .fcm-row:hover,.fcm #fcUserChip:hover,.fcm #fcCompanyLink:hover,.fcm #fcSignOutLink:hover{background:var(--surface-2)}
.fcm .fcm-row svg{width:18px;height:18px;flex:0 0 18px;color:var(--muted)}
.fcm .fcm-row small{display:block;font-size:11.5px;font-weight:400;color:var(--muted);margin-top:1px}
.fcm-sep{height:1px;background:var(--line-2,var(--line));margin:4px 6px}

/* the signed-in user is the menu's header */
.fcm #fcUserChip{padding:10px 12px}
.fcm #fcUserChip:disabled{cursor:default;opacity:1}
.fcm #fcUserChip:disabled:hover{background:none}
.fcm #fcUserChip .av{width:36px;height:36px;flex:0 0 36px;font-size:13px}
.fcm #fcUserChip>span:last-child{display:flex;flex-direction:column;min-width:0;font-size:14px;color:var(--ink)}
.fcm #fcUserChip>span:last-child b{font-size:14.5px;font-weight:700;color:var(--ink);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fcm #fcUserChip>span:last-child>span{font-size:12px;color:var(--muted)}

/* the saved-status chip becomes a status line (its warn/bad colours are kept).
   Its inner dot also carries the app's absolutely-positioned .dot class, which
   used to fling it to the corner of whatever contained it. */
.fcm #fcDbChip{width:100%;border-radius:10px;padding:9px 12px;font-size:13px;justify-content:flex-start;cursor:pointer}
.fcm #fcDbChip .dot{position:static;flex:0 0 7px;border:none;top:auto;right:auto}

/* icons for the two text buttons other modules create. Drawn with CSS masks
   rather than by wrapping their text: module 31 recognises a click by
   e.target.id, so anything nested inside those buttons would break them. */
.fcm #fcCompanyLink::before,.fcm #fcSignOutLink::before{content:'';width:18px;height:18px;flex:0 0 18px;
  background:currentColor;opacity:.75;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
  -webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain}
.fcm #fcCompanyLink::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='11' width='18' height='11' rx='2'/%3E%3Cpath d='M7 11V7a5 5 0 0 1 10 0v4'/%3E%3C/svg%3E");
  mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='11' width='18' height='11' rx='2'/%3E%3Cpath d='M7 11V7a5 5 0 0 1 10 0v4'/%3E%3C/svg%3E")}
.fcm #fcSignOutLink::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'/%3E%3Cpath d='M16 17l5-5-5-5'/%3E%3Cpath d='M21 12H9'/%3E%3C/svg%3E");
  mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'/%3E%3Cpath d='M16 17l5-5-5-5'/%3E%3Cpath d='M21 12H9'/%3E%3C/svg%3E")}

.fcm #fcSignOutLink{color:var(--clay,#B4482F);font-weight:600}
/* order: who I am · saved · ── · accounts · theme · sign in · sign out */
.fcm #fcUserChip{order:10}
.fcm #fcDbChip{order:20}
.fcm .fcm-sep{order:25}
.fcm #fcmAccounts{order:30}
.fcm #fcmTheme{order:40}
.fcm #fcCompanyLink{order:50}
.fcm #fcSignOutLink{order:60}
@media print{ .fcm{display:none !important} }
`;
(function () {
  var st = D.createElement('style'); st.id = 'fc-topbar-css'; st.textContent = CSS; D.head.appendChild(st);
})();

function $id(id) { return D.getElementById(id); }
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(function (w) { return w[0]; }).join('').toUpperCase() || '?';
}
function isDark() { return D.documentElement.getAttribute('data-theme') === 'dark'; }
function signedInToServer() { return !!(ERP.Auth && ERP.Auth.identity); }

/* ══════════════════════════════════════════════════════════════════════════
   BUILD / RE-ASSEMBLE  (safe to run after every paint)
   ══════════════════════════════════════════════════════════════════════════ */
function menuEl() { return $id('fcAcctMenu'); }

function ensure() {
  /* the two dead controls */
  ['whBtn', 'syncBtn'].forEach(function (id) { var n = $id(id); if (n && n.parentNode) n.parentNode.removeChild(n); });

  var av = $id('avBtn');
  if (!av || !av.parentNode) return;

  var menu = menuEl();
  if (!menu) {
    menu = D.createElement('div');
    menu.id = 'fcAcctMenu';
    menu.className = 'fcm';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Account');
    menu.innerHTML =
      '<div class="fcm-sep"></div>' +
      '<button class="fcm-row" id="fcmAccounts" data-go="accounts" role="menuitem">' + I('users') +
        '<span>Company accounts<small id="fcmAccountsSub"></small></span></button>' +
      '<button class="fcm-row" id="fcmTheme" role="menuitem"><span id="fcmThemeIco"></span>' +
        '<span id="fcmThemeLbl">Dark mode</span></button>';
    av.parentNode.appendChild(menu);
    av.setAttribute('aria-haspopup', 'menu');
    av.setAttribute('aria-expanded', 'false');
  }

  /* whatever other modules created for the bar lives in the menu instead */
  ['fcUserChip', 'fcDbChip', 'fcCompanyLink', 'fcSignOutLink'].forEach(function (id) {
    var n = $id(id);
    if (n && n.parentNode !== menu) menu.appendChild(n);
  });
  /* an old link from before the password moved to Company accounts */
  var oldPw = $id('fcChangePwLink'); if (oldPw && oldPw.parentNode) oldPw.parentNode.removeChild(oldPw);

  /* the search icon sits right beside the search box, not inside the bell's wrapper */
  var sb = $id('fcSearchBtn'), gq = $id('gq');
  var sRel = gq && gq.closest ? gq.closest('.rel') : null;
  if (sb && sRel && sRel.parentNode && sRel.nextSibling !== sb) sRel.parentNode.insertBefore(sb, sRel.nextSibling);

  refresh();
}

/* the parts that follow state: initials, warning dot, accounts row, theme row, bell dot */
function refresh() {
  var av = $id('avBtn'); if (!av) return;
  var name = '';
  try { name = ERP.Session ? ERP.Session.name() : ''; } catch (e) {}
  av.textContent = initials(name || 'FA');
  av.setAttribute('aria-label', 'Account menu' + (name ? ' — ' + name : ''));

  var db = $id('fcDbChip');
  var warn = !!(db && /\bwarn\b/.test(db.className)), bad = !!(db && /\bbad\b/.test(db.className));
  av.classList.toggle('fcm-warn', warn || bad);
  av.classList.toggle('fcm-bad', bad);

  var acc = $id('fcmAccounts');
  if (acc) {
    acc.style.display = signedInToServer() ? '' : 'none';
    var sub = $id('fcmAccountsSub');
    if (sub) sub.textContent = (ERP.Can && ERP.Can('ACCOUNTS_MANAGE')) ? 'Change password · manage staff' : 'Change your password';
  }
  var th = $id('fcmThemeLbl'), ic = $id('fcmThemeIco');
  if (th) th.textContent = isDark() ? 'Light mode' : 'Dark mode';
  if (ic) ic.innerHTML = I(isDark() ? 'sun' : 'moon');

  /* bell */
  var bell = $id('bellBtn'), dot = bell && bell.querySelector('.dot');
  var low = 0;
  try { low = (global.PRODUCTS || []).filter(function (p) { return global.levelOf(p) !== 'ok'; }).length; } catch (e) {}
  if (dot) dot.classList.toggle('fcm-none', low === 0);
  if (bell) bell.setAttribute('aria-label', low ? 'Notifications — ' + low + ' products need stock attention' : 'Notifications');
}

/* ══════════════════════════════════════════════════════════════════════════
   OPEN / CLOSE
   ══════════════════════════════════════════════════════════════════════════ */
function setOpen(on) {
  var m = menuEl(), av = $id('avBtn'); if (!m || !av) return;
  if (on) refresh();
  m.classList.toggle('on', !!on);
  av.setAttribute('aria-expanded', on ? 'true' : 'false');
}
function isOpen() { var m = menuEl(); return !!(m && m.classList.contains('on')); }

D.addEventListener('click', function (e) {
  var t = e.target; if (!t || !t.closest) return;
  var av = t.closest('#avBtn');
  if (av) { e.preventDefault(); setOpen(!isOpen()); return; }
  var m = menuEl();
  if (!m || !isOpen()) return;
  if (t.closest('#fcAcctMenu')) {
    if (t.closest('#fcmTheme')) {
      e.preventDefault();
      var tb = $id('themeBtn'); if (tb) tb.click();
      setTimeout(refresh, 0);
    }
    /* any choice in the menu closes it */
    if (t.closest('button')) setOpen(false);
    return;
  }
  setOpen(false);                                   /* a click anywhere else */
}, true);

D.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && isOpen()) {
    setOpen(false);
    var av = $id('avBtn'); if (av && av.focus) av.focus();
  }
}, true);

/* ══════════════════════════════════════════════════════════════════════════
   HOOKS
   ══════════════════════════════════════════════════════════════════════════ */
var origPaint = global.paint;
if (typeof origPaint === 'function') {
  global.paint = function () {
    origPaint.apply(global, arguments);
    try { ensure(); } catch (e) {}
  };
}
try { ensure(); } catch (e) {}

ERP.TopBar = { ensure: ensure, refresh: refresh, open: function () { setOpen(true); }, close: function () { setOpen(false); },
               isOpen: isOpen };

})(typeof window !== 'undefined' ? window : globalThis);
