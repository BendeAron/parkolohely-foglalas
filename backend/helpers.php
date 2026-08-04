<?php
/**
 * helpers.php — Shared utilities for every endpoint.
 *
 * Loaded by db.php, so requiring db.php is enough.
 */

declare(strict_types=1);

/**
 * Parse a client-supplied timestamp into PostgreSQL's canonical format.
 * Accepts 'Y-m-d H:i:s', 'Y-m-d\TH:i' and full ISO 8601 (what
 * JavaScript's Date.toISOString() produces).
 *
 * @return string|null null when the value cannot be parsed
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

            // createFromFormat is lenient about impossible dates (2026-02-31),
            // so confirm no warnings or errors were raised.
            $clean = $errors === false
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

/**
 * Normalise a PostgreSQL boolean into a real PHP bool.
 *
 * pdo_pgsql returns booleans as native bools on some builds and as the
 * strings 't'/'f' on others. filter_var() recognises neither 't' nor 'f',
 * so it silently returns false for both — use this instead.
 */
if (!function_exists('pg_bool')) {
    function pg_bool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return $value === 't' || $value === 'true' || $value === '1' || $value === 1;
    }
}

/**
 * Normalise and validate a licence plate.
 *
 * @return string|null null when the plate is not in an acceptable shape
 */
if (!function_exists('normalize_plate')) {
    function normalize_plate(string $value): ?string
    {
        $plate = strtoupper(trim($value));
        $plate = (string) preg_replace('/\s+/', ' ', $plate);

        if (!preg_match('/^[A-Z0-9 \-]{2,15}$/u', $plate)) {
            return null;
        }

        return $plate;
    }
}