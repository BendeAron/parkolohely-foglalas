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
 *   "start_time":    "2026-08-03 20:00:00",
 *   "end_time":      "2026-08-04 02:00:00",
 *   "discount_type": "student"          // optional: none | student | senior
 * }
 *
 * Business rules enforced here:
 *   1. start_time must not be in the past
 *   2. a reservation may not exceed 7 days
 *   3. the evening discount is applied automatically — never client-selected
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

/**
 * What a client is allowed to ask for. 'evening' is deliberately absent —
 * the server decides that one from the booking's times.
 */
const SELECTABLE_DISCOUNTS = ['none', 'student', 'senior'];

/** The overnight window, inclusive at both edges: 18:00 → 06:00 next day. */
const EVENING_WINDOW_START_HOUR = 18;
const EVENING_WINDOW_END_HOUR   = 6;

/** Longest single booking. */
const MAX_RESERVATION_SECONDS = 7 * 24 * 3600;

/**
 * Slack for "not in the past", in seconds.
 *
 * A picker that rounds to the minute means a driver booking "right now"
 * submits a start_time a few seconds behind the server clock, which would
 * fail a strict comparison. Set this to 0 for literal `start_time <
 * CURRENT_TIMESTAMP` semantics.
 */
const PAST_START_GRACE_SECONDS = 60;

// ------------------------------------------------------------
// Rule 3 — evening eligibility
// ------------------------------------------------------------

/**
 * True when the entire interval sits inside a single 18:00 → 06:00 window.
 *
 * Implemented as: is the start inside the window, and does the duration fit
 * in what's left of it? Anything longer than 12 hours can never qualify,
 * which the arithmetic handles without a special case.
 */
function qualifies_for_evening(DateTimeImmutable $start, DateTimeImmutable $end): bool
{
    $durationMinutes = (int) round(($end->getTimestamp() - $start->getTimestamp()) / 60);

    if ($durationMinutes <= 0) {
        return false;
    }

    $startMinutes = ((int) $start->format('G')) * 60 + ((int) $start->format('i'));

    $eveningOpens  = EVENING_WINDOW_START_HOUR * 60;   // 18:00 → 1080
    $morningCloses = EVENING_WINDOW_END_HOUR * 60;     // 06:00 → 360

    if ($startMinutes >= $eveningOpens) {
        // Evening side: the window runs to 06:00 the following day.
        $minutesLeftInWindow = (24 * 60 + $morningCloses) - $startMinutes;
    } elseif ($startMinutes <= $morningCloses) {
        // Small-hours side: the window closes at 06:00 today.
        $minutesLeftInWindow = $morningCloses - $startMinutes;
    } else {
        // Daytime — 06:00 to 18:00 is never eligible.
        return false;
    }

    return $durationMinutes <= $minutesLeftInWindow;
}

/**
 * Pick the discount that actually applies.
 *
 * The evening rate is granted automatically whenever the times qualify, and
 * wins whenever it's worth at least as much as what the driver asked for.
 * Swap the comparison here if you'd rather the manual choice take priority.
 */
function resolve_discount(string $requested, DateTimeImmutable $start, DateTimeImmutable $end): string
{
    if (!qualifies_for_evening($start, $end)) {
        return $requested;
    }

    return DISCOUNT_RATES['evening'] >= DISCOUNT_RATES[$requested] ? 'evening' : $requested;
}

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
} catch (JsonException) {
    json_error('Malformed JSON body.', 400);
}

if (!is_array($input)) {
    json_error('JSON body must be an object.', 400);
}

// ------------------------------------------------------------
// 2. Required field validation
// ------------------------------------------------------------

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
$licensePlate = normalize_plate((string) $input['license_plate']);

if ($licensePlate === null) {
    json_error('license_plate may contain only letters, digits, spaces and hyphens (2–15 characters).', 400);
}

