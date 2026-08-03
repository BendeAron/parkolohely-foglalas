<?php
/**
 * create_reservation.php — Creates a new parking reservation.
 *
 * POST /create_reservation.php
 * Content-Type: application/json
 *
 * {
 *   "spot_id":       3,
 *   "license_plate": "ZR-123-AB",
 *   "start_time":    "2026-08-03 10:00:00",
 *   "end_time":      "2026-08-03 14:00:00",
 *   "discount_type": "student"          // optional, defaults to "none"
 * }
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

/** Discount rate applied to the subtotal, keyed by discount_type. */
const DISCOUNT_RATES = [
    'none'    => 0.00,
    'student' => 0.15,
    'senior'  => 0.20,
    'evening' => 0.25,
];

/** The 'evening' discount only applies to reservations starting at or after this hour. */
const EVENING_DISCOUNT_FROM_HOUR = 18;

/** Grace period for start times slightly in the past (clock skew between client and server). */
const PAST_START_TOLERANCE_MINUTES = 10;

// ------------------------------------------------------------
// 1. Method guard + JSON body parsing
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
} catch (JsonException $e) {
    json_error('Malformed JSON body.', 400);
}

if (!is_array($input)) {
    json_error('JSON body must be an object.', 400);
}

// ------------------------------------------------------------
// 2. Required field validation
// ------------------------------------------------------------

/**
 * Parse a client-supplied timestamp into PostgreSQL's canonical format.
 * Duplicated from get_spots.php — move this into db.php (or a helpers.php)
 * once you have a third endpoint that needs it.
 */
if (!function_exists('parse_timestamp')) {
    function parse_timestamp(string $value): ?string
    {
        $value = trim($value);

        if ($value === '') {
            return null;
        }

        foreach (['Y-m-d H:i:s', 'Y-m-d\TH:i:s', 'Y-m-d\TH:i', 'Y-m-d H:i'] as $format) {
            $dt     = DateTime::createFromFormat($format, $value);
            $errors = DateTime::getLastErrors();
            $clean  = $errors === false
                || ($errors['warning_count'] === 0 && $errors['error_count'] === 0);

            if ($dt instanceof DateTime && $clean) {
                return $dt->format('Y-m-d H:i:s');
            }
        }

        try {
            return (new DateTimeImmutable($value))->format('Y-m-d H:i:s');
        } catch (Exception) {
            return null;
        }
    }
}

// Collect every missing field in one pass so the client gets a complete
// picture instead of fixing one field per round-trip.
$required = ['spot_id', 'license_plate', 'start_time', 'end_time'];
$missing  = [];

foreach ($required as $field) {
    $value = $input[$field] ?? null;

    if ($value === null || (is_string($value) && trim($value) === '')) {
        $missing[] = $field;
    }
}

if ($missing !== []) {
    json_error('Missing required field(s): ' . implode(', ', $missing) . '.', 400);
}

// --- spot_id ---
$spotId = filter_var($input['spot_id'], FILTER_VALIDATE_INT);

if ($spotId === false || $spotId < 1) {
    json_error('spot_id must be a positive integer.', 400);
}

// --- license_plate ---
// Normalise to uppercase and collapse whitespace so 'zr 123 ab' and
// 'ZR 123 AB' don't become two different records.
$licensePlate = strtoupper(trim((string) $input['license_plate']));
$licensePlate = (string) preg_replace('/\s+/', ' ', $licensePlate);

if (mb_strlen($licensePlate) > 15) {
    json_error('license_plate must be 15 characters or fewer.', 400);
}

if (!preg_match('/^[A-Z0-9 \-]{2,15}$/u', $licensePlate)) {
    json_error('license_plate may contain only letters, digits, spaces and hyphens.', 400);
}

// --- start_time / end_time ---
$startTime = parse_timestamp((string) $input['start_time']);
$endTime   = parse_timestamp((string) $input['end_time']);

if ($startTime === null || $endTime === null) {
    json_error('Invalid timestamp format. Expected e.g. 2026-08-03 10:00:00.', 400);
}

$start = new DateTimeImmutable($startTime);
$end   = new DateTimeImmutable($endTime);

if ($end <= $start) {
    json_error('end_time must be strictly later than start_time.', 400);
}

$earliestAllowed = (new DateTimeImmutable())->modify('-' . PAST_START_TOLERANCE_MINUTES . ' minutes');

if ($start < $earliestAllowed) {
    json_error('start_time cannot be in the past.', 400);
}

// --- discount_type ---
$discountType = strtolower(trim((string) ($input['discount_type'] ?? 'none')));

if ($discountType === '') {
    $discountType = 'none';
}

