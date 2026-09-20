<?php
/**
 * empty-business-db.php — empty the 46 business tables so a fresh backup can be imported (cutover step).
 *
 *   php empty-business-db.php                        report only: row counts, and what would happen (changes nothing)
 *   php empty-business-db.php --export-only         also write the safety export below, verified; still deletes nothing
 *   php empty-business-db.php --rehearse             export, then delete INSIDE a transaction, prove it emptied, ROLL BACK
 *   php empty-business-db.php --yes-empty-everything export (verified) and then really delete
 *   [--config=/path/erp-config.php] [--manifest=/path/stores.json] [--out-dir=/path]
 *
 * CLI only. It cannot lose data by accident:
 *  1. It refuses to run while 'data_backend' => 'server' (people would be using the database): switch off first.
 *  2. Before ANY delete it writes the complete current contents to a backup file in the same format as the
 *     app's own "Backup Database" (restorable with import-backup.php), re-reads it and checks every store's
 *     count and that it is valid JSON. A failed export stops everything.
 *  3. The deletes run in ONE transaction that only commits after every table is proven empty.
 *  4. It never prints the database password. The export is written mode 0400.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ini_set('memory_limit', '2G'); ini_set('serialize_precision', '-1');
function fail(string $m, int $code = 2): void { fwrite(STDERR, "\nERROR: $m\n"); exit($code); }
function say(string $m = ''): void { echo $m . "\n"; }

$mode = 'report'; $configPath = null; $manifestPath = null; $outDir = null;
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--export-only') $mode = 'export';
    elseif ($a === '--rehearse') $mode = 'rehearse';
    elseif ($a === '--yes-empty-everything') $mode = 'empty';
    elseif (strpos($a, '--config=') === 0) $configPath = substr($a, 9);
    elseif (strpos($a, '--manifest=') === 0) $manifestPath = substr($a, 11);
    elseif (strpos($a, '--out-dir=') === 0) $outDir = substr($a, 10);
    else fail("unknown option $a");
}
$first = fn(array $c) => array_values(array_filter($c, 'is_file'))[0] ?? null;
$configPath = $configPath ?: $first(['/home/u943531942/domains/farooqandcotraders.online/private/erp-config.php', __DIR__ . '/../private/erp-config.php']);
$manifestPath = $manifestPath ?: $first([__DIR__ . '/stores.json', __DIR__ . '/../public_html/ERP/database/stores.json',
    '/home/u943531942/domains/farooqandcotraders.online/public_html/ERP/database/stores.json']);
if (!$configPath || !$manifestPath) fail('erp-config.php or stores.json not found (use --config= / --manifest=)');
$outDir = $outDir ?: (is_dir('/home/u943531942/backups') ? '/home/u943531942/backups' : sys_get_temp_dir());

$cfg = require $configPath;
$manifest = json_decode(file_get_contents($manifestPath), true);
if (($cfg['data_backend'] ?? 'browser') === 'server') fail("'data_backend' is 'server' — people may be using the database. Run scripts/data-backend.sh off first.");
$b = $cfg['biz_db'] ?? null; if (!$b) fail('no biz_db block in the config');
try {
    $pdo = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $b['host'], $b['port'], $b['name'], $b['charset'] ?? 'utf8mb4'),
        $b['user'], $b['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (PDOException $e) { fail('cannot connect to the business database: ' . $e->getMessage()); }
say('Database : ' . $b['name'] . ' @ ' . $b['host']); say("Mode     : $mode"); say();

$counts = []; $total = 0;
foreach ($manifest as $store => $def) { $counts[$store] = (int)$pdo->query('SELECT COUNT(*) FROM `' . $def['table'] . '`')->fetchColumn(); $total += $counts[$store]; }
foreach ($counts as $s => $n) if ($n) say(sprintf('  %-22s %6d rows', $s, $n));
say("  " . str_repeat('-', 34)); say(sprintf('  %-22s %6d rows', 'TOTAL', $total)); say();
if ($mode === 'report') { say($total ? 'Report only — nothing was changed. Use --export-only, --rehearse or --yes-empty-everything.' : 'The database is already empty.'); exit(0); }
if ($total === 0) { say('Already empty — nothing to export or delete.'); exit(0); }

/* ── 2. the safety export, in the app's own backup format, verified ─────────────────────────────────── */
$ts = date('Ymd-His');
$file = rtrim($outDir, '/') . "/business-db-before-empty-$ts-" . bin2hex(random_bytes(3)) . '.json';   // never collides with an earlier (read-only) export
$parts = [];
foreach ($manifest as $store => $def) {
    $rows = [];
    $st = $pdo->query('SELECT doc FROM `' . $def['table'] . '` ORDER BY pk');
    while ($r = $st->fetch()) $rows[] = $r['doc'];                       // stored text spliced in as-is: never re-encoded
    $parts[] = json_encode($store) . ':[' . implode(',', $rows) . ']';
}
$json = '{"format":"farooq-co-erp-backup","formatVersion":1,"appVersion":"export-before-empty","exportedAt":' . json_encode(gmdate('Y-m-d\TH:i:s.000\Z')) .
    ',"driver":"server","counts":' . json_encode($counts) . ',"data":{' . implode(',', $parts) . '}}';
unset($parts);
if (file_put_contents($file, $json) === false) fail("cannot write the safety export to $file — nothing was deleted");
chmod($file, 0400);
$chk = json_decode(file_get_contents($file), false, 4096);
if (!$chk || ($chk->format ?? '') !== 'farooq-co-erp-backup') fail("the safety export did not read back as valid JSON — nothing was deleted (file kept: $file)", 1);
foreach ($manifest as $store => $_) if (count($chk->data->$store ?? []) !== $counts[$store]) fail("the safety export holds a different number of $store than the database — nothing was deleted (file kept: $file)", 1);
unset($chk, $json);
say("Safety export written and verified: $file");
say('  SHA-256 ' . hash_file('sha256', $file) . '  (' . number_format(filesize($file)) . ' bytes, mode 0400)');
say('  Restore with: php import-backup.php <that file> --commit   (into an emptied database)');
say();
if ($mode === 'export') { say('Export only — nothing was deleted.'); exit(0); }

/* ── 3. delete, all-or-nothing ───────────────────────────────────────────────────────────────────────── */
$pdo->exec('SET SESSION innodb_lock_wait_timeout = 30');
$pdo->beginTransaction();
try {
    foreach ($manifest as $store => $def) $pdo->exec('DELETE FROM `' . $def['table'] . '`');
    $left = 0; foreach ($manifest as $store => $def) $left += (int)$pdo->query('SELECT COUNT(*) FROM `' . $def['table'] . '`')->fetchColumn();
    if ($left !== 0) throw new RuntimeException("$left rows are still there after the deletes");
    if ($mode === 'rehearse') {
        $pdo->rollBack();
        $after = 0; foreach ($manifest as $store => $def) $after += (int)$pdo->query('SELECT COUNT(*) FROM `' . $def['table'] . '`')->fetchColumn();
        say("REHEARSAL: every table was emptied inside the transaction, then ROLLED BACK. Rows now: $after (was $total).");
        exit($after === $total ? 0 : 1);
    }
    $pdo->exec('UPDATE data_version SET v = v + 1 WHERE id = 1');
    $pdo->commit();
} catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); fail('delete failed and was rolled back — the database is unchanged: ' . $e->getMessage(), 1); }
say("EMPTIED. All $total rows were deleted (the safety export above holds them all). Import the fresh backup next:");
say('  php import-backup.php <fresh backup>.json            # dry run first');
