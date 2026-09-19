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
    'db' => [
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

    // Offline grace period after a successful online login (see docs/OPERATIONS.md).
    'offline_grace_hours' => 12,

    // Lockout policy.
    'lockout' => [
        'max_attempts'   => 5,
        'window_minutes' => 15,
        'lock_minutes'   => 15,
    ],
];
