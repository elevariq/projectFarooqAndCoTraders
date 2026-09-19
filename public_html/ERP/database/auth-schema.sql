-- Farooq & Co Traders ERP — server-side authentication & authorization schema
-- Added 2026-09-16 (auth project, Phase 1).
--
-- `auth_` prefix deliberately keeps this separate from whatever table names
-- the eventual IndexedDB -> MySQL business-data migration
-- (docs/MYSQL_MIGRATION_PLAN.md) ends up using, so the two efforts don't
-- collide on a name later.
--
-- Target: MariaDB 11.8 (u943531942_facotraders on srv1774.hstgr.io).
-- Applied via the dbhub MCP execute_sql tool; this file is the source of
-- truth for what should exist — re-run is safe (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS auth_users (
  id                    CHAR(26)      NOT NULL PRIMARY KEY,       -- e.g. 'usr_' + ULID-ish
  username              VARCHAR(64)   NOT NULL,
  display_name          VARCHAR(120)  NOT NULL,
  password_hash         VARCHAR(255)  NOT NULL,                   -- bcrypt via password_hash()
  role                  VARCHAR(32)   NOT NULL,                   -- OWNER / MANAGER / ACCOUNTANT / SALES / INVENTORY
  phone                 VARCHAR(32)   NULL,
  is_active             TINYINT(1)    NOT NULL DEFAULT 1,
  must_change_password  TINYINT(1)    NOT NULL DEFAULT 0,
  failed_attempts       INT           NOT NULL DEFAULT 0,
  locked_until          DATETIME      NULL,
  last_login_at         DATETIME      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by            VARCHAR(120)  NULL,
  archived_at           DATETIME      NULL,
  UNIQUE KEY uk_auth_users_username (username),
  KEY ix_auth_users_role (role),
  KEY ix_auth_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id            CHAR(64)      NOT NULL PRIMARY KEY,   -- SHA-256 hex of the cookie token; the raw token is never stored
  user_id       CHAR(26)      NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME      NOT NULL,                -- absolute cap (12h)
  ip            VARCHAR(45)   NULL,
  user_agent    VARCHAR(255)  NULL,
  revoked_at    DATETIME      NULL,
  KEY ix_auth_sessions_user (user_id),
  KEY ix_auth_sessions_expires (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username    VARCHAR(64)   NOT NULL,
  ip          VARCHAR(45)   NOT NULL,
  ok          TINYINT(1)    NOT NULL,
  at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_attempts_username_at (username, at),
  KEY ix_attempts_ip_at (ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_role_permissions (
  role        VARCHAR(32)  NOT NULL,
  permission  VARCHAR(64)  NOT NULL,
  PRIMARY KEY (role, permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_audit (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id     CHAR(26)      NULL,
  username    VARCHAR(64)   NULL,
  action      VARCHAR(64)   NOT NULL,
  detail      JSON          NULL,
  ip          VARCHAR(45)   NULL,
  user_agent  VARCHAR(255)  NULL,
  KEY ix_audit_at (at),
  KEY ix_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: the same role -> permission map already in erp-upgrade/19-collection-rbac.js
-- (ROLES constant), so the server becomes the source of truth going forward.
-- OWNER is intentionally absent here — the API's require_perm() treats OWNER
-- as "all permissions" the same way RBAC.can() does client-side today.

INSERT IGNORE INTO auth_role_permissions (role, permission) VALUES
('MANAGER','MASTER_DATA_VIEW'), ('MANAGER','MASTER_DATA_CREATE'), ('MANAGER','MASTER_DATA_EDIT'),
('MANAGER','MASTER_DATA_ARCHIVE'), ('MANAGER','PRODUCT_EDIT'), ('MANAGER','SUPPLIER_EDIT'),
('MANAGER','CUSTOMER_EDIT'), ('MANAGER','SALES_CREATE'), ('MANAGER','PURCHASE_CREATE'),
('MANAGER','PAYMENT_CREATE'), ('MANAGER','COLLECTION_VIEW'), ('MANAGER','COLLECTION_EXPORT'),
('MANAGER','FINANCIAL_REPORT_VIEW'), ('MANAGER','PROFIT_VIEW'), ('MANAGER','TRANSACTION_CORRECT'),
('MANAGER','AUDIT_LOG_VIEW'), ('MANAGER','STOCK_MANAGE'),

('ACCOUNTANT','MASTER_DATA_VIEW'), ('ACCOUNTANT','CUSTOMER_EDIT'), ('ACCOUNTANT','PAYMENT_CREATE'),
('ACCOUNTANT','COLLECTION_VIEW'), ('ACCOUNTANT','COLLECTION_EXPORT'), ('ACCOUNTANT','FINANCIAL_REPORT_VIEW'),
('ACCOUNTANT','PROFIT_VIEW'), ('ACCOUNTANT','TRANSACTION_CORRECT'), ('ACCOUNTANT','AUDIT_LOG_VIEW'),

('SALES','MASTER_DATA_VIEW'), ('SALES','SALES_CREATE'), ('SALES','PAYMENT_CREATE'),
('SALES','COLLECTION_VIEW'), ('SALES','CUSTOMER_EDIT'),

('INVENTORY','MASTER_DATA_VIEW'), ('INVENTORY','STOCK_MANAGE');

-- NOTE (open item, flagged in the plan — do not silently resolve):
-- LANDED_COST_MANAGE, LANDED_COST_VIEW and EXPENSE_MANAGE are used in
-- erp-upgrade/27-landed-ui.js but appear in NO role's perms list client-side
-- today, so only OWNER effectively has them. Not seeded to any other role
-- here either, preserving current behavior. Ask the user whether Manager
-- and/or Accountant should get them before granting.
