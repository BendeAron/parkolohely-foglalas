<?php
/**
 * PHPUnit bootstrap.
 *
 * Loads only the side-effect-free files. db.php is deliberately NOT loaded:
 * it sends CORS headers and opens a connection at include time, which would
 * blow up under the CLI SAPI and couple every unit test to a live database.
 */

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/../pricing.php';
require_once __DIR__ . '/../helpers.php';