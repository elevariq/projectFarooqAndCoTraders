<?php
/**
 * The sign-in page gate.php shows to anyone without a valid session, plus the
 * "can't verify right now" page for when the database is unreachable.
 * Prefixed with _ so api/.htaccess refuses to serve it over HTTP directly.
 *
 * Self-contained on purpose (inline CSS/JS, one image): it is served in place
 * of the app, so it must not depend on any other protected file.
 */
declare(strict_types=1);

function gate_page_shell(string $title, string $body, string $script = ''): string {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        . '<meta name="robots" content="noindex, nofollow">'
        . '<meta name="theme-color" content="#6D28D9">'
        . '<title>' . $title . '</title><link rel="icon" type="image/png" href="logo.png">'
        . '<style>'
        . '*{box-sizing:border-box}html,body{margin:0;min-height:100%}'
        . 'body{font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F4F4F7;color:#12111A;'
        . 'display:grid;place-items:center;min-height:100vh;padding:20px;-webkit-font-smoothing:antialiased}'
        . '.box{width:min(380px,100%);background:#fff;border:1px solid #E8E8EE;border-radius:20px;padding:28px 24px;'
        . 'box-shadow:0 12px 30px rgba(18,17,26,.08);text-align:center}'
        . '.mark{width:60px;height:60px;margin:0 auto 14px;border-radius:50%;background:#fff;overflow:hidden}'
        . '.mark img{width:100%;height:100%;object-fit:contain}'
        . 'h1{font-size:21px;margin:0 0 4px;letter-spacing:-.02em}'
        . 'p.sub{margin:0 0 18px;color:#696D80;font-size:13.5px}'
        . 'label{display:block;text-align:left;font-size:12px;font-weight:700;color:#3C3B4C;margin:12px 0 5px}'
        . 'input{width:100%;padding:11px 12px;border:1.5px solid #E8E8EE;border-radius:11px;font:inherit;font-size:16px}'
        . 'input:focus{outline:none;border-color:#7C3AED;box-shadow:0 0 0 3px #E7DCFF}'
        . 'button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:11px;background:#6D28D9;color:#fff;'
        . 'font:inherit;font-size:15px;font-weight:700;cursor:pointer}'
        . 'button[disabled]{opacity:.6;cursor:default}'
        . '.err{color:#C0392B;font-size:13px;min-height:18px;margin-top:12px}'
        . '.foot{margin-top:16px;color:#696D80;font-size:11.5px}'
        . '</style></head><body><div class="box">'
        . '<div class="mark"><img src="logo.png" alt="Farooq &amp; Co Traders"></div>'
        . $body . '</div>' . ($script !== '' ? '<script>' . $script . '</script>' : '') . '</body></html>';
}

function gate_login_page(string $next = '/'): string {
    // A REAL form post (not fetch): browsers' password managers offer to save a password
    // when a form is genuinely submitted and the browser then navigates. login.php answers a
    // form post with a 303 back to `next`, or to `next?signin=<code>` when something is wrong.
    $nextAttr = htmlspecialchars(auth_safe_next($next), ENT_QUOTES);
    $body = '<h1>Farooq &amp; Co Traders</h1><p class="sub">Sign in to open the ERP</p>'
        . '<form id="f" method="post" action="api/auth/login.php" autocomplete="on" novalidate>'
        . '<input type="hidden" name="next" id="n" value="' . $nextAttr . '">'
        . '<label for="u">Username</label><input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus>'
        . '<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password">'
        . '<div class="err" id="e" role="alert"></div>'
        . '<button id="b" type="submit">Sign in</button></form>'
        . '<div class="foot">Ask the owner if you need an account or have forgotten your password.</div>';

    // Relative URLs throughout: this page can be reached at / , /index.html or
    // /farooq-co-erp.html, and the same files are also served under /ERP/ on
    // the main domain — a relative path resolves correctly in every case.
    $script = <<<'JS'
(function () {
  var f = document.getElementById('f'), u = document.getElementById('u'), p = document.getElementById('p'),
      e = document.getElementById('e'), b = document.getElementById('b'), n = document.getElementById('n');
  var FLAG = 'fcGateGo';
  var MSG = {
    bad: 'That username or password is not right.',
    empty: 'Enter your username and password.',
    locked: 'This account is temporarily locked. Try again later.',
    rate: 'Too many attempts. Try again in a few minutes.',
    down: 'The server could not be reached just now. Try again in a moment.'
  };
  /* the address without a leftover ?signin=<code> marker */
  function cleanSearch() {
    return location.search.replace(/([?&])signin=[a-z]+(&|$)/, '$1').replace(/[?&]$/, '');
  }
  /* a failed attempt comes back here as ?signin=<code>: say why, then tidy the address so a reload is clean */
  var m = /[?&]signin=([a-z]+)/.exec(location.search);
  if (m) {
    if (MSG[m[1]]) e.textContent = MSG[m[1]];
    try { history.replaceState(null, '', location.pathname + cleanSearch()); } catch (x) {}
  }
  /* after signing in the browser is sent back to exactly where it was (?app=erp and all) */
  n.value = location.pathname + cleanSearch();

  function proceed() {
    try { sessionStorage.setItem(FLAG, String(Date.now())); } catch (x) {}
    location.replace(location.pathname + cleanSearch());
  }
  function recently() {
    try { var t = +sessionStorage.getItem(FLAG); return t && Date.now() - t < 15000; } catch (x) { return false; }
  }
  /* The session cookie is SameSite=Strict, so a link clicked from another site
     (WhatsApp, a browser search result) arrives without it even though the
     person is signed in. Ask the API from inside the site — that request does
     carry it — and step straight in. The flag stops this ever looping. */
  if (!m && !recently() && window.fetch) {
    fetch('api/auth/me.php', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (r.status === 200) proceed(); })
      .catch(function () {});
  }
  f.addEventListener('submit', function (ev) {
    e.textContent = '';
    if (!u.value.trim() || !p.value) {
      ev.preventDefault();
      e.textContent = MSG.empty;
      return;
    }
    /* let the browser submit the form for real; only dim the button once it is on its way */
    setTimeout(function () { b.disabled = true; b.textContent = 'Signing in…'; }, 0);
  });
  /* coming back to this page from the bfcache (Back button) must not leave a dead button */
  window.addEventListener('pageshow', function () { b.disabled = false; b.textContent = 'Sign in'; });
})();
JS;
    return gate_page_shell('Sign in — Farooq &amp; Co Traders', $body, $script);
}

function gate_unavailable_page(): string {
    $body = '<h1>Can’t check your sign-in</h1>'
        . '<p class="sub">The server could not be reached just now. Nothing has been lost — '
        . 'your saved data lives on this device.</p>'
        . '<button onclick="location.reload()">Try again</button>';
    return gate_page_shell('Temporarily unavailable — Farooq &amp; Co Traders', $body);
}
