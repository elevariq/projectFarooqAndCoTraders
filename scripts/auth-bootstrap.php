<?php
/**
 * Farooq & Co Traders ERP — one-time first-account bootstrap.
 *
 * Run over SSH only, never web-reachable (lives outside public_html and this
 * script also self-checks that it's running under the CLI SAPI):
 *   php scripts/auth-bootstrap.php <username> <display name> <role>
 * then it prompts for a password (not passed as an argv so it doesn't end up
 * in shell history / process listing).
 *
 * Refuses to run if any auth_users row already exists, so it can only ever
 * create the very first account. Use api/auth/users.php (as that owner)
 * for every account after that.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This script only runs from the command line.\n");
}

if ($argc < 4) {
    fwrite(STDERR, "Usage: php auth-bootstrap.php <username> <display name> <role>\n");
    fwrite(STDERR, "Roles: OWNER, MANAGER, ACCOUNTANT, SALES, INVENTORY\n");
    exit(1);
}

[$script, $username, $displayName, $role] = $argv;
$validRoles = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'SALES', 'INVENTORY'];
if (!in_array($role, $validRoles, true)) {
    fwrite(STDERR, "Role must be one of: " . implode(', ', $validRoles) . "\n");
    exit(1);
}
if (!preg_match('/^[a-zA-Z0-9_.\-]{3,64}$/', $username)) {
    fwrite(STDERR, "Username must be 3-64 chars: letters, numbers, . _ -\n");
    exit(1);
}

// Same config path convention as api/_bootstrap.php: this script lives at
// <repo-root>/scripts/, and on the live server the equivalent path is
// <domain>/private/erp-config.php — one level above public_html.
$configPath = getenv('ERP_CONFIG_PATH') ?: (dirname(__DIR__) . '/private/erp-config.php');
if (!is_file($configPath)) {
    fwrite(STDERR, "Config not found at $configPath (set ERP_CONFIG_PATH to override)\n");
    exit(1);
}
$CFG = require $configPath;

$dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s',
    $CFG['db']['host'], $CFG['db']['port'], $CFG['db']['name'], $CFG['db']['charset']);
$pdo = new PDO($dsn, $CFG['db']['user'], $CFG['db']['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$existing = (int)$pdo->query('SELECT COUNT(*) FROM auth_users')->fetchColumn();
if ($existing > 0) {
    fwrite(STDERR, "Refusing: auth_users already has $existing account(s). " .
        "Use api/auth/users.php as an existing owner to add more.\n");
    exit(1);
}

// system()/exec() are disabled on this host (shared-hosting disable_functions),
// so echo cannot be suppressed here. Pipe the password in over stdin instead
// of typing it at a visible prompt: printf '%s\n' 'the-password' | php ...
fwrite(STDOUT, "Reading password from stdin...\n");
$password = trim((string)fgets(STDIN));

if (strlen($password) < 8) {
    fwrite(STDERR, "Password must be at least 8 characters.\n");
    exit(1);
}

$id = 'usr_' . bin2hex(random_bytes(11));
$hash = password_hash($password, PASSWORD_DEFAULT);

$stmt = $pdo->prepare(
    'INSERT INTO auth_users (id, username, display_name, password_hash, role, created_by, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, 0)'
);
$stmt->execute([$id, $username, $displayName, $hash, $role, 'bootstrap script']);

$audit = $pdo->prepare(
    'INSERT INTO auth_audit (user_id, username, action, detail) VALUES (?, ?, ?, ?)'
);
$audit->execute([$id, $username, 'First account bootstrapped', json_encode(['role' => $role])]);

fwrite(STDOUT, "Created $role account '$username' (id $id).\n");
