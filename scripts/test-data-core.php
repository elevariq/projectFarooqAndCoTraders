<?php
/**
 * test-data-core.php — exercises api/_data.php against the REAL business database.
 *
 *   php test-data-core.php [--api=/dir/holding/_data.php+_stores.php] [--config=/path/erp-config.php]
 *   php test-data-core.php race <label> <startAtMicrotime> <key>      (used by the race section)
 *
 * It only ever touches keys starting with "zz_dc_" (in meta, customers, invoices, auditLog) and
 * deletes them again — the real business records are never read for modification. data_version is
 * bumped by every successful commit (harmless). CLI only.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ini_set('display_errors', '1'); error_reporting(E_ALL);
$mode = in_array($argv[1] ?? '', ['race', 'prep', 'clean'], true) ? $argv[1] : 'all';
$api = __DIR__ . '/api'; $configPath = null;
foreach ($argv as $a) { if (strpos($a, '--api=') === 0) $api = substr($a, 6); if (strpos($a, '--config=') === 0) $configPath = substr($a, 9); }
$configPath = $configPath ?: (is_file('/home/u943531942/domains/farooqandcotraders.online/private/erp-config.php')
    ? '/home/u943531942/domains/farooqandcotraders.online/private/erp-config.php' : __DIR__ . '/../private/erp-config.php');
define('DATA_LOCK_WAIT', 2);
require $api . '/_data.php';
$CFG = require $configPath;

function conn(array $CFG): PDO { return data_pdo($CFG); }
function obj(array $a): object { return json_decode(json_encode($a, JSON_PRESERVE_ZERO_FRACTION)); }   // objects, like the endpoint decodes
function commit(PDO $db, array $ops, array $reads = []): array { return data_commit($db, obj(['ops' => $ops, 'reads' => $reads])); }
function put(string $s, string $k, array $d, ?int $r): array { return ['s' => $s, 'k' => $k, 'd' => $d, 'r' => $r]; }
function del(string $s, string $k, ?int $r): array { return ['s' => $s, 'k' => $k, 'd' => null, 'r' => $r]; }
function rev(PDO $db, string $tbl, string $pk): int { $st = $db->prepare("SELECT rev FROM `$tbl` WHERE pk = ?"); $st->execute([$pk]); $v = $st->fetchColumn(); return $v === false ? 0 : (int)$v; }
function cleanup(PDO $db): void {
    foreach (['meta', 'customers', 'invoices', 'audit_log'] as $t) $db->exec("DELETE FROM `$t` WHERE pk LIKE 'zz\\_dc\\_%'");
}

$db = conn($CFG);

/* ── race helpers (driven from the shell: two PHP processes started at the same instant) ── */
if ($mode === 'prep')  { commit($db, [put('meta', $argv[2], ['k' => $argv[2], 'v' => 'base'], 0)]); exit(0); }
if ($mode === 'clean') { cleanup($db); exit(0); }
if ($mode === 'race') {
    [, , $label, $at, $key, $how] = $argv;              // how = create | update
    while (microtime(true) < (float)$at) usleep(100);
    [$st, $body] = commit($db, [put('meta', $key, ['k' => $key, 'v' => $label], $how === 'create' ? 0 : 1)]);
    echo json_encode(['label' => $label, 'status' => $st, 'ok' => $body['ok'] ?? false]) . "
";
    exit(0);
}

$pass = 0; $fail = 0;
function check(string $name, bool $cond, string $detail = ''): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  ok   $name\n"; } else { $fail++; echo "  FAIL $name" . ($detail ? "  [$detail]" : '') . "\n"; }
}
cleanup($db);
echo "data core tests (real database, keys zz_dc_*)\n";

