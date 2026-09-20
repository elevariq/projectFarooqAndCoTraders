<?php
/** GET /api/data/version.php -> {version}. One tiny read; browsers poll it to notice other people's saves. */
declare(strict_types=1);
require __DIR__ . '/_guard.php';
data_guard(false);
json_out(['version' => data_version(data_db())]);
