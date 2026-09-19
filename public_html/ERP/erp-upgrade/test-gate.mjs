/* Phase 3 login gate — end-to-end test of the REAL PHP (api/gate.php + login/me/logout)
   run under PHP's built-in web server against a throw-away SQLite database.

   What this proves: who gets the app, who gets the sign-in page, that an outage
   fails closed, and that the kill-switch works without a redeploy.
   What it can NOT prove: the Apache/LiteSpeed .htaccess rewrite rules, or the
   Hostinger CDN. Those are checked by hand after each deploy — see
   docs/OPERATIONS.md "Phase 3 rollout". The router below stands in for the
   rewrites; the .htaccess itself is only sanity-checked as text.

   Needs a `php` binary (PHP_BIN to override). Without one it SKIPS and exits 0,
   so a machine without PHP can still run the rest of the suite; CI has PHP. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ERP = path.resolve(HERE, '..');
const PHP = process.env.PHP_BIN || 'php';

let pass = 0, fail = 0; const out = [];
const check = (n, c, d) => { if (c) { pass++; out.push('  ✔ ' + n); } else { fail++; out.push('  ✘ ' + n + (d ? '   → ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const probe = spawnSync(PHP, ['-v'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.log('\n  SKIPPED — no php binary found (set PHP_BIN). The gate is PHP; this suite cannot run without it.\n\n0 passed, 0 failed (skipped)\n');
  process.exit(0);
}

/* ── throw-away "server": domain/private + domain/public_html/ERP, same shape as live ── */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-gate-'));
const DOMAIN = path.join(ROOT, 'domain');
const WEB = path.join(DOMAIN, 'public_html', 'ERP');
const DBFILE = path.join(ROOT, 'auth.sqlite');
fs.mkdirSync(path.join(DOMAIN, 'private'), { recursive: true });
fs.mkdirSync(path.join(WEB, '_app'), { recursive: true });
fs.cpSync(path.join(ERP, 'api'), path.join(WEB, 'api'), { recursive: true });

const MARK = { index: 'LAUNCHER-BODY-MARKER-7f3a', erp: 'ERP-BODY-MARKER-91c2 customer: Haji Sahib Traders', data: 'MASTER-DATA-MARKER-55de = {"customers":["Haji Sahib Traders"]}' };
fs.writeFileSync(path.join(WEB, '_app', 'index.html'), '<!DOCTYPE html><title>launcher</title>' + MARK.index);
fs.writeFileSync(path.join(WEB, '_app', 'farooq-co-erp.html'), '<!DOCTYPE html><title>erp</title>' + MARK.erp);
fs.writeFileSync(path.join(WEB, '_app', 'farooq-erp-data.js'), 'window.M=1; /* ' + MARK.data + ' */');
fs.writeFileSync(path.join(WEB, 'logo.png'), 'png');

/* stands in for the .htaccess rewrites (Apache isn't available here) */
fs.writeFileSync(path.join(WEB, 'router.php'), `<?php
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$map = ['/' => 'index', '/index.html' => 'index', '/farooq-co-erp.html' => 'erp', '/farooq-erp-data.js' => 'data'];
if (isset($map[$p])) { $_GET = ['f' => $map[$p]]; require __DIR__ . '/api/gate.php'; return true; }
return false;
`);

function cfg({ enforce, dsn }) {
  const lines = [
    "'db' => ['dsn' => " + JSON.stringify(dsn || 'sqlite:' + DBFILE.replace(/\\/g, '/')) + ", 'user' => null, 'pass' => null]",
    "'ticket_secret' => 'test-secret-test-secret-test-secret-0000'",
    "'session' => ['cookie_name' => '__Host-fcsid', 'absolute_ttl_min' => 720, 'idle_ttl_min' => 120]",
    "'offline_grace_hours' => 12",
    "'lockout' => ['max_attempts' => 5, 'window_minutes' => 15, 'lock_minutes' => 15]",
  ];
  if (enforce !== undefined) lines.push("'enforce_login' => " + (typeof enforce === 'string' ? JSON.stringify(enforce) : (enforce ? 'true' : 'false')));
  fs.writeFileSync(path.join(DOMAIN, 'private', 'erp-config.php'), '<?php\nreturn [\n  ' + lines.join(',\n  ') + '\n];\n');
}

