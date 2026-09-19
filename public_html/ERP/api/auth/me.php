<?php
/** GET /api/auth/me.php -> current identity + permissions, or 401. */
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_session.php';

$session = require_login($pdo, $CFG);
$permissions = permissions_for_role($pdo, $session['role']);
$csrf = csrf_token_for($CFG, hash('sha256', $_COOKIE[auth_cookie_name($CFG)] ?? ''));

// A page opened through the login gate never saw login.php's response (the
// gate's own sign-in page consumed it), so without this the app would hold no
// offline ticket at all and a device that loses signal would lock immediately.
// Issuing a fresh one on every successful check makes the grace window
// "N hours since we last spoke to the server", which is what it should mean.
$graceHours = $CFG['offline_grace_hours'] ?? 12;
$offlineTicket = make_offline_ticket($CFG, [
    'uid'   => $session['uid'],
    'role'  => $session['role'],
    'perms' => $permissions,
    'exp'   => time() + $graceHours * 3600,
]);

json_out([
    'user' => [
        'id'          => $session['uid'],
        'username'    => $session['username'],
        'displayName' => $session['display_name'],
    ],
    'role'               => $session['role'],
    'permissions'        => $permissions,
    'mustChangePassword' => (bool)$session['must_change_password'],
    'csrf'               => $csrf,
    'enforce'            => auth_enforcing($CFG),   // tells the client whether sign-in is mandatory
    'offlineTicket'      => $offlineTicket,
]);
