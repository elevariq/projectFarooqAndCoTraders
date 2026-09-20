<?php
/**
 * backup-business-db.php — a verified, point-in-time backup of the business database, in the app's own
 * "Backup Database" format (restore with scripts/import-backup.php into an emptied database).
 *
 *   php backup-business-db.php [--out-dir=/home/u943531942/backups/nightly] [--keep-days=30] [--min-keep=7]
 *                              [--config=/path/erp-config.php] [--stores=/path/_stores.php]
 *
 * Run nightly by a Hostinger cron job (see docs/SERVER_DATA.md). CLI only. Read-only on the database.
 *
 *  - CONSISTENT: all 46 tables are read inside ONE REPEATABLE-READ snapshot transaction, so the file is the
 *    database as it was at a single instant even if someone saves while it runs (a table-by-table dump would not be).
 *  - VERIFIED before it is kept: written to a .tmp file, read back, must be valid JSON with every store's count equal to
 *    the snapshot's. Only then is it renamed to its final name (mode 0400). A failed run leaves earlier backups alone.
 *  - NEVER "backs up" an empty database: if there are no products it stops with an error, so a wiped database can't
 *    quietly become the newest "backup" and push real ones out of the retention window.
 *  - PRUNING happens only after a successful, verified backup, only touches this folder's business-*.json files, removes
 *    only files older than --keep-days, and ALWAYS keeps the newest --min-keep files whatever their age.
 *  - Appends one line to backup.log (time, file, rows, bytes, sha256, seconds, pruned). Never prints the DB password.
 * Exit codes: 0 ok · 1 backup failed or was refused (nothing pruned) · 2 bad usage / cannot start.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ini_set('memory_limit', '2G'); ini_set('serialize_precision', '-1');
date_default_timezone_set('UTC');

function out(string $m): void { echo $m . "\n"; }
function bail(string $m, int $code, ?string $log = null): void {
    fwrite(STDERR, "ERROR: $m\n");
    if ($log) @file_put_contents($log, gmdate('c') . " FAILED  $m\n", FILE_APPEND);
    exit($code);
}

$outDir = null; $keepDays = 30; $minKeep = 7; $configPath = null; $storesPath = null;
foreach (array_slice($argv, 1) as $a) {
    if (strpos($a, '--out-dir=') === 0) $outDir = substr($a, 10);
    elseif (strpos($a, '--keep-days=') === 0) $keepDays = (int)substr($a, 12);
    elseif (strpos($a, '--min-keep=') === 0) $minKeep = (int)substr($a, 11);
    elseif (strpos($a, '--config=') === 0) $configPath = substr($a, 9);
    elseif (strpos($a, '--stores=') === 0) $storesPath = substr($a, 9);
    else bail("unknown option $a", 2);
}
if ($keepDays < 1 || $minKeep < 1) bail('--keep-days and --min-keep must be at least 1', 2);
$first = fn(array $c) => array_values(array_filter($c, 'is_file'))[0] ?? null;
$configPath = $configPath ?: $first(['/home/u943531942/domains/farooqandcotraders.online/private/erp-config.php', __DIR__ . '/../private/erp-config.php']);
$storesPath = $storesPath ?: $first(['/home/u943531942/domains/farooqandcotraders.online/public_html/ERP/api/_stores.php', __DIR__ . '/../public_html/ERP/api/_stores.php']);
if (!$configPath || !$storesPath) bail('erp-config.php or api/_stores.php not found (use --config= / --stores=)', 2);
$outDir = rtrim($outDir ?: '/home/u943531942/backups/nightly', '/');
if (!is_dir($outDir) && !@mkdir($outDir, 0700, true)) bail("cannot create $outDir", 2);
@chmod($outDir, 0700);
$log = $outDir . '/backup.log';

$manifest = require $storesPath;                       // store => [table, pk]  (generated; deployed with the API)
$cfg = require $configPath; $b = $cfg['biz_db'] ?? null;
if (!is_array($manifest) || !$b) bail('bad manifest or no biz_db block', 2, $log);
$t0 = microtime(true);
try {
    $pdo = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $b['host'], $b['port'], $b['name'], $b['charset'] ?? 'utf8mb4'),
        $b['user'], $b['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (PDOException $e) { bail('cannot connect to the business database: ' . $e->getMessage(), 1, $log); }

/* ── one consistent snapshot of every table ─────────────────────────────────────────────────────── */
$counts = []; $parts = []; $total = 0; $version = 0;
try {
    $pdo->exec('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    $pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    $v = $pdo->query('SELECT v FROM data_version WHERE id = 1')->fetchColumn(); $version = $v === false ? 0 : (int)$v;
    foreach ($manifest as $store => $def) {
        $rows = [];
        $st = $pdo->query('SELECT doc FROM `' . $def['table'] . '` ORDER BY pk');
        while ($r = $st->fetch()) $rows[] = $r['doc'];               // the stored text, spliced in as-is: never decoded and re-encoded
        $counts[$store] = count($rows); $total += count($rows);
        $parts[] = json_encode($store) . ':[' . implode(',', $rows) . ']';
    }
    $pdo->exec('COMMIT');
} catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->exec('ROLLBACK'); bail('reading the database failed: ' . $e->getMessage(), 1, $log); }
if (($counts['products'] ?? 0) === 0) bail('the database has no products — refusing to store an empty database as a backup (nothing pruned)', 1, $log);

