<?php
/** POST /api/auth/logout.php -> revokes the current session and clears the cookie. */
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_session.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed.', 405);

$cookieName = auth_cookie_name($CFG);
$token = $_COOKIE[$cookieName] ?? '';

if ($token !== '') {
    $hash = hash('sha256', $token);
    $session = current_session($pdo, $CFG);
    $pdo->prepare('UPDATE auth_sessions SET revoked_at = NOW() WHERE id = ?')->execute([$hash]);
    if ($session) {
        audit($pdo, $session['uid'], $session['username'], 'Signed out', []);
    }
}

setcookie($cookieName, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
json_out(['ok' => true]);