if (!array_key_exists($discountType, DISCOUNT_RATES)) {
    json_error(
        'Invalid discount_type. Allowed: ' . implode(', ', array_keys(DISCOUNT_RATES)) . '.',
        400
    );
}

// The evening discount is time-conditional — reject rather than silently
// downgrading to 'none', so the client can show an accurate price.
if ($discountType === 'evening' && (int) $start->format('G') < EVENING_DISCOUNT_FROM_HOUR) {
    json_error(
        'The evening discount applies only to reservations starting at or after '
        . EVENING_DISCOUNT_FROM_HOUR . ':00.',
        400
    );
}

// ------------------------------------------------------------
// 3. Look up the spot
// ------------------------------------------------------------
try {
    $stmt = $pdo->prepare(
        'SELECT id, spot_number, hourly_rate, is_active
         FROM parking_spots
         WHERE id = :spot_id'
    );
    $stmt->execute([':spot_id' => $spotId]);
    $spot = $stmt->fetch();
} catch (PDOException $e) {
    error_log('[parkolo] spot lookup failed: ' . $e->getMessage());
    json_error('Could not verify the parking spot.', 500);
}

if ($spot === false) {
    json_error('Parking spot not found.', 404);
}

if (!filter_var($spot['is_active'], FILTER_VALIDATE_BOOLEAN)) {
    json_error('This parking spot is not currently available for booking.', 409);
}

// ------------------------------------------------------------
// 4. Price calculation
// ------------------------------------------------------------
// Billing is per started hour: 61 minutes costs the same as 2 hours.
$durationSeconds = $end->getTimestamp() - $start->getTimestamp();
$billableHours   = (int) ceil($durationSeconds / 3600);
$billableHours   = max(1, $billableHours);

$hourlyRate   = (float) $spot['hourly_rate'];
$subtotal     = $hourlyRate * $billableHours;
$discountRate = DISCOUNT_RATES[$discountType];
$discountSum  = round($subtotal * $discountRate, 2);
$totalPrice   = round($subtotal - $discountSum, 2);

// ------------------------------------------------------------
// 5. Insert
// ------------------------------------------------------------
// No SELECT-then-INSERT availability check here on purpose: that pattern
// has a race window between the two statements. The exclusion constraint
// on `reservations` is the single source of truth, and we handle its
// rejection below.
try {
    $stmt = $pdo->prepare(
        "INSERT INTO reservations
             (spot_id, license_plate, start_time, end_time,
              total_price, discount_type, status, is_paid)
         VALUES
             (:spot_id, :license_plate, :start_time::timestamp, :end_time::timestamp,
              :total_price, :discount_type, 'confirmed', false)
         RETURNING id, created_at, status, is_paid"
    );

    $stmt->execute([
        ':spot_id'       => $spotId,
        ':license_plate' => $licensePlate,
        ':start_time'    => $startTime,
        ':end_time'      => $endTime,
        ':total_price'   => number_format($totalPrice, 2, '.', ''),
        ':discount_type' => $discountType,
    ]);

    $created = $stmt->fetch();
} catch (PDOException $e) {
    // SQLSTATE 23P01 — exclusion_violation, raised by excl_reservations_no_overlap.
    if ($e->getCode() === '23P01') {
        json_error('This spot is already reserved for the selected time window.', 409);
    }

    // SQLSTATE 23503 — foreign key violation (spot deleted between lookup and insert).
    if ($e->getCode() === '23503') {
        json_error('Parking spot no longer exists.', 409);
    }

    // SQLSTATE 23514 — check constraint violation (defensive; validated above).
    if ($e->getCode() === '23514') {
        json_error('Reservation violates a database constraint.', 400);
    }

    error_log('[parkolo] reservation insert failed: ' . $e->getMessage());
    json_error('Could not create the reservation.', 500);
}

// ------------------------------------------------------------
// 6. Respond
// ------------------------------------------------------------
json_response([
    'success'        => true,
    'reservation_id' => (int) $created['id'],
    'total_price'    => $totalPrice,
    'data'           => [
        'reservation_id' => (int) $created['id'],
        'spot_id'        => $spotId,
        'spot_number'    => $spot['spot_number'],
        'license_plate'  => $licensePlate,
        'start_time'     => $startTime,
        'end_time'       => $endTime,
        'billable_hours' => $billableHours,
        'hourly_rate'    => $hourlyRate,
        'subtotal'       => round($subtotal, 2),
        'discount_type'  => $discountType,
        'discount_rate'  => $discountRate,
        'discount_sum'   => $discountSum,
        'total_price'    => $totalPrice,
        'status'         => $created['status'],
        'is_paid'        => filter_var($created['is_paid'], FILTER_VALIDATE_BOOLEAN),
        'created_at'     => $created['created_at'],
    ],
], 201);