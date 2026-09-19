<?php
/** GET /api/auth/me.php -> current identity + permissions, or 401. */
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_session.php';

$session = require_login($pdo, $CFG);
$permissions = permissions_for_role($pdo, $session['role']);
$csrf = csrf_token_for($CFG, hash('sha256', $_COOKIE[auth_cookie_name($CFG)] ?? ''));

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
]);
