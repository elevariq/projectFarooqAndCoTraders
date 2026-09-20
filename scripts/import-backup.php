<?php
/**
 * import-backup.php — load a Farooq & Co ERP "Backup Database" JSON into the server database.
 *
 *   php import-backup.php <backup.json> [--commit] [--allow-nonempty]
 *                         [--config=/path/erp-config.php] [--manifest=/path/stores.json]
 *
 * CLI only (refuses over HTTP). Run it over SSH on the server, like auth-bootstrap.php.
 *
 * SAFETY, in order of importance:
 *  1. The backup file is only ever READ. Its SHA-256 is printed before and after; a change aborts.
 *  2. DRY-RUN BY DEFAULT: everything happens inside ONE transaction that is rolled back unless you
 *     pass --commit AND every verification below passed. A dry run leaves the database untouched.
 *  3. Refuses to load into tables that already hold rows (--allow-nonempty overrides; a duplicate
 *     key then aborts and rolls back the whole thing).
 *  4. Refuses a backup that contains a store this schema has no table for (nothing is dropped
 *     silently), a record with no key, or a duplicate key.
 *  5. Verification before commit: (a) row counts per store; (b) EVERY record read back from the
 *     database and deep-compared with the file (objects vs arrays and numeric values are compared
 *     strictly, so {} never turns into []); (c) money/quantity totals recomputed by the database's own
 *     generated columns and compared with totals computed from the file.
 *  6. Never prints the database password.
 *
 * Exit codes: 0 ok (dry run or committed) · 1 verification failed / rolled back · 2 bad usage or input.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ini_set('memory_limit', '2G');
ini_set('serialize_precision', '-1');   // shortest round-trip float text — same numbers JavaScript writes
mb_internal_encoding('UTF-8');

function fail(string $m, int $code = 2): void { fwrite(STDERR, "\nERROR: $m\n"); exit($code); }
function say(string $m = ''): void { echo $m . "\n"; }

/* ── arguments ───────────────────────────────────────────────────────────── */
$file = null; $commit = false; $allowNonEmpty = false; $configPath = null; $manifestPath = null;
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--commit') $commit = true;
    elseif ($a === '--allow-nonempty') $allowNonEmpty = true;
    elseif (strpos($a, '--config=') === 0) $configPath = substr($a, 9);
    elseif (strpos($a, '--manifest=') === 0) $manifestPath = substr($a, 11);
    elseif ($a[0] === '-') fail("unknown option $a");
    elseif ($file === null) $file = $a;
    else fail('only one backup file at a time');
}
if ($file === null) fail("usage: php import-backup.php <backup.json> [--commit] [--allow-nonempty]");
if (!is_file($file) || !is_readable($file)) fail("cannot read $file");

$candidates = fn(array $c) => array_values(array_filter($c, 'is_file'))[0] ?? null;
$configPath = $configPath ?: $candidates([
    '/home/u943531942/domains/farooqandcotraders.online/private/erp-config.php',
    __DIR__ . '/../private/erp-config.php',
]);
$manifestPath = $manifestPath ?: $candidates([
    __DIR__ . '/stores.json',
    __DIR__ . '/../public_html/ERP/database/stores.json',
    '/home/u943531942/domains/farooqandcotraders.online/public_html/ERP/database/stores.json',
]);
if (!$configPath) fail('erp-config.php not found (use --config=)');
if (!$manifestPath) fail('stores.json not found (use --manifest=)');

/* ── read the backup (never written) ─────────────────────────────────────── */
$sha0 = hash_file('sha256', $file);
say("Backup   : $file (" . number_format(filesize($file)) . " bytes)");
say("SHA-256  : $sha0");
$raw = file_get_contents($file);
try { $backup = json_decode($raw, false, 4096, JSON_THROW_ON_ERROR); }
catch (JsonException $e) { fail('not valid JSON: ' . $e->getMessage()); }
unset($raw);
if (!is_object($backup) || ($backup->format ?? '') !== 'farooq-co-erp-backup') fail('that file is not a Farooq & Co ERP backup (format field)');
if (($backup->formatVersion ?? null) !== 1) fail('unsupported backup formatVersion: ' . json_encode($backup->formatVersion ?? null));
if (!isset($backup->data) || !is_object($backup->data)) fail('backup has no data object');
say('Exported : ' . ($backup->exportedAt ?? '?') . '  (app ' . ($backup->appVersion ?? '?') . ', driver ' . ($backup->driver ?? '?') . ')');

