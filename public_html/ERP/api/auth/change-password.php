<?php
/**
 * POST /api/auth/change-password.php { currentPassword, newPassword }
 * Requires the current password even for an OWNER changing their own.
 */
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_session.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed.', 405);

$session = require_login($pdo, $CFG);
$sessionHash = hash('sha256', $_COOKIE[auth_cookie_name($CFG)] ?? '');
require_csrf($pdo, $CFG, $sessionHash);

$body = json_body();
$current = (string)($body['currentPassword'] ?? '');
$new = (string)($body['newPassword'] ?? '');

if (strlen($new) < 8) {
    json_error('The new password must be at least 8 characters.', 400);
}

$stmt = $pdo->prepare('SELECT password_hash FROM auth_users WHERE id = ?');
$stmt->execute([$session['uid']]);
$row = $stmt->fetch();

if (!$row || !password_verify($current, $row['password_hash'])) {
    json_error('Your current password is not right.', 401);
}

$newHash = password_hash($new, PASSWORD_DEFAULT);
$pdo->prepare('UPDATE auth_users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    ->execute([$newHash, $session['uid']]);

audit($pdo, $session['uid'], $session['username'], 'Password changed', []);

json_out(['ok' => true]);