$json = '{"format":"farooq-co-erp-backup","formatVersion":1,"appVersion":"nightly-backup","exportedAt":' . json_encode(gmdate('Y-m-d\TH:i:s.000\Z')) .
        ',"driver":"server","serverVersion":' . $version . ',"counts":' . json_encode($counts) . ',"data":{' . implode(',', $parts) . '}}';
unset($parts);

/* ── write to .tmp, read it back, only then keep it ─────────────────────────────────────────────── */
$final = $outDir . '/business-' . gmdate('Ymd-His') . '-v' . $version . '-' . bin2hex(random_bytes(2)) . '.json';   // unique even if run twice in one second
$tmp = $final . '.tmp';
if (file_exists($final)) bail("$final already exists", 1, $log);
if (file_put_contents($tmp, $json) === false) bail("cannot write $tmp (disk full?)", 1, $log);
unset($json);
$chk = json_decode(file_get_contents($tmp), false, 4096);
$ok = $chk && ($chk->format ?? '') === 'farooq-co-erp-backup';
if ($ok) foreach ($manifest as $store => $_) if (count($chk->data->$store ?? []) !== $counts[$store]) { $ok = false; break; }
unset($chk);
if (!$ok) { @unlink($tmp); bail('the backup did not verify when read back — discarded, earlier backups untouched', 1, $log); }
chmod($tmp, 0400);
if (!rename($tmp, $final)) { @unlink($tmp); bail("cannot rename $tmp into place", 1, $log); }
$sha = hash_file('sha256', $final); $bytes = filesize($final);

/* ── retention: only after success, only this folder's backups, never below --min-keep ───────────── */
$files = glob($outDir . '/business-*.json') ?: [];
usort($files, fn($x, $y) => strcmp(basename($y), basename($x)));          // newest first (names sort by timestamp)
$pruned = 0; $cut = time() - $keepDays * 86400;
foreach ($files as $i => $f) {
    if ($i < $minKeep || $f === $final) continue;
    if (filemtime($f) < $cut && @unlink($f)) $pruned++;
}
$secs = round(microtime(true) - $t0, 2);
$line = sprintf('%s OK      %s rows=%d bytes=%d sha256=%s v=%d secs=%s pruned=%d kept=%d', gmdate('c'), basename($final), $total, $bytes, $sha, $version, $secs, $pruned, count(glob($outDir . '/business-*.json') ?: []));
file_put_contents($log, $line . "\n", FILE_APPEND);
out("Backup written and verified: $final");
out("  $total rows across " . count($manifest) . " stores · " . number_format($bytes) . " bytes · sha256 $sha");
out("  consistent snapshot at change-counter $version · $secs s · pruned $pruned old file(s)");
exit(0);
