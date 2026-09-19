<?php
/**
 * Farooq & Co Traders ERP — API bootstrap.
 * Included first by every endpoint. Sets up strict error handling, loads
 * config from outside the webroot, opens the PDO connection, and provides
 * small JSON helpers every endpoint uses.
 */
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');   // never leak stack traces to a client
ini_set('log_errors', '1');

// This file lives at public_html/ERP/api/_bootstrap.php. The config lives at
// .../<domain>/private/erp-config.php — two levels above public_html/ERP,
// one level above public_html.
$CONFIG_PATH = dirname(__DIR__, 3) . '/private/erp-config.php';
if (!is_file($CONFIG_PATH)) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Server is not configured yet.']);
    exit;
}
/** @var array $CFG */
$CFG = require $CONFIG_PATH;

function json_out(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(string $message, int $status = 400): never {
    json_out(['error' => $message], $status);
}

function json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function client_ip(): string {
    // Shared hosting behind Hostinger's CDN — trust X-Forwarded-For's first
    // hop only for logging/rate-limiting purposes, never for auth decisions.
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($xff !== '') {
        $parts = explode(',', $xff);
        return trim($parts[0]);
    }
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function new_id(string $prefix): string {
    // 26 chars total incl. prefix+underscore, time-ordered enough for our needs.
    return $prefix . '_' . bin2hex(random_bytes(11));
}

try {
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $CFG['db']['host'], $CFG['db']['port'], $CFG['db']['name'], $CFG['db']['charset']
    );
    $pdo = new PDO($dsn, $CFG['db']['user'], $CFG['db']['pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (Throwable $e) {
    error_log('[erp-api] DB connect failed: ' . $e->getMessage());
    json_error('Could not reach the database.', 503);
}
