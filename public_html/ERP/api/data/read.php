<?php
/** GET /api/data/read.php?stores=sequences,inventory -> same shape as hydrate, for just those stores. */
declare(strict_types=1);
require __DIR__ . '/_guard.php';
data_guard(false);
$want = array_values(array_filter(explode(',', (string)($_GET['stores'] ?? ''))));
$known = data_manifest();
foreach ($want as $s) if (!isset($known[$s])) json_error('Unknown store.', 400);
if (!$want) json_error('No stores requested.', 400);
data_raw_out(data_hydrate_json(data_db(), $want));