// --- start_time / end_time ---
$startTime = parse_timestamp((string) $input['start_time']);
$endTime   = parse_timestamp((string) $input['end_time']);

if ($startTime === null || $endTime === null) {
    json_error('Invalid timestamp format. Expected e.g. 2026-08-03 20:00:00.', 400);
}

$start = new DateTimeImmutable($startTime);
$end   = new DateTimeImmutable($endTime);

if ($end <= $start) {
    json_error('end_time must be strictly later than start_time.', 400);
}

// --- RULE 1: no bookings that start in the past ---
// CURRENT_TIMESTAMP is the reference, not PHP's clock, so the app server and
// the database can never disagree about what "now" is.
try {
    $stmt = $pdo->prepare(
        'SELECT
             (:start_time::timestamp + make_interval(secs => :grace)) < CURRENT_TIMESTAMP AS in_past,
             EXTRACT(EPOCH FROM (:end_time::timestamp - :start_time::timestamp)) AS duration_seconds'
    );
    $stmt->execute([
        ':start_time' => $startTime,
        ':end_time'   => $endTime,
        ':grace'      => PAST_START_GRACE_SECONDS,
    ]);
    $clock = $stmt->fetch();
} catch (PDOException $e) {
    error_log('[parkolo] time validation failed: ' . $e->getMessage());
    json_error('Could not validate the reservation times.', 500);
}

if (pg_bool($clock['in_past'])) {
    json_error('Reservations cannot start in the past.', 400);
}

// --- RULE 2: 7 days maximum ---
$durationSeconds = (int) $clock['duration_seconds'];

if ($durationSeconds > MAX_RESERVATION_SECONDS) {
    json_error('Reservations cannot exceed 7 days.', 400);
}

// --- discount_type (client request only; the server decides the final value) ---
$requestedDiscount = strtolower(trim((string) ($input['discount_type'] ?? 'none')));

if ($requestedDiscount === '') {
    $requestedDiscount = 'none';
}

// A client sending 'evening' is using an old build. Treat it as no request
// rather than an error — the automatic rule below grants it if it's earned.
if ($requestedDiscount === 'evening') {
    $requestedDiscount = 'none';
}

if (!in_array($requestedDiscount, SELECTABLE_DISCOUNTS, true)) {
    json_error(
        'Invalid discount_type. Allowed: ' . implode(', ', SELECTABLE_DISCOUNTS)
        . '. The evening discount is applied automatically.',
        400
    );
}

// --- RULE 3: evening applied automatically ---
$discountType = resolve_discount($requestedDiscount, $start, $end);
$autoEvening  = $discountType === 'evening' && $requestedDiscount !== 'evening';

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

if (!pg_bool($spot['is_active'])) {
    json_error('This parking spot is not currently available for booking.', 409);
}

// ------------------------------------------------------------
// 4. Price calculation
// ------------------------------------------------------------
// Billing is per started hour: 61 minutes costs the same as 2 hours.
$billableHours = max(1, (int) ceil($durationSeconds / 3600));

$hourlyRate   = (float) $spot['hourly_rate'];
$subtotal     = round($hourlyRate * $billableHours, 2);
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
        'reservation_id'     => (int) $created['id'],
        'spot_id'            => $spotId,
        'spot_number'        => $spot['spot_number'],
        'license_plate'      => $licensePlate,
        'start_time'         => $startTime,
        'end_time'           => $endTime,
        'billable_hours'     => $billableHours,
        'hourly_rate'        => $hourlyRate,
        'subtotal'           => $subtotal,
        'requested_discount' => $requestedDiscount,
        'discount_type'      => $discountType,
        'discount_rate'      => $discountRate,
        'discount_sum'       => $discountSum,
        'auto_evening'       => $autoEvening,
        'total_price'        => $totalPrice,
        'status'             => $created['status'],
        'is_paid'            => pg_bool($created['is_paid']),
        'created_at'         => $created['created_at'],
    ],
], 201);