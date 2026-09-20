<?php
/**
 * Shared front door for the business-data endpoints. Every endpoint here requires:
 *  - a signed-in session (401 otherwise),
 *  - for anything that writes: the CSRF token (419 otherwise),
 *  - 'data_backend' => 'server' in private/erp-config.php — OR, while that switch is still off, the
 *    OWNER role (so the owner can test before anyone else is affected). Everyone else gets 403.
 * Every response is `Cache-Control: no-store` (json_out) — the CDN must never keep business data.
 */
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_session.php';
require __DIR__ . '/../_data.php';

function data_guard(bool $write, bool $ignoreSwitch = false): array {
    global $pdo, $CFG;
    $session = require_login($pdo, $CFG);
    if ($write) require_csrf($pdo, $CFG, hash('sha256', $_COOKIE[auth_cookie_name($CFG)] ?? ''));
    if (!$ignoreSwitch && data_backend($CFG) !== 'server' && $session['role'] !== AUTH_ALL_PERMS_ROLE) {
        json_error('Server data is not enabled yet.', 403);
    }
    return $session;
}

function data_db(): PDO {
    global $CFG;
    try { return data_pdo($CFG); }
    catch (Throwable $e) { error_log('[erp-data] biz DB connect failed: ' . $e->getMessage()); json_error('Could not reach the business database.', 503); }
}

/** Output big JSON text as-is (already encoded, never re-encoded), compressed when the browser accepts it. */
function data_raw_out(string $json): never {
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    if (!ini_get('zlib.output_compression') && stripos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false) ob_start('ob_gzhandler');
    echo $json;
    exit;
}