$manifest = json_decode(file_get_contents($manifestPath), true);
if (!is_array($manifest)) fail('stores.json is not valid');

/* ── validate structure ──────────────────────────────────────────────────── */
$unknown = array_values(array_diff(array_keys((array)$backup->data), array_keys($manifest)));
if ($unknown) fail('the backup contains stores this database has no table for: ' . implode(', ', $unknown) . ' — nothing was touched');

$src = [];      // store => pk => record (object)
$problems = [];
foreach ($manifest as $store => $def) {
    $rows = $backup->data->$store ?? [];
    if (!is_array($rows)) { $problems[] = "$store: not an array"; continue; }
    $src[$store] = [];
    foreach ($rows as $i => $rec) {
        if (!is_object($rec)) { $problems[] = "$store #$i: record is not an object"; continue; }
        $k = $rec->{$def['pk']} ?? null;
        if ($k === null || $k === '' || is_array($k) || is_object($k) || is_bool($k)) { $problems[] = "$store #$i: missing key '{$def['pk']}'"; continue; }
        $k = (string)$k;
        if (mb_strlen($k) > 128) { $problems[] = "$store #$i: key longer than 128 characters"; continue; }
        if (isset($src[$store][$k])) { $problems[] = "$store: duplicate key '$k'"; continue; }
        $src[$store][$k] = $rec;
    }
}
if ($problems) { foreach (array_slice($problems, 0, 20) as $p) say("  ✘ $p"); fail(count($problems) . ' problem(s) in the backup — nothing was touched'); }
$declared = (array)($backup->counts ?? new stdClass);
foreach ($manifest as $store => $_) {
    if (isset($declared[$store]) && (int)$declared[$store] !== count($src[$store])) {
        fail("counts header says $store has {$declared[$store]} but the file holds " . count($src[$store]) . ' — the file looks damaged');
    }
}

