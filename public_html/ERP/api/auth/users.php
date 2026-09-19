<?php
/**
 * GET  /api/auth/users.php               -> list accounts (any signed-in user)
 * POST /api/auth/users.php {action:...}  -> create / update / archive / restore
 *      Requires the OWNER role — mirrors erp-upgrade/22-users.js's own rule
 *      that only an owner may create accounts or change a role.
 *
 * Actions: "create", "update", "archive", "restore", "reset_password"
 */
declare(strict_types=1);
require __DIR__ . '/../_bootstrap.php';
require __DIR__ . '/../_session.php';

const VALID_ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'SALES', 'INVENTORY'];

function row_out(array $u): array {
    return [
        'id'          => $u['id'],
        'username'    => $u['username'],
        'displayName' => $u['display_name'],
        'role'        => $u['role'],
        'phone'       => $u['phone'],
        'isActive'    => (bool)$u['is_active'],
        'lastLoginAt' => $u['last_login_at'],
        'createdAt'   => $u['created_at'],
    ];
}

function count_active_owners(PDO $pdo, ?string $excludeId = null): int {
    $sql = "SELECT COUNT(*) FROM auth_users WHERE role = 'OWNER' AND is_active = 1";
    $params = [];
    if ($excludeId) { $sql .= ' AND id != ?'; $params[] = $excludeId; }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return (int)$stmt->fetchColumn();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $session = require_login($pdo, $CFG);
    $rows = $pdo->query('SELECT * FROM auth_users ORDER BY created_at ASC')->fetchAll();
    json_out(['users' => array_map('row_out', $rows)]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed.', 405);

$session = require_login($pdo, $CFG);
$sessionHash = hash('sha256', $_COOKIE[auth_cookie_name($CFG)] ?? '');
require_csrf($pdo, $CFG, $sessionHash);

if ($session['role'] !== 'OWNER') {
    json_error('Only the owner can manage accounts.', 403);
}

$body = json_body();
$action = (string)($body['action'] ?? '');

switch ($action) {
    case 'create': {
        $username = trim((string)($body['username'] ?? ''));
        $displayName = trim((string)($body['displayName'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $role = (string)($body['role'] ?? 'SALES');
        $phone = trim((string)($body['phone'] ?? ''));

        $errors = [];
        if ($username === '' || !preg_match('/^[a-zA-Z0-9_.\-]{3,64}$/', $username)) {
            $errors[] = 'Username must be 3-64 characters (letters, numbers, . _ -).';
        }
        if ($displayName === '') $errors[] = 'Enter a name.';
        if (strlen($password) < 8) $errors[] = 'Password must be at least 8 characters.';
        if (!in_array($role, VALID_ROLES, true)) $errors[] = 'That is not a role.';
        if ($errors) json_out(['validation' => $errors], 422);

        $dup = $pdo->prepare('SELECT 1 FROM auth_users WHERE username = ? LIMIT 1');
        $dup->execute([$username]);
        if ($dup->fetchColumn()) json_out(['validation' => ['That username is taken.']], 422);

        $id = new_id('usr');
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $ins = $pdo->prepare(
            'INSERT INTO auth_users (id, username, display_name, password_hash, role, phone, created_by, must_change_password)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
        );
        $ins->execute([$id, $username, $displayName, $hash, $role, $phone ?: null, $session['display_name']]);

        audit($pdo, $session['uid'], $session['username'], 'Account created', ['newUserId' => $id, 'username' => $username, 'role' => $role]);
        json_out(['user' => row_out(['id' => $id, 'username' => $username, 'display_name' => $displayName,
            'role' => $role, 'phone' => $phone, 'is_active' => 1, 'last_login_at' => null, 'created_at' => date('Y-m-d H:i:s')])]);
    }

    case 'update': {
        $id = (string)($body['id'] ?? '');
        $stmt = $pdo->prepare('SELECT * FROM auth_users WHERE id = ?');
        $stmt->execute([$id]);
        $existing = $stmt->fetch();
        if (!$existing) json_error('That account no longer exists.', 404);

        $displayName = array_key_exists('displayName', $body) ? trim((string)$body['displayName']) : $existing['display_name'];
        $role = array_key_exists('role', $body) ? (string)$body['role'] : $existing['role'];
        $phone = array_key_exists('phone', $body) ? trim((string)$body['phone']) : $existing['phone'];

        $errors = [];
        if ($displayName === '') $errors[] = 'Enter a name.';
        if (!in_array($role, VALID_ROLES, true)) $errors[] = 'That is not a role.';
        if ($existing['role'] === 'OWNER' && $role !== 'OWNER' && count_active_owners($pdo, $id) === 0) {
            $errors[] = 'This is the only owner account — make someone else an owner first.';
        }
        if ($errors) json_out(['validation' => $errors], 422);

        $upd = $pdo->prepare('UPDATE auth_users SET display_name = ?, role = ?, phone = ? WHERE id = ?');
        $upd->execute([$displayName, $role, $phone ?: null, $id]);

        if (!empty($body['password'])) {
            if (strlen((string)$body['password']) < 8) {
                json_out(['validation' => ['Password must be at least 8 characters.']], 422);
            }
            $pdo->prepare('UPDATE auth_users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
                ->execute([password_hash((string)$body['password'], PASSWORD_DEFAULT), $id]);
        }

        audit($pdo, $session['uid'], $session['username'], 'Account updated', [
            'targetUserId' => $id, 'oldRole' => $existing['role'], 'newRole' => $role,
        ]);
        json_out(['ok' => true]);
    }

    case 'archive': {
        $id = (string)($body['id'] ?? '');
        $stmt = $pdo->prepare('SELECT * FROM auth_users WHERE id = ?');
        $stmt->execute([$id]);
        $existing = $stmt->fetch();
        if (!$existing) json_error('That account no longer exists.', 404);

        if ($existing['role'] === 'OWNER' && count_active_owners($pdo, $id) === 0) {
            json_out(['validation' => ['This is the only owner account — it cannot be switched off.']], 422);
        }
        if ($session['uid'] === $id) {
            json_out(['validation' => ['You are signed in as this person. Switch user first.']], 422);
        }

        $pdo->prepare('UPDATE auth_users SET is_active = 0, archived_at = NOW() WHERE id = ?')->execute([$id]);
        $pdo->prepare('UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL')->execute([$id]);
        audit($pdo, $session['uid'], $session['username'], 'Account switched off', ['targetUserId' => $id]);
        json_out(['ok' => true]);
    }

    case 'restore': {
        $id = (string)($body['id'] ?? '');
        $pdo->prepare('UPDATE auth_users SET is_active = 1, archived_at = NULL WHERE id = ?')->execute([$id]);
        audit($pdo, $session['uid'], $session['username'], 'Account switched on', ['targetUserId' => $id]);
        json_out(['ok' => true]);
    }

    case 'reset_password': {
        $id = (string)($body['id'] ?? '');
        $password = (string)($body['password'] ?? '');
        if (strlen($password) < 8) json_out(['validation' => ['Password must be at least 8 characters.']], 422);
        $pdo->prepare('UPDATE auth_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $id]);
        audit($pdo, $session['uid'], $session['username'], 'Password reset by owner', ['targetUserId' => $id]);
        json_out(['ok' => true]);
    }

    default:
        json_error('Unknown action.', 400);
}
