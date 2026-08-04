<?php
/**
 * pricing.php — Pure business rules for reservation pricing.
 *
 * Deliberately free of side effects: no headers, no database, no output.
 * That's what makes it unit-testable in isolation. Anything needing a
 * connection or a clock belongs in the endpoint, not here.
 */

declare(strict_types=1);

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
// Rules
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
    if (!array_key_exists($requested, DISCOUNT_RATES)) {
        $requested = 'none';
    }

    if (!qualifies_for_evening($start, $end)) {
        return $requested;
    }

    return DISCOUNT_RATES['evening'] >= DISCOUNT_RATES[$requested] ? 'evening' : $requested;
}

/** Billing is per started hour: 61 minutes costs the same as 2 hours. */
function billable_hours(int $durationSeconds): int
{
    return max(1, (int) ceil($durationSeconds / 3600));
}

/** True when the duration exceeds the 7-day cap. */
function exceeds_max_duration(int $durationSeconds): bool
{
    return $durationSeconds > MAX_RESERVATION_SECONDS;
}

/**
 * Full price breakdown for a booking.
 *
 * @return array{
 *     billable_hours:int, subtotal:float, requested_discount:string,
 *     discount_type:string, discount_rate:float, discount_sum:float,
 *     auto_evening:bool, total_price:float
 * }
 */
function quote_price(
    float $hourlyRate,
    DateTimeImmutable $start,
    DateTimeImmutable $end,
    string $requestedDiscount
): array {
    $durationSeconds = $end->getTimestamp() - $start->getTimestamp();
    $hours           = billable_hours($durationSeconds);

    $discountType = resolve_discount($requestedDiscount, $start, $end);
    $discountRate = DISCOUNT_RATES[$discountType];

    $subtotal    = round($hourlyRate * $hours, 2);
    $discountSum = round($subtotal * $discountRate, 2);

    return [
        'billable_hours'     => $hours,
        'subtotal'           => $subtotal,
        'requested_discount' => $requestedDiscount,
        'discount_type'      => $discountType,
        'discount_rate'      => $discountRate,
        'discount_sum'       => $discountSum,
        'auto_evening'       => $discountType === 'evening' && $requestedDiscount !== 'evening',
        'total_price'        => round($subtotal - $discountSum, 2),
    ];
}