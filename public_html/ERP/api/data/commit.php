<?php
/** POST /api/data/commit.php  {ops:[{s,k,d,r}], reads:[{s,k,r}]}  -> one atomic save (see _data.php). */
declare(strict_types=1);
require __DIR__ . '/_guard.php';
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') json_error('POST only.', 405);
$session = data_guard(true);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32 * 1048576) json_error('That save is too large.', 413);
set_time_limit(120);
$raw = file_get_contents('php://input');
try { $payload = json_decode((string)$raw, false, 512, JSON_THROW_ON_ERROR); }
catch (JsonException $e) { json_error('Malformed request.', 400); }
if (!is_object($payload)) json_error('Malformed request.', 400);
[$status, $body] = data_commit(data_db(), $payload);
json_out($body, $status);
