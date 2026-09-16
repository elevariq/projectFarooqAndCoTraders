<?php
/**
 * Farooq & Co Traders ERP — session, CSRF and permission helpers.
 * Requires _bootstrap.php ($pdo, $CFG) to already be loaded.
 */
declare(strict_types=1);

/**
 * Roles that implicitly have every permission, mirroring
 * erp-upgrade/19-collection-rbac.js's `if (r.all) return true;`.
 */
const AUTH_ALL_PERMS_ROLE = 'OWNER';

function auth_cookie_name(array $CFG): string {
    return $CFG['session']['cookie_name'] ?? '__Host-fcsid';
}

/** Look up the current session from the cookie. Returns null if absent/expired/revoked. */
function current_session(PDO $pdo, array $CFG): ?array {
    $name = auth_cookie_name($CFG);
    $token = $_COOKIE[$name] ?? '';
    if ($token === '') return null;

    $hash = hash('sha256', $token);
    $stmt = $pdo->prepare(
        'SELECT s.*, u.id AS uid, u.username, u.display_name, u.role, u.is_active,
                u.must_change_password
         FROM auth_sessions s
         JOIN auth_users u ON u.id = s.user_id
         WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > NOW()
         LIMIT 1'
    );
    $stmt->execute([$hash]);
    $row = $stmt->fetch();
    if (!$row) return null;
    if ((int)$row['is_active'] !== 1) return null;

    $idleMinutes = $CFG['session']['idle_ttl_min'] ?? 120;
    $lastSeen = strtotime($row['last_seen_at']);
    if ($lastSeen !== false && (time() - $lastSeen) > $idleMinutes * 60) {
        // idle timeout — revoke rather than silently extend
        $upd = $pdo->prepare('UPDATE auth_sessions SET revoked_at = NOW() WHERE id = ?');
        $upd->execute([$hash]);
        return null;
    }

    // touch last_seen_at (cheap, once per request)
    $touch = $pdo->prepare('UPDATE auth_sessions SET last_seen_at = NOW() WHERE id = ?');
    $touch->execute([$hash]);

    return $row;
}

function require_login(PDO $pdo, array $CFG): array {
    $session = current_session($pdo, $CFG);
    if (!$session) json_error('Not signed in.', 401);
    return $session;
}

/** Load the effective permission set for a role. OWNER = null means "all". */
function permissions_for_role(PDO $pdo, string $role): array {
    if ($role === AUTH_ALL_PERMS_ROLE) return ['*'];
    $stmt = $pdo->prepare('SELECT permission FROM auth_role_permissions WHERE role = ?');
    $stmt->execute([$role]);
    return array_map(fn($r) => $r['permission'], $stmt->fetchAll());
}

function role_can(PDO $pdo, string $role, string $perm): bool {
    if ($role === AUTH_ALL_PERMS_ROLE) return true;
    $stmt = $pdo->prepare(
        'SELECT 1 FROM auth_role_permissions WHERE role = ? AND permission = ? LIMIT 1'
    );
    $stmt->execute([$role, $perm]);
    return (bool)$stmt->fetchColumn();
}

/** Require the current session's role to hold $perm, else 403. */
function require_perm(PDO $pdo, array $CFG, string $perm): array {
    $session = require_login($pdo, $CFG);
    if (!role_can($pdo, $session['role'], $perm)) {
        json_error('You do not have permission to do that.', 403);
    }
    return $session;
}

/**
 * CSRF: a random token is embedded in the login response and must be echoed
 * back in an X-CSRF-Token header on every state-changing call. Because the
 * cookie is SameSite=Strict this is defense in depth, not the only barrier.
 */
function require_csrf(PDO $pdo, array $CFG, string $sessionHash): void {
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $expected = hash('sha256', $sessionHash . '|' . $CFG['ticket_secret']);
    if ($sent === '' || !hash_equals($expected, $sent)) {
        json_error('Request could not be verified (missing or stale CSRF token).', 419);
    }
}

function csrf_token_for(array $CFG, string $sessionHash): string {
    return hash('sha256', $sessionHash . '|' . $CFG['ticket_secret']);
}

function audit(PDO $pdo, ?string $userId, ?string $username, string $action, array $detail = []): void {
    $stmt = $pdo->prepare(
        'INSERT INTO auth_audit (user_id, username, action, detail, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $userId, $username, $action,
        $detail ? json_encode($detail, JSON_UNESCAPED_SLASHES) : null,
        client_ip(),
        substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
    ]);
}

/** Build the offline grace-period ticket: header.payload.signature (base64url, HMAC-SHA256). */
function make_offline_ticket(array $CFG, array $payload): string {
    $json = json_encode($payload, JSON_UNESCAPED_SLASHES);
    $b64 = rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    $sig = hash_hmac('sha256', $b64, $CFG['ticket_secret']);
    return $b64 . '.' . $sig;
}
