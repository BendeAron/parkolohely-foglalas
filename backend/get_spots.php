<?php
/**
 * get_spots.php — Lists active parking spots.
 *
 * GET /get_spots.php
 *     → all active spots, is_available = true
 *
 * GET /get_spots.php?start_time=2026-08-03 10:00:00&end_time=2026-08-03 14:00:00
 *     → same list, but is_available reflects whether the spot is free
 *       for that entire window
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

// ------------------------------------------------------------
// 1. Method guard
// ------------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    json_error('Method not allowed. Use GET.', 405);
}

// ------------------------------------------------------------
// 2. Read + validate the optional time window
// ------------------------------------------------------------

/**
 * Parse a client-supplied timestamp into PostgreSQL's canonical format.
 * Accepts 'Y-m-d H:i:s', 'Y-m-d\TH:i' and full ISO 8601 (what
 * JavaScript's Date.toISOString() produces).
 *
 * Returns null if the value cannot be parsed.
 */
function parse_timestamp(string $value): ?string
{
    $value = trim($value);

    if ($value === '') {
        return null;
    }

    foreach (['Y-m-d H:i:s', 'Y-m-d\TH:i:s', 'Y-m-d\TH:i', 'Y-m-d H:i'] as $format) {
        $dt = DateTime::createFromFormat($format, $value);

        // createFromFormat is lenient about impossible dates (e.g. 2026-02-31),
        // so verify no warnings or errors were raised.
        $errors = DateTime::getLastErrors();
        $clean  = $errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0);

        if ($dt instanceof DateTime && $clean) {
            return $dt->format('Y-m-d H:i:s');
        }
    }

    // Fall back to ISO 8601 with timezone / milliseconds.
    try {
        return (new DateTimeImmutable($value))->format('Y-m-d H:i:s');
    } catch (Exception) {
        return null;
    }
}

$rawStart = $_GET['start_time'] ?? null;
$rawEnd   = $_GET['end_time']   ?? null;

$startTime = null;
$endTime   = null;

// Treat the window as all-or-nothing: one half alone is a client bug,
// and silently ignoring it would return misleading availability.
$hasStart = is_string($rawStart) && trim($rawStart) !== '';
$hasEnd   = is_string($rawEnd)   && trim($rawEnd)   !== '';

if ($hasStart !== $hasEnd) {
    json_error('start_time and end_time must be supplied together.', 400);
}

if ($hasStart && $hasEnd) {
    $startTime = parse_timestamp($rawStart);
    $endTime   = parse_timestamp($rawEnd);

    if ($startTime === null || $endTime === null) {
        json_error('Invalid timestamp format. Expected e.g. 2026-08-03 10:00:00.', 400);
    }

    if ($endTime <= $startTime) {
        json_error('end_time must be later than start_time.', 400);
    }
}

// ------------------------------------------------------------
// 3. Build the query
// ------------------------------------------------------------
// Both branches return the same column shape so the React side never
// has to special-case the response.

if ($startTime !== null) {
    // NOT EXISTS + tsrange overlap: a spot is available when no
    // non-cancelled reservation intersects the requested window.
    // tsrange is half-open [start, end), so back-to-back bookings
    // (10:00-12:00 and 12:00-14:00) do NOT count as overlapping.
    $sql = "
        SELECT
            s.id,
            s.spot_number,
            s.spot_type,
            s.hourly_rate,
            s.is_active,
            NOT EXISTS (
                SELECT 1
                FROM reservations r
                WHERE r.spot_id = s.id
                  AND r.status <> 'cancelled'
                  AND tsrange(r.start_time, r.end_time)
                      && tsrange(:start_time::timestamp, :end_time::timestamp)
            ) AS is_available
        FROM parking_spots s
        WHERE s.is_active = true
        ORDER BY s.spot_number
    ";

    $params = [
        ':start_time' => $startTime,
        ':end_time'   => $endTime,
    ];
} else {
    $sql = "
        SELECT
            s.id,
            s.spot_number,
            s.spot_type,
            s.hourly_rate,
            s.is_active,
            true AS is_available
        FROM parking_spots s
        WHERE s.is_active = true
        ORDER BY s.spot_number
    ";

    $params = [];
}

// ------------------------------------------------------------
// 4. Execute and normalise types
// ------------------------------------------------------------
try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
} catch (PDOException $e) {
    error_log('[parkolo] get_spots query failed: ' . $e->getMessage());
    json_error('Could not load parking spots.', 500);
}

// pdo_pgsql hands back NUMERIC as a string and BOOLEAN as 't'/'f' on some
// builds. Cast here so the JSON payload has real numbers and booleans.
$spots = array_map(static function (array $row): array {
    return [
        'id'           => (int) $row['id'],
        'spot_number'  => $row['spot_number'],
        'spot_type'    => $row['spot_type'],
        'hourly_rate'  => (float) $row['hourly_rate'],
        'is_active'    => filter_var($row['is_active'], FILTER_VALIDATE_BOOLEAN),
        'is_available' => filter_var($row['is_available'], FILTER_VALIDATE_BOOLEAN),
    ];
}, $rows);

// ------------------------------------------------------------
// 5. Respond
// ------------------------------------------------------------
json_response([
    'success' => true,
    'count'   => count($spots),
    'filter'  => [
        'start_time' => $startTime,
        'end_time'   => $endTime,
    ],
    'data'    => $spots,
]);