function runPhp(code) {
  const f = path.join(ROOT, 'run.php'); fs.writeFileSync(f, '<?php ' + code);
  const r = spawnSync(PHP, ['-d', 'date.timezone=UTC', f], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('php helper failed: ' + r.stderr + r.stdout);
  return r.stdout;
}
/* the SQL goes through a file, not a PHP string literal — a bcrypt hash is full of "$" and would be interpolated */
const db = sql => {
  const sf = path.join(ROOT, 'stmt.sql'); fs.writeFileSync(sf, sql);
  runPhp("$p = new PDO('sqlite:" + DBFILE.replace(/\\/g, '/') + "'); $p->exec(file_get_contents('" + sf.replace(/\\/g, '/') + "'));");
};

const hash = runPhp("echo password_hash('correct horse battery', PASSWORD_BCRYPT);");
db(`
CREATE TABLE auth_users (id TEXT PRIMARY KEY, username TEXT UNIQUE, display_name TEXT, password_hash TEXT, role TEXT, phone TEXT,
  is_active INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0, failed_attempts INTEGER DEFAULT 0, locked_until TEXT,
  last_login_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, created_by TEXT, archived_at TEXT);
CREATE TABLE auth_sessions (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, ip TEXT, user_agent TEXT, revoked_at TEXT);
CREATE TABLE auth_login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, ip TEXT, ok INTEGER, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE auth_role_permissions (role TEXT, permission TEXT, PRIMARY KEY (role, permission));
CREATE TABLE auth_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT CURRENT_TIMESTAMP, user_id TEXT, username TEXT,
  action TEXT, detail TEXT, ip TEXT, user_agent TEXT);
INSERT INTO auth_users (id, username, display_name, password_hash, role) VALUES ('usr_owner', 'owner', 'The Owner', '${hash}', 'OWNER');
`);

/* start PHP's built-in server; config is re-read per request so the kill-switch can be flipped live */
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = 'http://127.0.0.1:' + PORT;
const server = spawn(PHP, ['-d', 'date.timezone=UTC', '-S', '127.0.0.1:' + PORT, '-t', WEB, path.join(WEB, 'router.php')], { stdio: 'ignore' });
const cleanup = () => { try { server.kill(); } catch (e) {} try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);

async function get(p, { cookie, headers = {}, method = 'GET' } = {}) {
  const h = { ...headers }; if (cookie) h.Cookie = cookie;
  const r = await fetch(BASE + p, { method, headers: h, redirect: 'manual' });
  return { status: r.status, headers: r.headers, body: method === 'HEAD' ? '' : await r.text() };
}
async function post(p, body, { cookie } = {}) {
  const h = { 'Content-Type': 'application/json' }; if (cookie) h.Cookie = cookie;
  const r = await fetch(BASE + p, { method: 'POST', headers: h, body: JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let json = {}; try { json = JSON.parse(text); } catch (e) {}
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  const m = sc.map(s => s.split(';')[0]).find(s => s.startsWith('__Host-fcsid='));
  return { status: r.status, json, cookie: m && m !== '__Host-fcsid=' ? m : null, setCookie: sc };
}
async function waitUp() { for (let i = 0; i < 80; i++) { try { await fetch(BASE + '/api/gate.php?f=x'); return true; } catch (e) { await sleep(100); } } return false; }
const has = (r, s) => r.body.includes(s);
const cc = r => r.headers.get('cache-control') || '';

async function main() {
  cfg({});   // no 'enforce_login' key at all — how the live config looks today
  check('S0 the PHP server came up', await waitUp());

  /* ── DORMANT: exactly the pre-Phase-3 behaviour, and no database needed ── */
  cfg({ dsn: 'sqlite:/no/such/dir/never.sqlite' });  // unreachable DB — dormant mode must not care
  {
    const a = await get('/'), b = await get('/index.html'), c = await get('/farooq-co-erp.html'), d = await get('/farooq-erp-data.js');
    check('D1 dormant: / serves the launcher to anyone', a.status === 200 && has(a, MARK.index));
    check('D2 dormant: /index.html, /farooq-co-erp.html, /farooq-erp-data.js all 200',
      b.status === 200 && has(b, MARK.index) && c.status === 200 && has(c, MARK.erp) && d.status === 200 && has(d, MARK.data));
    check('D3 dormant: content types are right', /text\/html/.test(c.headers.get('content-type')) && /javascript/.test(d.headers.get('content-type')));
    check('D4 dormant: works with the database completely unreachable (gate never touches it)', a.status === 200 && c.status === 200);
    const etag = a.headers.get('etag');
    check('D5 dormant: an ETag is sent', !!etag);
    const r304 = await get('/', { headers: { 'If-None-Match': etag } });
    check('D6 dormant: a matching If-None-Match gets a 304 with no body', r304.status === 304 && r304.body === '');
    const r304g = await get('/', { headers: { 'If-None-Match': etag.replace(/"$/, '-gzip"') } });
    check('D7 dormant: an ETag rewritten by compression ("…-gzip") still gets a 304', r304g.status === 304);
    check('D8 dormant: the CDN-safe cache header is set', /no-cache/.test(cc(a)));
  }

  /* ── ENFORCED, signed out ── */
  cfg({ enforce: true });
  let cookie;
  {
    const a = await get('/'), c = await get('/farooq-co-erp.html'), d = await get('/farooq-erp-data.js'), i = await get('/index.html');
    check('E1 enforced: / shows the sign-in page (401), not the app', a.status === 401 && !has(a, MARK.index) && /<form id="f"/.test(a.body));
    check('E2 enforced: /index.html is gated too', i.status === 401 && !has(i, MARK.index));
    check('E3 enforced: the ERP file is refused and none of its content leaks',
      c.status === 401 && !has(c, 'customer:') && !has(c, MARK.erp));
    check('E4 enforced: the master-data file is refused and none of its content leaks',
      d.status === 401 && !has(d, 'Haji') && !has(d, MARK.data));
    check('E5 enforced: sign-in page is served as HTML and marked no-store (CDN must never keep it)',
      /text\/html/.test(a.headers.get('content-type')) && /no-store/.test(cc(a)));
    check('E6 the sign-in page posts to the login API and probes /me.php with relative URLs',
      a.body.includes("'api/auth/login.php'") && a.body.includes("'api/auth/me.php'"));
    check('E7 a garbage session cookie is not a session', (await get('/', { cookie: '__Host-fcsid=' + 'a'.repeat(64) })).status === 401);
    const etag = (await (async () => { cfg({ enforce: false }); const r = await get('/'); cfg({ enforce: true }); return r; })()).headers.get('etag');
    const sneaky = await get('/', { headers: { 'If-None-Match': etag } });
    check('E8 enforced: a matching If-None-Match does NOT bypass the sign-in check', sneaky.status === 401 && !has(sneaky, MARK.index));
    check('E9 /api/gate.php with an unknown target is a plain 404', (await get('/api/gate.php?f=nope')).status === 404 && (await get('/api/gate.php?f=../../x')).status === 404);
  }

  /* ── the sign-in page's own script: what a person actually experiences ── */
  {
    const html = (await get('/')).body;
    const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
    check('P0 the sign-in page carries its script', script.length > 200);
    const run = ({ me = 401, login, netFail = false, flag = false }) => {
      const dom = new JSDOM(html); const doc = dom.window.document;
      const calls = { replace: [], fetch: [] }, store = flag ? { fcGateGo: String(Date.now()) } : {};
      const loc = { pathname: '/', search: '?app=erp', replace: u => calls.replace.push(u) };
      const ss = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
      const fx = (url) => {
        calls.fetch.push(url);
        if (netFail) return Promise.reject(new Error('offline'));
        const isMe = /me\.php/.test(url);
        return Promise.resolve({ status: isMe ? me : login.status, json: async () => (isMe ? {} : login.data) });
      };
      new Function('document', 'location', 'sessionStorage', 'fetch', 'window', script)(doc, loc, ss, fx, { fetch: fx });
      const submit = (u, p) => { doc.getElementById('u').value = u; doc.getElementById('p').value = p; doc.getElementById('f').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); };
      return { doc, calls, store, submit };
    };
    let r = run({ me: 200 }); await sleep(40);
    check('P1 already signed in but the SameSite cookie was withheld (clicked from WhatsApp/Google): it steps straight in, keeping ?app=',
      r.calls.replace.length === 1 && r.calls.replace[0] === '/?app=erp');
    r = run({ me: 200, flag: true }); await sleep(40);
    check('P2 …but never loops: a recent attempt suppresses a second automatic step-in', r.calls.replace.length === 0 && !r.calls.fetch.some(u => /me\.php/.test(u)));
    r = run({ me: 401 }); await sleep(40);
    check('P3 not signed in: it just waits for the person to type', r.calls.replace.length === 0);
    r = run({}); r.submit('', ''); await sleep(20);
    check('P4 an empty form is refused client-side without calling the server',
      /Enter your username/.test(r.doc.getElementById('e').textContent) && !r.calls.fetch.some(u => /login\.php/.test(u)));
    r = run({ login: { status: 401, data: { error: 'That username or password is not right.' } } });
    r.submit('owner', 'nope'); await sleep(40);
    check('P5 a wrong password shows the server\'s message, clears the password and re-enables the button',
      /not right/.test(r.doc.getElementById('e').textContent) && r.doc.getElementById('p').value === '' &&
      r.doc.getElementById('b').disabled === false && r.doc.getElementById('b').textContent === 'Sign in' && r.calls.replace.length === 0);
    r = run({ login: { status: 423, data: { error: 'Too many attempts. Try again in a few minutes.' } } });
    r.submit('owner', 'x'); await sleep(40);
    check('P6 a lockout message is shown as written', /Too many attempts/.test(r.doc.getElementById('e').textContent));
    r = run({ netFail: true }); r.submit('owner', 'x'); await sleep(40);
    check('P7 no connection gives a plain "could not reach the server", and the form recovers',
      /Could not reach the server/.test(r.doc.getElementById('e').textContent) && r.doc.getElementById('b').disabled === false);
    r = run({ login: { status: 200, data: { user: {} } } }); r.submit('owner', 'right'); await sleep(40);
    check('P8 a successful sign-in reloads into the app (same URL, query kept)', r.calls.replace.length === 1 && r.calls.replace[0] === '/?app=erp');
  }

  /* ── sign in ── */
  {
    const bad = await post('/api/auth/login.php', { username: 'owner', password: 'wrong' });
    check('L1 a wrong password is refused and sets no session cookie', bad.status === 401 && !bad.cookie);
    const ok = await post('/api/auth/login.php', { username: 'owner', password: 'correct horse battery' });
    cookie = ok.cookie;
    check('L2 the right password signs in and sets the session cookie', ok.status === 200 && !!cookie);
    check('L3 the login response tells the client sign-in is mandatory (enforce: true)', ok.json.enforce === true);
    check('L4 the cookie is HttpOnly, Secure and SameSite=Strict',
      /httponly/i.test(ok.setCookie[0]) && /secure/i.test(ok.setCookie[0]) && /samesite=strict/i.test(ok.setCookie[0]));
  }

  /* ── ENFORCED, signed in ── */
  {
    const a = await get('/', { cookie }), c = await get('/farooq-co-erp.html', { cookie }), d = await get('/farooq-erp-data.js', { cookie });
    check('F1 signed in: the launcher, the ERP and the data file are all served',
      a.status === 200 && has(a, MARK.index) && c.status === 200 && has(c, MARK.erp) && d.status === 200 && has(d, MARK.data));
    check('F2 signed in: responses are private + must revalidate (CDN can not share them)', /private/.test(cc(a)) && /no-cache/.test(cc(a)));
    check('F3 signed in: Vary: Cookie', /cookie/i.test(a.headers.get('vary') || ''));
    const etag = a.headers.get('etag');
    const n = await get('/', { cookie, headers: { 'If-None-Match': etag } });
    check('F4 signed in: an unchanged file revalidates as a 304 (no 3 MB re-download)', n.status === 304 && n.body === '');
    const h = await get('/', { cookie, method: 'HEAD' });
    check('F5 HEAD works and sends no body', h.status === 200 && h.body === '');
    const me = await get('/api/auth/me.php', { cookie }); const meJ = JSON.parse(me.body);
    check('F6 me.php reports the identity and enforce: true', me.status === 200 && meJ.user.username === 'owner' && meJ.enforce === true);
  }

  /* ── the session ends: every way it can ── */
  {
    const out1 = await post('/api/auth/logout.php', {}, { cookie });
    check('O1 signing out succeeds', out1.status === 200);
    const a = await get('/', { cookie }), me = await get('/api/auth/me.php', { cookie });
    check('O2 after sign-out the same cookie no longer opens the app', a.status === 401 && !has(a, MARK.index));
    check('O3 after sign-out me.php is 401 too', me.status === 401);

    const fresh = async () => (await post('/api/auth/login.php', { username: 'owner', password: 'correct horse battery' })).cookie;
    let ck = await fresh();
    check('O4 (control) a fresh sign-in works again', (await get('/', { cookie: ck })).status === 200);

    db("UPDATE auth_sessions SET expires_at = '2000-01-01 00:00:00'");
    check('O5 an expired session (past the 12 h cap) is refused', (await get('/', { cookie: ck })).status === 401);

    ck = await fresh();
    db("UPDATE auth_sessions SET last_seen_at = '2000-01-01 00:00:00' WHERE revoked_at IS NULL AND expires_at > datetime('now')");
    check('O6 an idle session (untouched > 2 h) is refused', (await get('/', { cookie: ck })).status === 401);

    ck = await fresh();
    check('O7 (control) fresh again', (await get('/', { cookie: ck })).status === 200);
    db("UPDATE auth_users SET is_active = 0 WHERE username = 'owner'");
    check('O8 deactivating the account cuts off its LIVE session at once', (await get('/', { cookie: ck })).status === 401);
    db("UPDATE auth_users SET is_active = 1 WHERE username = 'owner'");
  }

  /* ── fail closed ── */
  {
    const ck = (await post('/api/auth/login.php', { username: 'owner', password: 'correct horse battery' })).cookie;
    cfg({ enforce: true, dsn: 'sqlite:/no/such/dir/never.sqlite' });
    const a = await get('/', { cookie: ck }), c = await get('/farooq-co-erp.html', { cookie: ck });
    check('X1 enforced + database unreachable: 503 retry page, NOT the app (fails closed)',
      a.status === 503 && !has(a, MARK.index) && /Try again/.test(a.body) && c.status === 503 && !has(c, MARK.erp));
    check('X2 the outage page is HTML and not cacheable', /text\/html/.test(a.headers.get('content-type')) && /no-store/.test(cc(a)));
  }

  /* ── a broken config is not "no config" ── */
  {
    fs.writeFileSync(path.join(DOMAIN, 'private', 'erp-config.php'), '<?php\nreturn [ \'enforce_login\' => true,, ;\n');
    const a = await get('/'), c = await get('/farooq-co-erp.html');
    check('X3 a config with a syntax error fails closed (503 retry page, no app) — it is not treated as "absent"',
      a.status === 503 && !has(a, MARK.index) && c.status === 503 && !has(c, MARK.erp));
    fs.writeFileSync(path.join(DOMAIN, 'private', 'erp-config.php'), '<?php\nreturn "not an array";\n');
    check('X4 a config that returns something other than an array fails closed too', (await get('/')).status === 503);
  }

  /* ── kill switch ── */
  {
    cfg({ enforce: false });
    const a = await get('/'), d = await get('/farooq-erp-data.js');
    check('K1 flipping enforce_login to false reopens the app immediately, no redeploy',
      a.status === 200 && has(a, MARK.index) && d.status === 200);
    cfg({ enforce: true });
    check('K2 flipping it back to true closes it again', (await get('/')).status === 401);
    cfg({ enforce: 'yes' });   // truthy but not the boolean true
    check('K3 only a real boolean true enforces ("yes"/1 do not — no accidental lock-out from a typo)', (await get('/')).status === 200);
  }

  /* ── static sanity of the shipped files (the parts the built-in server can't exercise) ── */
  {
    const ht = fs.readFileSync(path.join(ERP, '.htaccess'), 'utf8');
    check('H1 root .htaccess rewrites the three public URLs to gate.php',
      /RewriteRule \^\$\s+api\/gate\.php\?f=index/.test(ht) && /RewriteRule \^index\\\.html\$\s+api\/gate\.php\?f=index/.test(ht) &&
      /RewriteRule \^farooq-co-erp\\\.html\$\s+api\/gate\.php\?f=erp/.test(ht) && /RewriteRule \^farooq-erp-data\\\.js\$\s+api\/gate\.php\?f=data/.test(ht));
    check('H2 the rewrite rules do not pass the query string through (a caller can not pick another target)', !/QSA/.test(ht.split('\n').filter(l => /gate\.php/.test(l)).join('\n')));
    const appHt = fs.existsSync(path.join(ERP, '_app', '.htaccess')) ? fs.readFileSync(path.join(ERP, '_app', '.htaccess'), 'utf8') : '';
    check('H3 _app/.htaccess denies all direct access', /Require all denied/.test(appHt) && /Deny from all/.test(appHt));
    check('H4 the gate helper files start with "_" so api/.htaccess refuses them over HTTP',
      fs.existsSync(path.join(ERP, 'api', '_gate_login.php')) && /\^_/.test(fs.readFileSync(path.join(ERP, 'api', '.htaccess'), 'utf8')));
    check('H5 the live config template documents the kill-switch', /enforce_login/.test(fs.readFileSync(path.resolve(ERP, '../../private/erp-config.sample.php'), 'utf8')));
  }

  console.log('\n' + out.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed\n');
  cleanup();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); console.log(out.join('\n')); cleanup(); process.exit(2); });