/* ── connect ─────────────────────────────────────────────────────────────── */
$cfg = require $configPath;
$b = $cfg['biz_db'] ?? null;
if (!$b) fail("no biz_db block in $configPath");
try {
    $pdo = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $b['host'], $b['port'], $b['name'], $b['charset'] ?? 'utf8mb4'),
        $b['user'], $b['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (PDOException $e) { fail('cannot connect to the business database: ' . $e->getMessage()); }
$pdo->exec('SET SESSION innodb_lock_wait_timeout = 30');
say('Database : ' . $b['name'] . ' @ ' . $b['host'] . '  (MariaDB ' . $pdo->query('SELECT VERSION()')->fetchColumn() . ')');
say('Mode     : ' . ($commit ? 'COMMIT (only if everything verifies)' : 'DRY RUN (rolled back at the end)'));
say();

foreach ($manifest as $store => $def) {
    try { $n = (int)$pdo->query('SELECT COUNT(*) FROM `' . $def['table'] . '`')->fetchColumn(); }
    catch (PDOException $e) { fail("table {$def['table']} is missing: " . $e->getMessage()); }
    if ($n > 0 && !$allowNonEmpty) fail("table {$def['table']} already holds $n rows — refusing to import over existing data (--allow-nonempty to override)");
}

/* ── load, all in ONE transaction ────────────────────────────────────────── */
$enc = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;
$t0 = microtime(true);
$pdo->beginTransaction();
$warnTotal = 0; $warnSamples = [];
try {
    foreach ($manifest as $store => $def) {
        $tbl = '`' . $def['table'] . '`';
        $batch = []; $bytes = 0;
        $flush = function () use (&$batch, &$bytes, $pdo, $tbl, &$warnTotal, &$warnSamples) {
            if (!$batch) return;
            $ph = implode(',', array_fill(0, count($batch), '(?,?)'));
            $st = $pdo->prepare("INSERT INTO $tbl (pk, doc) VALUES $ph");
            $st->execute(array_merge(...$batch));
            $w = (int)$pdo->query('SELECT @@warning_count')->fetchColumn();
            if ($w) { $warnTotal += $w; if (count($warnSamples) < 4) foreach ($pdo->query('SHOW WARNINGS')->fetchAll() as $r) { if (count($warnSamples) < 4) $warnSamples[] = $r['Message']; } }
            $batch = []; $bytes = 0;
        };
        foreach ($src[$store] as $pk => $rec) {
            try { $doc = json_encode($rec, $enc, 4096); }
            catch (JsonException $e) { throw new RuntimeException("$store '$pk' cannot be encoded as JSON (" . $e->getMessage() . ')'); }
            $batch[] = [(string)$pk, $doc]; $bytes += strlen($doc);
            if (count($batch) >= 200 || $bytes > 4 * 1048576) $flush();
        }
        $flush();
    }
} catch (Throwable $e) {
    $pdo->rollBack();
    fail('import failed and was rolled back — nothing changed: ' . $e->getMessage(), 1);
}
say(sprintf('Loaded all stores in %.1fs (inside a transaction).', microtime(true) - $t0));
if ($warnTotal) { say("  note: MariaDB raised $warnTotal warning(s) on the derived columns; first: " . implode(' | ', array_unique($warnSamples))); }
say();

/* ── verification ────────────────────────────────────────────────────────── */
$errors = 0; $warns = 0;
function deepEq($a, $b): bool {
    if (is_object($a) || is_object($b)) {
        if (!(is_object($a) && is_object($b))) return false;
        $x = (array)$a; $y = (array)$b;
        if (count($x) !== count($y)) return false;
        foreach ($x as $k => $v) { if (!array_key_exists($k, $y) || !deepEq($v, $y[$k])) return false; }
        return true;
    }
    if (is_array($a) || is_array($b)) {
        if (!(is_array($a) && is_array($b)) || count($a) !== count($b)) return false;
        foreach ($a as $i => $v) { if (!array_key_exists($i, $b) || !deepEq($v, $b[$i])) return false; }
        return true;
    }
    if ((is_int($a) || is_float($a)) && (is_int($b) || is_float($b))) return $a == $b;
    return $a === $b;
}

say(str_pad('store', 24) . str_pad('file', 9) . str_pad('database', 10) . str_pad('records identical', 19) . 'result');
say(str_repeat('-', 72));
foreach ($manifest as $store => $def) {
    $tbl = '`' . $def['table'] . '`';
    $nFile = count($src[$store]);
    $nDb = (int)$pdo->query("SELECT COUNT(*) FROM $tbl")->fetchColumn();
    $same = 0; $diff = [];
    if ($nDb > 0) {
        $st = $pdo->query("SELECT pk, doc FROM $tbl");
        while ($row = $st->fetch()) {
            $k = $row['pk'];
            $back = json_decode($row['doc'], false, 4096);
            if (isset($src[$store][$k]) && deepEq($src[$store][$k], $back)) $same++;
            elseif (count($diff) < 3) $diff[] = $k;
        }
    }
    $ok = ($nFile === $nDb && $same === $nFile);
    if (!$ok) $errors++;
    say(str_pad($store, 24) . str_pad((string)$nFile, 9) . str_pad((string)$nDb, 10) . str_pad("$same / $nFile", 19) . ($ok ? 'OK' : 'MISMATCH' . ($diff ? ' e.g. ' . implode(', ', $diff) : '')));
}
say();

/* money / quantity totals: the file's own numbers vs. the database's generated columns */
$totals = [
    // [label, store, field, scale, sql column, extra WHERE for the DB side, PHP filter for the file side]
    ['invoices.grandTotal (paisa)',   'invoices',           'grandTotal',    0, 'grand_total',    null, null],
    ['invoices.paidAmount (paisa)',   'invoices',           'paidAmount',    0, 'paid_amount',    null, null],
    ['invoices.balanceAmount',        'invoices',           'balanceAmount', 0, 'balance_amount', null, null],
    ['invoiceItems.lineTotal',        'invoiceItems',       'lineTotal',     0, 'line_total',     null, null],
    ['invoiceItems.quantity (bags)',  'invoiceItems',       'quantity',      3, 'quantity',       null, null],
    ['purchases.grandTotal',          'purchases',          'grandTotal',    0, 'grand_total',    null, null],
    ['purchases.paidAmount',          'purchases',          'paidAmount',    0, 'paid_amount',    null, null],
    ['payments received (IN)',        'payments',           'amount',        0, 'amount',         "direction = 'IN'",  fn($r) => ($r->direction ?? null) === 'IN'],
    ['payments paid out (OUT)',       'payments',           'amount',        0, 'amount',         "direction = 'OUT'", fn($r) => ($r->direction ?? null) === 'OUT'],
    ['paymentAllocations.amount',     'paymentAllocations', 'amount',        0, 'amount',         null, null],
    ['inventory.qty (sellable)',      'inventory',          'qty',           3, 'qty',            null, null],
    ['inventory.damagedQty',          'inventory',          'damagedQty',    3, 'damaged_qty',    null, null],
    ['stockMovements.qtyDelta',       'stockMovements',     'qtyDelta',      3, 'qty_delta',      null, null],
];
say('Money / quantity totals — file vs. database (computed by MariaDB from each stored record):');
foreach ($totals as [$label, $store, $field, $scale, $col, $where, $filter]) {
    $exp = 0.0; $fractional = 0;
    foreach ($src[$store] as $rec) {
        if ($filter && !$filter($rec)) continue;
        $v = $rec->$field ?? null;
        if ($v === null || $v === '' || !is_numeric($v)) continue;
        if ($scale === 0 && floor((float)$v) != (float)$v) $fractional++;
        $exp += round((float)$v, $scale);
    }
    $sql = 'SELECT COALESCE(SUM(`' . $col . '`),0) FROM `' . $manifest[$store]['table'] . '`' . ($where ? " WHERE $where" : '');
    $got = (float)$pdo->query($sql)->fetchColumn();
    $ok = abs($exp - $got) < 0.0005;
    if (!$ok) $errors++;
    say(sprintf('  %-32s file %18s   db %18s   %s%s', $label, number_format($exp, $scale), number_format($got, $scale), $ok ? 'OK' : 'MISMATCH',
        $fractional ? "  (note: $fractional fractional-paisa value(s) rounded in the query column only; the stored record is exact)" : ''));
}
say();

/* orphans — informational only: real backups can legitimately contain them, and no constraint rejects them */
$ids = fn(string $s) => array_flip(array_keys($src[$s] ?? []));
$links = [
    ['invoiceItems',       'invoiceId',  'invoices'],   ['invoices',          'customerId', 'customers'],
    ['invoiceItems',       'productId',  'products'],   ['paymentAllocations', 'paymentId',  'payments'],
    ['paymentAllocations', 'invoiceId',  'invoices'],   ['purchaseItems',      'purchaseId', 'purchases'],
    ['stockMovements',     'productId',  'products'],   ['inventory',          'productId',  'products'],
    ['customerReturnItems','returnId',   'customerReturns'], ['stockDocItems', 'docId',      'stockDocs'],
];
$orph = [];
foreach ($links as [$child, $fk, $parent]) {
    $p = $ids($parent); $n = 0;
    foreach ($src[$child] as $rec) { $v = $rec->$fk ?? null; if ($v !== null && $v !== '' && !isset($p[(string)$v])) $n++; }
    if ($n) $orph[] = "$child.$fk → $parent: $n";
}
say($orph ? 'Orphan references (informational — kept exactly as in the file): ' . implode('; ', $orph) : 'Orphan references: none.');

/* the source file must be byte-for-byte unchanged */
$sha1 = hash_file('sha256', $file);
if ($sha1 !== $sha0) { $errors++; say('✘ THE BACKUP FILE CHANGED DURING THE RUN'); }
else say('Backup file unchanged (SHA-256 identical before and after).');
say();

if ($errors) {
    $pdo->rollBack();
    say("RESULT: $errors verification problem(s) — ROLLED BACK, the database is untouched.");
    exit(1);
}
if ($commit) {
    // tell every open browser that the data changed (they poll this counter)
    try { if ($pdo->exec('UPDATE data_version SET v = v + 1 WHERE id = 1') === 0) $pdo->exec('INSERT IGNORE INTO data_version (id, v) VALUES (1, 1)'); }
    catch (PDOException $e) { /* older database without the counter: nothing to bump */ }
    $pdo->commit(); say('RESULT: everything verified — COMMITTED.');
}
else { $pdo->rollBack(); say('RESULT: everything verified — DRY RUN, rolled back (add --commit to keep it).'); }
exit(0);
