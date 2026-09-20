<?php
/** GET /api/data/status.php -> which backend this deployment uses, the current change counter, and
 *  the CSRF token the browser needs for writes. Always available to a signed-in user (the browser
 *  asks it at start-up to decide where its data lives); it never returns business data. */
declare(strict_types=1);
require __DIR__ . '/_guard.php';

$session = data_guard(false, true);
$backend = data_backend($CFG);
$out = ['backend' => $backend, 'available' => true, 'version' => 0, 'empty' => false,
        'csrf' => csrf_token_for($CFG, hash('sha256', $_COOKIE[auth_cookie_name($CFG)] ?? '')),
        'user' => ['id' => $session['uid'], 'role' => $session['role']]];
if ($backend === 'server') {
    try { $db = data_pdo($CFG); $out['version'] = data_version($db); $out['empty'] = data_is_empty($db); }
    catch (Throwable $e) { error_log('[erp-data] status: ' . $e->getMessage()); $out['available'] = false; }
}
json_out($out);