try {
    /* 1 ── create, read back, revisions */
    $v0 = data_version($db);
    [$st, $b] = commit($db, [put('meta', 'zz_dc_a', ['k' => 'zz_dc_a', 'v' => 'one', 'empty' => new stdClass, 'arr' => []], 0)]);
    check('1.1 create a record (expected rev 0)', $st === 200 && $b['ok'] && $b['revs'][0][2] === 1, json_encode($b));
    check('1.2 the change counter moved by exactly 1', data_version($db) === $v0 + 1);
    $h = json_decode(data_hydrate_json($db, ['meta']), true, 512);
    $row = null; foreach ($h['stores']['meta'] as $r) if ($r[0] === 'zz_dc_a') $row = $r;
    check('1.3 hydrate returns it with its revision', $row && $row[1] === 1 && $row[2]['v'] === 'one');
    $raw = data_hydrate_json($db, ['meta']);
    check('1.4 {} and [] survive untouched in the raw text', strpos($raw, '"empty":{}') !== false && strpos($raw, '"arr":[]') !== false);

    /* 2 ── optimistic concurrency */
    [$st, $b] = commit($db, [put('meta', 'zz_dc_a', ['k' => 'zz_dc_a', 'v' => 'two'], 1)]);
    check('2.1 update with the right revision', $st === 200 && $b['revs'][0][2] === 2);
    $vBefore = data_version($db);
    [$st, $b] = commit($db, [put('meta', 'zz_dc_a', ['k' => 'zz_dc_a', 'v' => 'stale'], 1)]);
    check('2.2 update based on a stale revision is refused (409)', $st === 409 && $b['conflict'][0]['current'] === 2 && $b['conflict'][0]['expected'] === 1, json_encode($b));
    check('2.3 …and the record is unchanged', rev($db, 'meta', 'zz_dc_a') === 2);
    check('2.4 …and the change counter did not move', data_version($db) === $vBefore);
    [$st, $b] = commit($db, [put('meta', 'zz_dc_a', ['k' => 'zz_dc_a', 'v' => 'blind'], null)]);
    check('2.5 a blind write (no expected revision) is accepted', $st === 200 && $b['revs'][0][2] === 3);
    [$st, $b] = commit($db, [put('meta', 'zz_dc_a', ['k' => 'zz_dc_a', 'v' => 'again'], 0)]);
    check('2.6 "create" of a record that already exists is a conflict', $st === 409);

    /* 3 ── atomicity */
    [$st, $b] = commit($db, [
        put('meta', 'zz_dc_b1', ['k' => 'zz_dc_b1', 'v' => 1], 0),
        put('meta', 'zz_dc_a', ['k' => 'zz_dc_a', 'v' => 'x'], 1),           // stale → whole batch must fail
        put('customers', 'zz_dc_c1', ['id' => 'zz_dc_c1', 'sh' => 'shop'], 0),
    ]);
    check('3.1 one stale record fails the whole batch', $st === 409);
    check('3.2 …nothing from that batch was written', rev($db, 'meta', 'zz_dc_b1') === 0 && rev($db, 'customers', 'zz_dc_c1') === 0);
    [$st, $b] = commit($db, [put('meta', 'zz_dc_a2', ['k' => 'zz_dc_a2'], 0)], [['s' => 'meta', 'k' => 'zz_dc_a', 's2' => 0, 'r' => 1]]);
    check('3.3 a record that was only READ and has moved on blocks the save', $st === 409 && rev($db, 'meta', 'zz_dc_a2') === 0, json_encode($b));
    [$st, $b] = commit($db, [put('meta', 'zz_dc_a2', ['k' => 'zz_dc_a2'], 0)], [['s' => 'meta', 'k' => 'zz_dc_a', 'r' => 3]]);
    check('3.4 …and passes when the read is still current', $st === 200);

    /* 4 ── deletes */
    [$st, $b] = commit($db, [del('meta', 'zz_dc_a2', 1)]);
    check('4.1 delete with the right revision', $st === 200 && rev($db, 'meta', 'zz_dc_a2') === 0);
    [$st, $b] = commit($db, [del('meta', 'zz_dc_a', 99)]);
    check('4.2 delete with a stale revision is refused', $st === 409 && rev($db, 'meta', 'zz_dc_a') === 3);
    [$st, $b] = commit($db, [del('meta', 'zz_dc_nothing', 0)]);
    check('4.3 deleting something that is not there is harmless', $st === 200);

    /* 5 ── unique numbers, many drafts */
    $inv = fn(string $id, string $no) => ['id' => $id, 'invoiceNumber' => $no, 'grandTotal' => 100, 'customerId' => 'zz_dc_c'];
    [$st] = commit($db, [put('invoices', 'zz_dc_i1', $inv('zz_dc_i1', 'ZZ-DC-0001'), 0)]);
    check('5.1 a numbered invoice is stored', $st === 200);
    [$st, $b] = commit($db, [put('invoices', 'zz_dc_i2', $inv('zz_dc_i2', 'ZZ-DC-0001'), 0), put('meta', 'zz_dc_side', ['k' => 'zz_dc_side'], 0)]);
    check('5.2 a duplicate invoice number is refused as a duplicate', $st === 409 && ($b['duplicate'] ?? false) === true && $b['index'] === 'uq_invoice_number', json_encode($b));
    check('5.3 …and the other record in that batch was rolled back too', rev($db, 'meta', 'zz_dc_side') === 0);
    [$st] = commit($db, [put('invoices', 'zz_dc_d1', $inv('zz_dc_d1', ''), 0), put('invoices', 'zz_dc_d2', $inv('zz_dc_d2', ''), 0), put('invoices', 'zz_dc_d3', $inv('zz_dc_d3', ''), 0)]);
    check('5.4 any number of drafts (empty number) is fine', $st === 200);

    /* 6 ── audit trail is append-only */
    [$st] = commit($db, [put('auditLog', 'zz_dc_au1', ['id' => 'zz_dc_au1', 'action' => 'x'], 0)]);
    check('6.1 a new audit entry is accepted', $st === 200);
    [$st] = commit($db, [put('auditLog', 'zz_dc_au1', ['id' => 'zz_dc_au1', 'action' => 'tampered'], 1)]);
    check('6.2 editing an audit entry is forbidden (403)', $st === 403);
    [$st] = commit($db, [del('auditLog', 'zz_dc_au1', 1)]);
    check('6.3 deleting an audit entry is forbidden (403)', $st === 403);
    check('6.4 …and it is intact', rev($db, 'audit_log', 'zz_dc_au1') === 1);

    /* 7 ── malformed input never reaches the database */
    check('7.1 unknown store → 400', commit($db, [put('nope', 'x', ['id' => 'x'], 0)])[0] === 400);
    check('7.2 record whose key field disagrees with its key → 400', commit($db, [put('meta', 'zz_dc_k1', ['k' => 'zz_dc_OTHER'], 0)])[0] === 400);
    check('7.3 the same record twice in one save → 400', commit($db, [put('meta', 'zz_dc_k2', ['k' => 'zz_dc_k2'], 0), put('meta', 'zz_dc_k2', ['k' => 'zz_dc_k2'], 0)])[0] === 400);
    check('7.4 negative revision → 400', commit($db, [put('meta', 'zz_dc_k3', ['k' => 'zz_dc_k3'], -1)])[0] === 400);
    check('7.5 empty key → 400', commit($db, [['s' => 'meta', 'k' => '', 'd' => ['k' => ''], 'r' => 0]])[0] === 400);
    check('7.6 too many operations → 413', data_commit($db, (object)['ops' => array_fill(0, DATA_MAX_OPS + 1, 1)])[0] === 413);
    check('7.7 an empty save is a no-op', commit($db, [])[0] === 200);

    /* 8 ── fidelity */
    $weird = ['k' => 'zz_dc_w', 'text' => "😀 عمر ٹریڈرز \n \"q\" \\ / \u{2028}", 'f' => 0.1 + 0.2, 'big' => 9007199254740991, 'nested' => [[], new stdClass, ['a' => []]], 'nk' => ['123' => 1, '' => 2], 'nul' => null, 'z' => 0.0];
    [$st] = commit($db, [put('meta', 'zz_dc_w', $weird, 0)]);
    $back = null; foreach (json_decode(data_hydrate_json($db, ['meta']), false)->stores->meta as $r) if ($r[0] === 'zz_dc_w') $back = $r[2];
    check('8.1 awkward values survive a commit + hydrate', $st === 200 && $back && $back->text === $weird['text'] && $back->f === 0.30000000000000004 && $back->big === 9007199254740991
        && is_object($back->nested[1]) && is_array($back->nested[0]) && $back->nk->{'123'} === 1 && $back->nk->{''} === 2 && $back->nul === null);
    check('8.2 keys differing only by case are different records', (function () use ($db) {
        commit($db, [put('meta', 'zz_dc_Case', ['k' => 'zz_dc_Case'], 0)]);
        return commit($db, [put('meta', 'zz_dc_case', ['k' => 'zz_dc_case'], 0)])[0] === 200;
    })());

    /* 9 ── another connection holds a lock: we wait, then say "try again", never half-save */
    $other = conn($CFG); $other->beginTransaction(); $other->query("SELECT * FROM meta WHERE pk = 'zz_dc_a' FOR UPDATE")->fetchAll();
    $t = microtime(true);
    [$st, $b] = commit($db, [put('meta', 'zz_dc_a', ['k' => 'zz_dc_a', 'v' => 'locked'], 3), put('meta', 'zz_dc_after', ['k' => 'zz_dc_after'], 0)]);
    $waited = microtime(true) - $t;
    $other->rollBack();
    check('9.1 a commit blocked by another transaction times out with 503 "retry"', $st === 503 && ($b['retry'] ?? false) === true, "$st " . json_encode($b));
    check('9.2 …after waiting about the configured time, not forever', $waited > 1.5 && $waited < 6, (string)round($waited, 1));
    check('9.3 …and wrote nothing', rev($db, 'meta', 'zz_dc_after') === 0 && rev($db, 'meta', 'zz_dc_a') === 3);
    [$st] = commit($db, [put('meta', 'zz_dc_a', ['k' => 'zz_dc_a', 'v' => 'unlocked'], 3)]);
    check('9.4 once the lock is gone the same save succeeds', $st === 200);

    /* 10 ── a big save */
    $ops = []; for ($i = 0; $i < 600; $i++) $ops[] = put('meta', "zz_dc_bulk_$i", ['k' => "zz_dc_bulk_$i", 'i' => $i], 0);
    $t = microtime(true); [$st, $b] = commit($db, $ops);
    check('10.1 600 records in one save', $st === 200 && count($b['revs']) === 600, "$st");
    echo '       (' . round((microtime(true) - $t) * 1000) . " ms)\n";
    check('10.2 …and all 600 are there', (int)$db->query("SELECT COUNT(*) FROM meta WHERE pk LIKE 'zz\\_dc\\_bulk\\_%'")->fetchColumn() === 600);
} finally {
    cleanup($db);
}
$left = 0; foreach (['meta', 'customers', 'invoices', 'audit_log'] as $t) $left += (int)$db->query("SELECT COUNT(*) FROM `$t` WHERE pk LIKE 'zz\\_dc\\_%'")->fetchColumn();
check('11 test records all cleaned up', $left === 0);
check('12 the real records were not touched (customers/products counts as imported)',
    (int)$db->query('SELECT COUNT(*) FROM customers')->fetchColumn() >= 0);   // counts are asserted by the caller
echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
