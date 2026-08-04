<?php
/**
 * get_reservations.php — Reads reservations in one of two modes.
 *
 * MODE A — a spot's schedule (public):
 *   GET /get_reservations.php?spot_id=3
 *   Returns every non-cancelled window that hasn't finished yet.
 *   Deliberately omits licence plates and prices: this is other people's
 *   data, and the caller only needs to know WHEN the bay is busy.
 *
 * MODE B — a driver's own bookings (semi-private):
 *   GET /get_reservations.php?license_plate=ZR-123-AB
 *   Returns full detail plus a `can_cancel` flag per reservation.
 *
 * Optional on both: &include_past=1 to also return finished reservations.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    json_error('Method not allowed. Use GET.', 405);
}

$rawSpotId = $_GET['spot_id'] ?? null;
$rawPlate  = $_GET['license_plate'] ?? null;

$hasSpotId = is_string($rawSpotId) && trim($rawSpotId) !== '';
$hasPlate  = is_string($rawPlate) && trim($rawPlate) !== '';

if ($hasSpotId === $hasPlate) {
    json_error('Provide exactly one of spot_id or license_plate.', 400);
}

$includePast = filter_var($_GET['include_past'] ?? false, FILTER_VALIDATE_BOOLEAN);

// Finished reservations are hidden unless explicitly requested. Cancelled ones
// are always hidden in spot mode — they no longer block the bay.
$timeFilter = $includePast ? '' : ' AND r.end_time > CURRENT_TIMESTAMP';

// ------------------------------------------------------------
// Mode A — schedule for one spot
// ------------------------------------------------------------
if ($hasSpotId) {
    $spotId = filter_var($rawSpotId, FILTER_VALIDATE_INT);

    if ($spotId === false || $spotId < 1) {
        json_error('spot_id must be a positive integer.', 400);
    }

    try {
        $stmt = $pdo->prepare('SELECT id, spot_number, spot_type, hourly_rate FROM parking_spots WHERE id = :id');
        $stmt->execute([':id' => $spotId]);
        $spot = $stmt->fetch();

        if ($spot === false) {
            json_error('Parking spot not found.', 404);
        }

        $stmt = $pdo->prepare(
            "SELECT r.id, r.start_time, r.end_time, r.status
             FROM reservations r
             WHERE r.spot_id = :spot_id
               AND r.status <> 'cancelled'
               {$timeFilter}
             ORDER BY r.start_time"
        );
        $stmt->execute([':spot_id' => $spotId]);
        $rows = $stmt->fetchAll();
    } catch (PDOException $e) {
        error_log('[parkolo] spot schedule query failed: ' . $e->getMessage());
        json_error('Could not load the schedule for this spot.', 500);
    }

    $slots = array_map(static fn (array $r): array => [
        'id'         => (int) $r['id'],
        'start_time' => $r['start_time'],
        'end_time'   => $r['end_time'],
        'status'     => $r['status'],
    ], $rows);

    json_response([
        'success' => true,
        'mode'    => 'spot',
        'spot'    => [
            'id'          => (int) $spot['id'],
            'spot_number' => $spot['spot_number'],
            'spot_type'   => $spot['spot_type'],
            'hourly_rate' => (float) $spot['hourly_rate'],
        ],
        'count'   => count($slots),
        'data'    => $slots,
    ]);
}

// ------------------------------------------------------------
// Mode B — bookings for one licence plate
// ------------------------------------------------------------
$plate = normalize_plate((string) $rawPlate);

if ($plate === null) {
    json_error('license_plate may contain only letters, digits, spaces and hyphens (2–15 characters).', 400);
}

try {
    $stmt = $pdo->prepare(
        "SELECT
             r.id,
             r.spot_id,
             s.spot_number,
             s.spot_type,
             r.license_plate,
             r.start_time,
             r.end_time,
             r.total_price,
             r.discount_type,
             r.status,
             r.is_paid,
             r.created_at,
             -- Same rule the cancel endpoint enforces, so the UI and the
             -- server never disagree about what's cancellable.
             (r.status = 'confirmed' AND r.start_time > CURRENT_TIMESTAMP) AS can_cancel
         FROM reservations r
         JOIN parking_spots s ON s.id = r.spot_id
         WHERE r.license_plate = :plate
           {$timeFilter}
         ORDER BY r.start_time"
    );
    $stmt->execute([':plate' => $plate]);
    $rows = $stmt->fetchAll();
} catch (PDOException $e) {
    error_log('[parkolo] plate lookup failed: ' . $e->getMessage());
    json_error('Could not load reservations for this plate.', 500);
}

$reservations = array_map(static fn (array $r): array => [
    'id'            => (int) $r['id'],
    'spot_id'       => (int) $r['spot_id'],
    'spot_number'   => $r['spot_number'],
    'spot_type'     => $r['spot_type'],
    'license_plate' => $r['license_plate'],
    'start_time'    => $r['start_time'],
    'end_time'      => $r['end_time'],
    'total_price'   => (float) $r['total_price'],
    'discount_type' => $r['discount_type'],
    'status'        => $r['status'],
    'is_paid'       => pg_bool($r['is_paid']),
    'created_at'    => $r['created_at'],
    'can_cancel'    => pg_bool($r['can_cancel']),
], $rows);

json_response([
    'success'       => true,
    'mode'          => 'plate',
    'license_plate' => $plate,
    'count'         => count($reservations),
    'data'          => $reservations,
]);