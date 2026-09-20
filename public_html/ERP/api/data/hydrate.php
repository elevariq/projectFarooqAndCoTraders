<?php
/** GET /api/data/hydrate.php -> every store: {"version":N,"stores":{"invoices":[["pk",rev,{doc}],...],...}} */
declare(strict_types=1);
require __DIR__ . '/_guard.php';
data_guard(false);
set_time_limit(120);
data_raw_out(data_hydrate_json(data_db()));
