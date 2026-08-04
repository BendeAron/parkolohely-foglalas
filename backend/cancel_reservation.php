<?php
/**
 * cancel_reservation.php — Cancels an upcoming reservation.
 *
 * POST /cancel_reservation.php
 * Content-Type: application/json
 *
 * {
 *   "license_plate":  "ZR-123-AB",
 *   "reservation_id": 42          // optional when the plate has exactly one
 * }                               // cancellable booking
 *
 * Business rule: a reservation may be cancelled only while it is still
 * 'confirmed' AND its start_time is strictly in the future. Once it has
 * started (status 'active') or finished, it is locked.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

// ------------------------------------------------------------
// 1. Method guard + body parsing
// ------------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    json_error('Method not allowed. Use POST.', 405);
}

$rawBody = file_get_contents('php://input');

if ($rawBody === false || trim($rawBody) === '') {
    json_error('Request body is empty. Expected a JSON payload.', 400);
}

try {
    $input = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException) {
    json_error('Malformed JSON body.', 400);
}

if (!is_array($input)) {
    json_error('JSON body must be an object.', 400);
}

// ------------------------------------------------------------
// 2. Validation
// ------------------------------------------------------------
$rawPlate = $input['license_plate'] ?? null;

if (!is_string($rawPlate) || trim($rawPlate) === '') {
    json_error('Missing required field: license_plate.', 400);
}

$plate = normalize_plate($rawPlate);

if ($plate === null) {
    json_error('license_plate may contain only letters, digits, spaces and hyphens (2–15 characters).', 400);
}

$reservationId = null;

if (array_key_exists('reservation_id', $input) && $input['reservation_id'] !== null) {
    $reservationId = filter_var($input['reservation_id'], FILTER_VALIDATE_INT);

    if ($reservationId === false || $reservationId < 1) {
        json_error('reservation_id must be a positive integer.', 400);
    }
}

// ------------------------------------------------------------
// 3. Locate and cancel
// ------------------------------------------------------------
// Everything runs inside one transaction with SELECT ... FOR UPDATE so a
// concurrent request can't flip the row to 'active' between the eligibility
// check and the UPDATE.
try {
    $pdo->beginTransaction();

    if ($reservationId !== null) {
        // Explicit target. Matching on plate too means a caller can't cancel
        // someone else's booking by guessing an ID.
        $stmt = $pdo->prepare(
            'SELECT r.id, r.spot_id, s.spot_number, r.start_time, r.end_time,
                    r.status, r.total_price
             FROM reservations r
             JOIN parking_spots s ON s.id = r.spot_id
             WHERE r.id = :id AND r.license_plate = :plate
             FOR UPDATE OF r'
        );
        $stmt->execute([':id' => $reservationId, ':plate' => $plate]);
        $target = $stmt->fetch();

        if ($target === false) {
            $pdo->rollBack();
            json_error('No reservation found with that ID for this licence plate.', 404);
        }
    } else {
        // No ID supplied — resolve it, but only if the answer is unambiguous.
        $stmt = $pdo->prepare(
            "SELECT r.id, r.spot_id, s.spot_number, r.start_time, r.end_time,
                    r.status, r.total_price
             FROM reservations r
             JOIN parking_spots s ON s.id = r.spot_id
             WHERE r.license_plate = :plate
               AND r.status = 'confirmed'
               AND r.start_time > CURRENT_TIMESTAMP
             ORDER BY r.start_time
             FOR UPDATE OF r"
        );
        $stmt->execute([':plate' => $plate]);
        $candidates = $stmt->fetchAll();

        if (count($candidates) === 0) {
            $pdo->rollBack();
            json_error('No cancellable reservations found for this licence plate.', 404);
        }

        if (count($candidates) > 1) {
            $pdo->rollBack();

            json_response([
                'success' => false,
                'error'   => 'This plate has several cancellable reservations. Send reservation_id to pick one.',
                'options' => array_map(static fn (array $r): array => [
                    'reservation_id' => (int) $r['id'],
                    'spot_number'    => $r['spot_number'],
                    'start_time'     => $r['start_time'],
                    'end_time'       => $r['end_time'],
                ], $candidates),
            ], 409);
        }

        $target = $candidates[0];
    }

    // --- Eligibility ---
    if ($target['status'] === 'cancelled') {
        $pdo->rollBack();
        json_error('This reservation has already been cancelled.', 409);
    }

    if ($target['status'] !== 'confirmed') {
        $pdo->rollBack();
        json_error(
            "This reservation is already {$target['status']} and can no longer be cancelled.",
            400
        );
    }

    // Compare in the database rather than in PHP so there's a single clock.
    $stmt = $pdo->prepare('SELECT :start_time::timestamp > CURRENT_TIMESTAMP AS in_future');
    $stmt->execute([':start_time' => $target['start_time']]);
    $inFuture = pg_bool($stmt->fetchColumn());

    if (!$inFuture) {
        $pdo->rollBack();
        json_error(
            'This reservation has already started and can no longer be cancelled.',
            400
        );
    }

    // --- Cancel ---
    // The WHERE clause repeats the rule so the UPDATE is a no-op if anything
    // changed underneath us. Belt and braces alongside FOR UPDATE.
    $stmt = $pdo->prepare(
        "UPDATE reservations
         SET status = 'cancelled'
         WHERE id = :id
           AND status = 'confirmed'
           AND start_time > CURRENT_TIMESTAMP
         RETURNING id, spot_id, start_time, end_time, total_price, status"
    );
    $stmt->execute([':id' => $target['id']]);
    $cancelled = $stmt->fetch();

    if ($cancelled === false) {
        $pdo->rollBack();
        json_error('This reservation is no longer cancellable. Refresh and try again.', 409);
    }

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    error_log('[parkolo] cancellation failed: ' . $e->getMessage());
    json_error('Could not cancel the reservation.', 500);
}

// ------------------------------------------------------------
// 4. Respond
// ------------------------------------------------------------
json_response([
    'success'        => true,
    'reservation_id' => (int) $cancelled['id'],
    'status'         => $cancelled['status'],
    'data'           => [
        'reservation_id' => (int) $cancelled['id'],
        'spot_id'        => (int) $cancelled['spot_id'],
        'spot_number'    => $target['spot_number'],
        'license_plate'  => $plate,
        'start_time'     => $cancelled['start_time'],
        'end_time'       => $cancelled['end_time'],
        'refund_due'     => (float) $cancelled['total_price'],
        'status'         => $cancelled['status'],
    ],
]);