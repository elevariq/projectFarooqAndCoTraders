<?php
/**
 * Farooq & Co Traders ERP — business-data core (the server side of FDB).
 *
 * Pure functions over a PDO connection to the BUSINESS database (biz_db in the private config —
 * not the auth database). Endpoints in api/data/ are thin wrappers; scripts/test-data-core.php
 * exercises these functions directly against the real database.
 *
 * Model (see docs/MYSQL_MIGRATION_PLAN.md): every table holds `pk`, `doc` (the app's complete
 * record as JSON — authoritative), `rev` (bumped on each write) plus columns MariaDB generates
 * from `doc`. A client commits a batch of puts/deletes in ONE transaction, and says which
 * revision of each record it based the change on. If any record moved on since (someone else
 * saved it first), NOTHING is written and the conflicting keys come back — a save can never
 * silently overwrite another user's change.
 *
 * Deliberately no dependency on _bootstrap.php / sessions, so it is testable on its own.
 */
declare(strict_types=1);

const DATA_MAX_OPS    = 5000;
const DATA_MAX_READS  = 20000;
if (!defined('DATA_LOCK_WAIT')) define('DATA_LOCK_WAIT', 10);   // seconds a commit waits for another commit's row locks (tests shorten it)

function data_manifest(): array {
    static $m = null;
    return $m ??= require __DIR__ . '/_stores.php';
}

/** 'server' only when private/erp-config.php says exactly that; anything else = the browser keeps the data. */
function data_backend(array $CFG): string {
    return (($CFG['data_backend'] ?? 'browser') === 'server') ? 'server' : 'browser';
}

function data_pdo(array $CFG): PDO {
    $b = $CFG['biz_db'] ?? null;
    if (!$b) throw new RuntimeException('biz_db is not configured');
    // 'dsn' is an override used only by tests, never set in the live config
    $dsn = $b['dsn'] ?? sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $b['host'], $b['port'], $b['name'], $b['charset'] ?? 'utf8mb4');
    $pdo = new PDO($dsn, $b['user'] ?? null, $b['pass'] ?? null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

/** Same encoding the importer uses and verified: {} stays {}, [] stays [], floats keep their shortest text. */
function data_encode($v): string {
    ini_set('serialize_precision', '-1');
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR, 512);
}

function data_version(PDO $db): int {
    $v = $db->query('SELECT v FROM data_version WHERE id = 1')->fetchColumn();
    return $v === false ? 0 : (int)$v;
}

/** Is there any business data yet? (An empty database must never be "seeded" by a browser.) */
function data_is_empty(PDO $db): bool {
    return $db->query('SELECT 1 FROM products LIMIT 1')->fetchColumn() === false;
}

/**
 * Whole store contents as JSON TEXT. The stored `doc` is spliced in as-is (never decoded and
 * re-encoded), so what the browser receives is byte-for-byte what was saved.
 *   {"version":N,"stores":{"invoices":[["pk",rev,{doc}],...],...}}
 * $only limits it to some stores (the browser refreshes just the counters before a save).
 * $recent (only with $only) keeps just the newest N rows of each store asked for, newest first — the Warehouse
 * app shows the last few stock movements and must not download years of them.
 */
