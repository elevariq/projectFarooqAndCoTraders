<?php
/**
 * Login gate for the ERP app files (auth project, Phase 3).
 *
 * The real app files live in ../_app/ (which is denied to the web outright).
 * ../.htaccess rewrites the public URLs to this script:
 *
 *     /  and  /index.html      ->  gate.php?f=index   (the Office / Warehouse launcher)
 *     /farooq-co-erp.html      ->  gate.php?f=erp     (the ERP itself)
 *     /farooq-erp-data.js      ->  gate.php?f=data    (master-data copy)
 *
 * Behaviour is decided by the kill-switch in private/erp-config.php:
 *
 *     'enforce_login' => true    signed-in session required; everyone else gets
 *                                the sign-in page (401), and never the app or
 *                                the customer/supplier master data inside it.
 *     absent / false             dormant: the files are served to anyone, just
 *                                as before Phase 3, and the database is not
 *                                even contacted.
 *
 * Fails CLOSED when enforcing and the database can't be reached (503 retry
 * page) — an outage must never turn into an open door. To reopen the app in
 * an emergency, set 'enforce_login' => false; no redeploy is needed.
 */
declare(strict_types=1);

require __DIR__ . '/_session.php';      // function definitions only — safe without a DB
require __DIR__ . '/_gate_login.php';

const GATE_FILES = [
    'index' => ['index.html',         'text/html; charset=utf-8'],
    'erp'   => ['farooq-co-erp.html', 'text/html; charset=utf-8'],
    'data'  => ['farooq-erp-data.js', 'application/javascript; charset=utf-8'],
];

function gate_reply(int $status, string $body, string $type = 'text/plain; charset=utf-8'): never {
    http_response_code($status);
    header('Content-Type: ' . $type);
    header('Cache-Control: no-store, private');   // never let the CDN or a proxy keep a sign-in answer
    header('X-Content-Type-Options: nosniff');
    header('Vary: Cookie');
    echo $body;
    exit;
}

/**
 * True if the browser's If-None-Match names our ETag. Compression modules
 * (mod_deflate, LiteSpeed) rewrite an ETag on the way out — "abc" becomes
 * "abc-gzip" — and the browser echoes that back, so a strict comparison would
 * silently turn every revalidation into a full 3 MB download.
 */
function gate_etag_matches(string $header, string $etag): bool {
    if ($header === '') return false;
    $want = trim($etag, '"');
    foreach (explode(',', $header) as $tok) {
        $tok = preg_replace('/^\s*W\//', '', trim($tok));
        $tok = trim((string)$tok, '"');
        $tok = preg_replace('/-(gzip|br|df)$/', '', $tok);
        if ($tok === $want) return true;
    }
    return false;
}

/**
 * Stream an app file. ETag + no-cache means the browser still re-asks every
 * time (so the sign-in check runs on every load) but gets a tiny 304 instead of
 * re-downloading ~3 MB when nothing changed. "private" keeps the CDN out of it.
 */
function gate_send(string $path, string $type, string $cacheControl): never {
    $mtime = (int)filemtime($path);
    $size  = (int)filesize($path);
    $etag  = '"' . dechex($mtime) . '-' . dechex($size) . '"';
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    header('Cache-Control: ' . $cacheControl);
    header('Content-Type: ' . $type);
    header('X-Content-Type-Options: nosniff');
    header('Vary: Cookie');
    if (gate_etag_matches($_SERVER['HTTP_IF_NONE_MATCH'] ?? '', $etag)) {
        http_response_code(304);
        exit;
    }
    header('Content-Length: ' . $size);
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') readfile($path);
    exit;
}

/** Called by _bootstrap.php if the database can't be reached (see there). */
function erp_db_unavailable(): never {
    gate_reply(503, gate_unavailable_page(), 'text/html; charset=utf-8');
}

$key = (string)($_GET['f'] ?? '');
if (!isset(GATE_FILES[$key])) gate_reply(404, 'Not found.');

[$file, $type] = GATE_FILES[$key];
$path = dirname(__DIR__) . '/_app/' . $file;
if (!is_file($path)) {
    error_log('[erp-gate] app file missing: ' . $path);
    gate_reply(500, 'The application file is missing on the server.');
}

// Config is read directly (not via _bootstrap.php) so the dormant path never
// needs the database. Missing config = dormant, matching "absent = false".
$configPath = dirname(__DIR__, 3) . '/private/erp-config.php';
try {
    $CFG = is_file($configPath) ? (require $configPath) : [];
    if (!is_array($CFG)) throw new UnexpectedValueException('erp-config.php did not return an array');
} catch (Throwable $e) {
    // A config that exists but is broken is NOT "absent": we can't tell whether
    // the owner meant to be enforcing, so fail closed (the API is dead too).
    error_log('[erp-gate] unreadable config: ' . $e->getMessage());
    gate_reply(503, gate_unavailable_page(), 'text/html; charset=utf-8');
}

if (!auth_enforcing($CFG)) {
    gate_send($path, $type, 'no-cache');
}

require __DIR__ . '/_bootstrap.php';    // $pdo, $CFG — or erp_db_unavailable() above
if (current_session($pdo, $CFG)) {
    gate_send($path, $type, 'private, no-cache');
}

if ($key === 'data') gate_reply(401, 'Sign in required.');
// after signing in, come back to the page that was asked for (path only; auth_safe_next() vets it)
gate_reply(401, gate_login_page((string)parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH)), 'text/html; charset=utf-8');
