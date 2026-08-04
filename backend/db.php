<?php
/**
 * db.php — Shared database bootstrap for the Parking Spot Reservation API.
 *
 * Include this at the top of every endpoint:
 *     require_once __DIR__ . '/db.php';
 *     $stmt = $pdo->prepare('SELECT * FROM parking_spots WHERE id = :id');
 *
 * Provides:
 *   - CORS headers + OPTIONS preflight handling
 *   - A configured PDO instance ($pdo)
 *   - json_response() / json_error() helpers
 */

declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------
// Credentials come from the environment. Set them in your web server
// config, a .env loader, or export them before starting PHP.
// The fallbacks are tuned for local development with Docker.
const DB_HOST = 'db';
const DB_PORT = '5432';
const DB_NAME = 'parkolo_db';
const DB_USER = 'postgres';
const DB_PASS = 'postgrespassword';

$dbHost = getenv('DB_HOST') ?: DB_HOST;
$dbPort = getenv('DB_PORT') ?: DB_PORT;
$dbName = getenv('DB_NAME') ?: DB_NAME;
$dbUser = getenv('DB_USER') ?: DB_USER;
$dbPass = getenv('DB_PASS') ?: (getenv('POSTGRES_PASSWORD') ?: DB_PASS);

// Set to true in local dev so internal errors are visible for debugging.
$debugMode = (getenv('APP_DEBUG') === 'true' || getenv('APP_DEBUG') === '1');

// ------------------------------------------------------------
// CORS + content type
// ------------------------------------------------------------
// NOTE: '*' is fine for local development. Before deploying, replace it
// with your actual front-end origin, e.g. 'https://parkolo.example.com'.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Max-Age: 86400');
header('Content-Type: application/json; charset=utf-8');

// Answer the browser's preflight request and stop — no body, no DB connection.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ------------------------------------------------------------
// JSON helpers
// ------------------------------------------------------------

/**
 * Send a JSON payload and terminate the request.
 */
if (!function_exists('json_response')) {
    function json_response(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
}

/**
 * Send a JSON error envelope and terminate the request.
 */
if (!function_exists('json_error')) {
    function json_error(string $message, int $status = 400, ?string $detail = null): never
    {
        $payload = ['success' => false, 'error' => $message];

        if ($detail !== null) {
            $payload['detail'] = $detail;
        }

        json_response($payload, $status);
    }
}

// ------------------------------------------------------------
// Database connection
// ------------------------------------------------------------
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;options=\'--client_encoding=UTF8\'',
    $dbHost,
    $dbPort,
    $dbName
);

try {
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,

        // Use real server-side prepared statements rather than PDO's
        // client-side emulation — this is what makes bound parameters
        // genuinely injection-proof.
        PDO::ATTR_EMULATE_PREPARES   => false,

        // Reuse connections across requests where the SAPI supports it.
        PDO::ATTR_PERSISTENT         => false,
    ]);

} catch (PDOException $e) {
    // Log the real reason for yourself; never send it to the browser.
    error_log('[parkolo] DB connection failed: ' . $e->getMessage());

    json_error(
        'Database connection failed.',
        500,
        $debugMode ? $e->getMessage() : null
    );
}