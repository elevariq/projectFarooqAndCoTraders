<?php
/**
 * POST /api/auth/ticket.php -> re-issue the offline grace-period ticket while
 * online, so a session that's been open for a while doesn't run out of
 * offline runway without the user ever having a chance to refresh it.
 */
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_session.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed.', 405);

$session = require_login($pdo, $CFG);
$sessionHash = hash('sha256', $_COOKIE[auth_cookie_name($CFG)] ?? '');
require_csrf($pdo, $CFG, $sessionHash);

$permissions = permissions_for_role($pdo, $session['role']);
$graceHours = $CFG['offline_grace_hours'] ?? 12;
$ticket = make_offline_ticket($CFG, [
    'uid'   => $session['uid'],
    'role'  => $session['role'],
    'perms' => $permissions,
    'exp'   => time() + $graceHours * 3600,
]);

json_out(['offlineTicket' => $ticket, 'issuedAt' => time()]);