function data_hydrate_json(PDO $db, ?array $only = null, ?int $recent = null): string {
    $manifest = data_manifest();
    $version = data_version($db);          // read BEFORE the data: a commit racing us only makes the client refresh once more
    $parts = [];
    foreach ($manifest as $store => $def) {
        if ($only !== null && !in_array($store, $only, true)) continue;
        $rows = [];
        $st = $db->query('SELECT pk, rev, doc FROM `' . $def['table'] . '`' .
            ($only !== null && $recent !== null && $recent > 0 ? ' ORDER BY row_updated_at DESC, pk DESC LIMIT ' . (int)$recent : ''));
        while ($r = $st->fetch()) {
            $rows[] = '[' . json_encode((string)$r['pk'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ',' . (int)$r['rev'] . ',' . $r['doc'] . ']';
        }
        $parts[] = json_encode($store) . ':[' . implode(',', $rows) . ']';
    }
    return '{"version":' . $version . ',"stores":{' . implode(',', $parts) . '}}';
}

/**
 * Apply one batch atomically.
 *   $payload = { ops:   [ {s:store, k:key, d:{record}|null, r:expectedRev|null}, ... ],
 *                reads: [ {s:store, k:key, r:revItWasReadAt}, ... ] }
 *   d = null deletes.  r = expected current revision: 0 = must not exist yet, N = must still be at N,
 *   null = don't check (blind write).  `reads` are records the client only READ and based its work on.
 * Returns [httpStatus, body]. 200 {ok,version,revs:[[s,k,newRev]...]} · 409 {conflict:[...]} ·
 * 409 {duplicate} · 403 audit log is append-only · 400 malformed · 503 retry (lock wait / deadlock).
 */
function data_commit(PDO $db, object $payload): array {
    $manifest = data_manifest();
    $ops = $payload->ops ?? null; $reads = $payload->reads ?? [];
    if (!is_array($ops) || !is_array($reads)) return [400, ['error' => 'Malformed request.']];
    if (count($ops) > DATA_MAX_OPS || count($reads) > DATA_MAX_READS) return [413, ['error' => 'That save is too large.']];

    /* ── validate everything BEFORE touching the database ───────────────── */
    $plan = []; $want = [];
    foreach ($ops as $i => $o) {
        if (!is_object($o) || !isset($o->s, $o->k) || !is_string($o->s) || !is_string($o->k) || !isset($manifest[$o->s])) return [400, ['error' => "Bad operation #$i."]];
        $s = $o->s; $k = $o->k;
        if ($k === '' || mb_strlen($k) > 128) return [400, ['error' => "Bad key in operation #$i."]];
        $r = $o->r ?? null;
        if ($r !== null && (!is_int($r) || $r < 0)) return [400, ['error' => "Bad revision in operation #$i."]];
        $d = $o->d ?? null;
        if ($d !== null && !is_object($d)) return [400, ['error' => "Bad record in operation #$i."]];
        if ($d !== null) {                                     // the record must carry the key it is filed under
            $kf = $d->{$manifest[$s]['pk']} ?? null;
            if ((is_string($kf) || is_int($kf) || is_float($kf)) === false || (string)$kf !== $k) return [400, ['error' => "Record does not match its key in operation #$i."]];
        }
        /* the audit trail can only grow: new entries yes, edits or deletes never */
        if ($s === 'auditLog' && !($d !== null && $r === 0)) return [403, ['error' => 'The audit log is append-only.']];
        $id = $s . "\0" . $k;
        if (isset($plan[$id])) return [400, ['error' => "Duplicate operation for $s/$k."]];
        try { $doc = $d === null ? null : data_encode($d); }
        catch (JsonException $e) { return [400, ['error' => "Record $s/$k cannot be stored: " . $e->getMessage()]]; }
        $plan[$id] = ['s' => $s, 'k' => $k, 'doc' => $doc, 'r' => $r];
        $want[$s][$k] = true;
    }
    $readChecks = [];
    foreach ($reads as $i => $o) {
        if (!is_object($o) || !isset($o->s, $o->k, $o->r) || !is_string($o->s) || !is_string($o->k) || !isset($manifest[$o->s]) || !is_int($o->r) || $o->r < 0) return [400, ['error' => "Bad read #$i."]];
        $readChecks[] = [$o->s, $o->k, $o->r];
        $want[$o->s][$o->k] = true;
    }
    if (!$plan) return [200, ['ok' => true, 'version' => data_version($db), 'revs' => []]];   // nothing to write

    /* ── one transaction ─────────────────────────────────────────────────── */
    try {
        $db->exec('SET SESSION innodb_lock_wait_timeout = ' . DATA_LOCK_WAIT);
        $db->beginTransaction();

        // Lock + read the current revision of every record we touch. Fixed order (by store, then key)
        // so two commits touching the same records can never deadlock each other.
        $cur = [];
        ksort($want);
        foreach ($want as $s => $keys) {
            $keys = array_keys($keys); sort($keys, SORT_STRING);
            foreach (array_chunk($keys, 400) as $chunk) {
                $st = $db->prepare('SELECT pk, rev FROM `' . $manifest[$s]['table'] . '` WHERE pk IN (' . implode(',', array_fill(0, count($chunk), '?')) . ') ORDER BY pk FOR UPDATE');
                $st->execute($chunk);
                foreach ($st->fetchAll() as $row) $cur[$s . "\0" . $row['pk']] = (int)$row['rev'];
            }
        }

        $conflicts = [];
        foreach ($plan as $id => $p) {
            $now = $cur[$id] ?? 0;
            if ($p['r'] !== null && $p['r'] !== $now) $conflicts[] = ['s' => $p['s'], 'k' => $p['k'], 'expected' => $p['r'], 'current' => $now];
        }
        foreach ($readChecks as [$s, $k, $r]) {
            $now = $cur[$s . "\0" . $k] ?? 0;
            if ($r !== $now) $conflicts[] = ['s' => $s, 'k' => $k, 'expected' => $r, 'current' => $now];
        }
        if ($conflicts) { $db->rollBack(); return [409, ['ok' => false, 'conflict' => $conflicts]]; }

        $revs = [];
        foreach ($plan as $id => $p) {
            $tbl = '`' . $manifest[$p['s']]['table'] . '`';
            $now = $cur[$id] ?? 0;
            if ($p['doc'] === null) {
                if ($now > 0) $db->prepare("DELETE FROM $tbl WHERE pk = ?")->execute([$p['k']]);
                $revs[] = [$p['s'], $p['k'], 0];
            } elseif ($now > 0) {
                $db->prepare("UPDATE $tbl SET doc = ?, rev = rev + 1 WHERE pk = ?")->execute([$p['doc'], $p['k']]);
                $revs[] = [$p['s'], $p['k'], $now + 1];
            } else {
                $db->prepare("INSERT INTO $tbl (pk, doc, rev) VALUES (?, ?, 1)")->execute([$p['k'], $p['doc']]);
                $revs[] = [$p['s'], $p['k'], 1];
            }
        }
        // last, and always in this order: the change counter serialises commits for a moment only
        $up = $db->exec('UPDATE data_version SET v = v + 1 WHERE id = 1');
        if ($up === 0) $db->exec('INSERT IGNORE INTO data_version (id, v) VALUES (1, 1)');
        $version = data_version($db);
        $db->commit();
        return [200, ['ok' => true, 'version' => $version, 'revs' => $revs]];
    } catch (PDOException $e) {
        if ($db->inTransaction()) $db->rollBack();
        $code = (int)($e->errorInfo[1] ?? 0); $msg = $e->getMessage();
        if ($code === 1062) {
            // someone created the same key between our check and our insert = a plain conflict;
            // any other unique index (invoice / receipt / purchase number…) = a real duplicate
            if (stripos($msg, "for key 'PRIMARY'") !== false) return [409, ['ok' => false, 'conflict' => [['s' => '?', 'k' => '?', 'expected' => 0, 'current' => 1]]]];
            preg_match("/Duplicate entry '(.*)' for key '([^']*)'/s", $msg, $m);
            return [409, ['ok' => false, 'duplicate' => true, 'value' => $m[1] ?? '', 'index' => $m[2] ?? '',
                          'error' => 'That number is already in use — another user saved a document first.']];
        }
        if ($code === 1205 || $code === 1213) return [503, ['ok' => false, 'retry' => true, 'error' => 'The database was busy — nothing was saved. Please try again.']];
        error_log('[erp-data] commit failed: ' . $msg);
        return [500, ['ok' => false, 'error' => 'The save could not be completed.']];
    }
}
