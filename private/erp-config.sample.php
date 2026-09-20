<?php
/**
 * Farooq & Co Traders ERP — server config template.
 *
 * Copy this to erp-config.php (same directory, gitignored) and fill in real
 * values. erp-config.php lives OUTSIDE public_html entirely — it is never
 * web-reachable — and is never committed.
 *
 * On the live server this file belongs at:
 *   /home/u943531942/domains/farooqandcotraders.online/private/erp-config.php
 */

return [
    // LOGINS ONLY — accounts, sessions, roles, audit (schema: database/auth-schema.sql).
    'db' => [
        'host'    => 'srv1774.hstgr.io',
        'port'    => 3306,
        'name'    => 'u943531942_erpauth',
        'user'    => 'u943531942_erpauth',
        'pass'    => 'REPLACE_ME',
        'charset' => 'utf8mb4',
    ],

    // BUSINESS DATA — invoices, customers, stock, ledgers… the server-side replacement for the
    // browser's IndexedDB (schema: database/schema-mariadb.sql, 46 tables). A separate database
    // from 'db' above. The same password is also in the dbhub MCP DSN in ~/.claude.json — see
    // docs/OPERATIONS.md -> "Business database credentials" before changing it.
    'biz_db' => [
        'host'    => 'srv1774.hstgr.io',
        'port'    => 3306,
        'name'    => 'u943531942_facotraders',
        'user'    => 'u943531942_facotraders',
        'pass'    => 'REPLACE_ME',
        'charset' => 'utf8mb4',
    ],

    // Used to sign the offline grace-period ticket (HMAC-SHA256). Generate
    // with: php -r "echo bin2hex(random_bytes(32));"
    'ticket_secret' => 'REPLACE_ME_WITH_64_HEX_CHARS',

    // Session cookie name and lifetime policy.
    'session' => [
        'cookie_name'      => '__Host-fcsid',
        'absolute_ttl_min' => 12 * 60,   // 12 hours
        'idle_ttl_min'     => 2 * 60,    // 2 hours
    ],

    // Phase 3 login gate — THE KILL-SWITCH. Leave this out (or false) and the
    // ERP app files are served to anyone, exactly as before Phase 3. Set it to
    // the boolean true and api/gate.php only serves them to a signed-in
    // session. Only a real `true` enforces ("yes" or 1 do not — a typo can't
    // lock anyone out). Read on every request, so flipping it takes effect at
    // once with no redeploy: it is also the emergency "let everyone back in".
    // 'enforce_login' => true,

    // Offline grace period after a successful online login (see docs/OPERATIONS.md).
    'offline_grace_hours' => 12,

    // Lockout policy.
    'lockout' => [
        'max_attempts'   => 5,
        'window_minutes' => 15,
        'lock_minutes'   => 15,
    ],
];
