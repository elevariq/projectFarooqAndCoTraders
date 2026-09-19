<?php
/**
 * POST /api/auth/login.php  { username, password }
 * -> 200 { user, role, permissions[], csrf, offlineTicket, expiresAt }
 * -> 401 { error } on bad credentials (deliberately the same message whether
 *         the username doesn't exist or the password is wrong)
 * -> 423 { error } when locked out
 */
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_session.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed.', 405);

$body = json_body();
$username = trim((string)($body['username'] ?? ''));
$password = (string)($body['password'] ?? '');
$ip = client_ip();

if ($username === '' || $password === '') {
    json_error('Enter a username and password.', 400);
}

// ---- rate limiting: per-username AND per-IP -------------------------------
$lockout = $CFG['lockout'];
$windowStart = date('Y-m-d H:i:s', time() - $lockout['window_minutes'] * 60);

$countStmt = $pdo->prepare(
    'SELECT COUNT(*) FROM auth_login_attempts
     WHERE ok = 0 AND at > ? AND (username = ? OR ip = ?)'
);
$countStmt->execute([$windowStart, $username, $ip]);
$recentFailures = (int)$countStmt->fetchColumn();

if ($recentFailures >= $lockout['max_attempts']) {
    audit($pdo, null, $username, 'Login blocked (rate limited)', ['ip' => $ip]);
    json_error('Too many attempts. Try again in a few minutes.', 423);
}

// ---- look up the account ---------------------------------------------------
$stmt = $pdo->prepare('SELECT * FROM auth_users WHERE username = ? LIMIT 1');
$stmt->execute([$username]);
$user = $stmt->fetch();

$recordAttempt = function (bool $ok) use ($pdo, $username, $ip) {
    $stmt = $pdo->prepare('INSERT INTO auth_login_attempts (username, ip, ok) VALUES (?, ?, ?)');
    $stmt->execute([$username, $ip, $ok ? 1 : 0]);
};

$fail = function () use ($recordAttempt, $pdo, $username) {
    $recordAttempt(false);
    audit($pdo, null, $username, 'Sign-in failed', []);
    json_error('That username or password is not right.', 401);
};

if (!$user) $fail();
if ((int)$user['is_active'] !== 1) $fail();

// per-account lock (distinct from the rolling rate-limit above)
if (!empty($user['locked_until']) && strtotime($user['locked_until']) > time()) {
    audit($pdo, $user['id'], $username, 'Sign-in blocked (account locked)', []);
    json_error('This account is temporarily locked. Try again later.', 423);
}

if (!password_verify($password, $user['password_hash'])) {
    // bump failed_attempts; lock the account itself after max_attempts too,
    // so a slow/distributed attempt across many IPs is still capped.
    $newFailed = (int)$user['failed_attempts'] + 1;
    if ($newFailed >= $lockout['max_attempts']) {
        $lockUntil = date('Y-m-d H:i:s', time() + $lockout['lock_minutes'] * 60);
        $upd = $pdo->prepare('UPDATE auth_users SET failed_attempts = ?, locked_until = ? WHERE id = ?');
        $upd->execute([$newFailed, $lockUntil, $user['id']]);
    } else {
        $upd = $pdo->prepare('UPDATE auth_users SET failed_attempts = ? WHERE id = ?');
        $upd->execute([$newFailed, $user['id']]);
    }
    $fail();
}

// ---- success ----------------------------------------------------------------
$recordAttempt(true);

$token = bin2hex(random_bytes(32));
$tokenHash = hash('sha256', $token);
$absoluteMin = $CFG['session']['absolute_ttl_min'] ?? 720;
$expiresAt = date('Y-m-d H:i:s', time() + $absoluteMin * 60);

$pdo->prepare('UPDATE auth_users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?')
    ->execute([$user['id']]);

$ins = $pdo->prepare(
    'INSERT INTO auth_sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)'
);
$ins->execute([
    $tokenHash, $user['id'], $expiresAt, $ip,
    substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
]);

audit($pdo, $user['id'], $username, 'Signed in', []);

$cookieName = auth_cookie_name($CFG);
setcookie($cookieName, $token, [
    'expires'  => time() + $absoluteMin * 60,
    'path'     => '/',
    'secure'   => true,
    'httponly' => true,
    'samesite' => 'Strict',
]);

$permissions = permissions_for_role($pdo, $user['role']);
$csrf = csrf_token_for($CFG, $tokenHash);

$graceHours = $CFG['offline_grace_hours'] ?? 12;
$ticketPayload = [
    'uid'   => $user['id'],
    'role'  => $user['role'],
    'perms' => $permissions,
    'exp'   => time() + $graceHours * 3600,
];
$offlineTicket = make_offline_ticket($CFG, $ticketPayload);

json_out([
    'user' => [
        'id'          => $user['id'],
        'username'    => $user['username'],
        'displayName' => $user['display_name'],
    ],
    'role'               => $user['role'],
    'permissions'        => $permissions,
    'mustChangePassword' => (bool)$user['must_change_password'],
    'csrf'               => $csrf,
    'offlineTicket'      => $offlineTicket,
    'expiresAt'          => $expiresAt,
]);
