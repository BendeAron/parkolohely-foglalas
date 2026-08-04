# API Reference

Parking Spot Reservation System — PHP + PostgreSQL backend.

|                    |                                              |
| ------------------ | -------------------------------------------- |
| **Base URL**       | `http://localhost:8000`                      |
| **Content-Type**   | `application/json` (required on `POST`)      |
| **Authentication** | None — see [Authentication](#authentication) |
| **Encoding**       | UTF-8                                        |

---

## Table of contents

- [Conventions](#conventions)
- [Endpoints](#endpoints)
  - [`GET /get_spots.php`](#get-get_spotsphp)
  - [`GET /get_reservations.php`](#get-get_reservationsphp)
  - [`POST /create_reservation.php`](#post-create_reservationphp)
  - [`POST /cancel_reservation.php`](#post-cancel_reservationphp)
- [Business rules](#business-rules)
- [Error handling](#error-handling)
- [Data types](#data-types)

---

## Conventions

### Response envelope

Every response is JSON and carries a `success` boolean.

**Success:**

```json
{
  "success": true,
  "data": {}
}
```

Top-level convenience fields (`reservation_id`, `total_price`, `count`) are
duplicated alongside `data` on some endpoints so simple clients don't have to
traverse into it.

**Error:**

```json
{
  "success": false,
  "error": "Human-readable reason."
}
```

`error` is safe to display directly to an end user. A `detail` field carrying the
underlying exception message appears **only** when the server runs with
`APP_DEBUG=true`; never rely on it in client code.

### Timestamps

Accepted input formats:

| Format         | Example                     |
| -------------- | --------------------------- |
| `Y-m-d H:i:s`  | `2026-08-03 20:00:00`       |
| `Y-m-d H:i`    | `2026-08-03 20:00`          |
| `Y-m-d\TH:i`   | `2026-08-03T20:00`          |
| `Y-m-d\TH:i:s` | `2026-08-03T20:00:00`       |
| ISO 8601       | `2026-08-03T20:00:00+02:00` |

All are normalised to `Y-m-d H:i:s` before use. Responses always return that
format.

> **Time zones.** Columns are `TIMESTAMP WITHOUT TIME ZONE` — naive local wall
> clock. An ISO string with an offset is accepted but its offset is discarded, not
> converted. Send local time. In particular, do **not** use JavaScript's
> `Date.toISOString()`, which converts to UTC and will shift every booking.

### CORS

All endpoints send:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
```

`OPTIONS` preflight requests return `204 No Content` with no body.

### Authentication

There is none. The licence plate acts as the sole identifier for reading and
cancelling bookings, which means anyone who knows a plate can act on it. Adequate
for a local or trusted-lot deployment; not for public use. See
[Security considerations](#security-considerations).

---

## Endpoints

### `GET /get_spots.php`

Returns every active parking spot, with availability computed against an optional
time window.

#### Query parameters

| Name         | Type   | Required    | Description                   |
| ------------ | ------ | ----------- | ----------------------------- |
| `start_time` | string | Conditional | Start of the window to check. |
| `end_time`   | string | Conditional | End of the window to check.   |

Both must be supplied together or neither. Supplying only one returns `400` —
silently ignoring half a window would produce availability data that looks
authoritative but isn't.

**Without a window,** every spot returns `is_available: true`. This is the full
inventory, not a claim about availability.

**With a window,** `is_available` is `false` when any non-cancelled reservation
overlaps it.

#### Response `200 OK`

```json
{
  "success": true,
  "count": 3,
  "filter": {
    "start_time": "2026-08-03 20:00:00",
    "end_time": "2026-08-03 23:00:00"
  },
  "data": [
    {
      "id": 1,
      "spot_number": "A-01",
      "spot_type": "standard",
      "hourly_rate": 2.5,
      "is_active": true,
      "is_available": false
    },
    {
      "id": 2,
      "spot_number": "A-02",
      "spot_type": "electric",
      "hourly_rate": 4.0,
      "is_active": true,
      "is_available": true
    },
    {
      "id": 3,
      "spot_number": "B-01",
      "spot_type": "handicapped",
      "hourly_rate": 1.5,
      "is_active": true,
      "is_available": true
    }
  ]
}
```

`filter` echoes back the window the availability reflects, so a client can confirm
what it's looking at. Both values are `null` when no window was supplied.

Inactive spots (`is_active = false`) are excluded from the list entirely.

#### Errors

| Status | Condition                                      |
| ------ | ---------------------------------------------- |
| `400`  | Only one of `start_time` / `end_time` supplied |
| `400`  | Unparseable timestamp                          |
| `400`  | `end_time` not later than `start_time`         |
| `405`  | Method other than `GET`                        |
| `500`  | Query failure                                  |

#### Example

```bash
curl -G http://localhost:8000/get_spots.php \
  --data-urlencode "start_time=2026-08-03 20:00:00" \
  --data-urlencode "end_time=2026-08-03 23:00:00"
```

---

### `GET /get_reservations.php`

Two modes, selected by which parameter you pass. Exactly one is required.

#### Query parameters

| Name            | Type    | Description                                                              |
| --------------- | ------- | ------------------------------------------------------------------------ |
| `spot_id`       | integer | **Mode A** — occupied windows for one spot.                              |
| `license_plate` | string  | **Mode B** — all bookings for one plate.                                 |
| `include_past`  | boolean | Optional. Include reservations that have already ended. Default `false`. |

Passing both, or neither, returns `400`.

---

#### Mode A — spot schedule

`GET /get_reservations.php?spot_id=1`

Returns non-cancelled reservations for the spot that haven't finished yet.

**Deliberately omits licence plates, prices, and discount types.** This is other
people's data, and a caller only needs to know _when_ the bay is busy. Since the
plate is also the credential for cancellation, publishing it here would let anyone
cancel any booking.

##### Response `200 OK`

```json
{
  "success": true,
  "mode": "spot",
  "spot": {
    "id": 1,
    "spot_number": "A-01",
    "spot_type": "standard",
    "hourly_rate": 2.5
  },
  "count": 2,
  "data": [
    {
      "id": 14,
      "start_time": "2026-08-03 20:00:00",
      "end_time": "2026-08-03 23:00:00",
      "status": "active"
    },
    {
      "id": 19,
      "start_time": "2026-08-05 08:00:00",
      "end_time": "2026-08-05 17:00:00",
      "status": "confirmed"
    }
  ]
}
```

Ordered by `start_time` ascending. An empty `data` array means the bay is
completely free.

---

#### Mode B — bookings by plate

`GET /get_reservations.php?license_plate=ZR-123-AB`

Full detail for one plate's bookings, each flagged with `can_cancel`.

##### Response `200 OK`

```json
{
  "success": true,
  "mode": "plate",
  "license_plate": "ZR-123-AB",
  "count": 1,
  "data": [
    {
      "id": 19,
      "spot_id": 1,
      "spot_number": "A-01",
      "spot_type": "standard",
      "license_plate": "ZR-123-AB",
      "start_time": "2026-08-05 08:00:00",
      "end_time": "2026-08-05 17:00:00",
      "total_price": 22.5,
      "discount_type": "none",
      "status": "confirmed",
      "is_paid": false,
      "created_at": "2026-08-04 09:12:44",
      "can_cancel": true
    }
  ]
}
```

`can_cancel` is computed in SQL using the same predicate
`cancel_reservation.php` enforces, so the flag and the endpoint can never
disagree.

#### Errors

| Status | Condition                                               |
| ------ | ------------------------------------------------------- |
| `400`  | Both or neither of `spot_id` / `license_plate` supplied |
| `400`  | `spot_id` not a positive integer                        |
| `400`  | Malformed licence plate                                 |
| `404`  | `spot_id` does not exist                                |
| `405`  | Method other than `GET`                                 |
| `500`  | Query failure                                           |

---

### `POST /create_reservation.php`

Creates a reservation. Validates, prices, and inserts in one call.

#### Headers

```
Content-Type: application/json
```

#### Request body

| Field           | Type    | Required | Description                                                       |
| --------------- | ------- | -------- | ----------------------------------------------------------------- |
| `spot_id`       | integer | Yes      | Must reference an active spot.                                    |
| `license_plate` | string  | Yes      | 2–15 chars: `A–Z`, `0–9`, space, hyphen. Normalised to uppercase. |
| `start_time`    | string  | Yes      | Must not be in the past.                                          |
| `end_time`      | string  | Yes      | Must be strictly later than `start_time`.                         |
| `discount_type` | string  | No       | `none`, `student`, or `senior`. Defaults to `none`.               |

> **`evening` is not accepted as an input.** It is granted automatically when the
> booking qualifies — see [Automatic evening discount](#automatic-evening-discount).
> A request sending `"discount_type": "evening"` is treated as `none` rather than
> rejected, so clients running an older build still work; the automatic rule grants
> the discount back if it's earned.

```json
{
  "spot_id": 1,
  "license_plate": "ZR-123-AB",
  "start_time": "2026-08-03 20:00:00",
  "end_time": "2026-08-03 23:00:00",
  "discount_type": "student"
}
```

#### Response `201 Created`

```json
{
  "success": true,
  "reservation_id": 20,
  "total_price": 5.63,
  "data": {
    "reservation_id": 20,
    "spot_id": 1,
    "spot_number": "A-01",
    "license_plate": "ZR-123-AB",
    "start_time": "2026-08-03 20:00:00",
    "end_time": "2026-08-03 23:00:00",
    "billable_hours": 3,
    "hourly_rate": 2.5,
    "subtotal": 7.5,
    "requested_discount": "student",
    "discount_type": "evening",
    "discount_rate": 0.25,
    "discount_sum": 1.87,
    "auto_evening": true,
    "total_price": 5.63,
    "status": "confirmed",
    "is_paid": false,
    "created_at": "2026-08-04 09:15:02"
  }
}
```

In this example the driver asked for `student` (15%) but the booking runs
20:00–23:00, entirely inside the overnight window, so `evening` (25%) was applied
instead. `requested_discount` records what was asked for and `auto_evening`
flags that the server overrode it — enough for a client to explain the price
change.

#### Errors

| Status | `error`                                                       | Condition                                                                          |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `400`  | `Missing required field(s): …`                                | One or more required fields absent. All missing fields are listed in one response. |
| `400`  | `Invalid timestamp format. …`                                 | Unparseable `start_time` or `end_time`.                                            |
| `400`  | `end_time must be strictly later than start_time.`            | Zero or negative duration.                                                         |
| `400`  | `Reservations cannot start in the past.`                      | `start_time` precedes `CURRENT_TIMESTAMP` (60s grace).                             |
| `400`  | `Reservations cannot exceed 7 days.`                          | Duration over 168 hours.                                                           |
| `400`  | `license_plate may contain only …`                            | Plate fails the character or length rule.                                          |
| `400`  | `spot_id must be a positive integer.`                         | Non-integer or non-positive `spot_id`.                                             |
| `400`  | `Invalid discount_type. Allowed: none, student, senior. …`    | Unrecognised discount.                                                             |
| `400`  | `Malformed JSON body.`                                        | Body isn't valid JSON.                                                             |
| `404`  | `Parking spot not found.`                                     | No spot with that ID.                                                              |
| `409`  | `This spot is already reserved for the selected time window.` | Overlap rejected by the exclusion constraint.                                      |
| `409`  | `This parking spot is not currently available for booking.`   | Spot exists but `is_active = false`.                                               |
| `405`  | `Method not allowed. Use POST.`                               | Wrong method.                                                                      |
| `500`  | `Could not create the reservation.`                           | Unexpected database failure.                                                       |

##### `409` example

```json
{
  "success": false,
  "error": "This spot is already reserved for the selected time window."
}
```

This is the response clients must handle most carefully. Availability from
`get_spots.php` is a snapshot; between reading it and submitting, another driver
may have taken the bay. The correct client response is to show the message and
refetch availability — not to retry.

#### Example

```bash
curl -X POST http://localhost:8000/create_reservation.php \
  -H 'Content-Type: application/json' \
  -d '{
    "spot_id": 1,
    "license_plate": "ZR-123-AB",
    "start_time": "2026-08-03 20:00:00",
    "end_time": "2026-08-03 23:00:00",
    "discount_type": "student"
  }'
```

---

### `POST /cancel_reservation.php`

Cancels an upcoming reservation by setting its status to `cancelled`. The row is
not deleted, and the exclusion constraint ignores cancelled rows, so the slot
frees up immediately.

#### Headers

```
Content-Type: application/json
```

#### Request body

| Field            | Type    | Required | Description                                                                           |
| ---------------- | ------- | -------- | ------------------------------------------------------------------------------------- |
| `license_plate`  | string  | Yes      | The plate the booking was made under.                                                 |
| `reservation_id` | integer | No       | Which booking to cancel. Optional when the plate has exactly one cancellable booking. |

The reservation must match **both** the ID and the plate. Supplying an ID that
belongs to a different plate returns `404`, not `403` — the response is identical
to a non-existent ID, so it can't be used to probe which IDs exist.

> **`spot_id` is not accepted.** A spot has many reservations over time, so
> `spot_id` alone doesn't identify one. Use `reservation_id`, or omit it and let
> the server resolve when the answer is unambiguous.

```json
{
  "license_plate": "ZR-123-AB",
  "reservation_id": 19
}
```

#### Response `200 OK`

```json
{
  "success": true,
  "reservation_id": 19,
  "status": "cancelled",
  "data": {
    "reservation_id": 19,
    "spot_id": 1,
    "spot_number": "A-01",
    "license_plate": "ZR-123-AB",
    "start_time": "2026-08-05 08:00:00",
    "end_time": "2026-08-05 17:00:00",
    "refund_due": 22.5,
    "status": "cancelled"
  }
}
```

`refund_due` is the reservation's `total_price`. No payment processing is
performed — this is informational only.

#### Errors

| Status | `error`                                                                | Condition                                |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------- |
| `400`  | `Missing required field: license_plate.`                               | Plate absent.                            |
| `400`  | `This reservation is already active and can no longer be cancelled.`   | Status has moved past `confirmed`.       |
| `400`  | `This reservation has already started and can no longer be cancelled.` | `start_time` has passed.                 |
| `400`  | `license_plate may contain only …`                                     | Malformed plate.                         |
| `404`  | `No reservation found with that ID for this licence plate.`            | ID/plate mismatch, or no such ID.        |
| `404`  | `No cancellable reservations found for this licence plate.`            | No ID given and nothing eligible.        |
| `409`  | `This plate has several cancellable reservations. …`                   | No ID given and the choice is ambiguous. |
| `409`  | `This reservation has already been cancelled.`                         | Already cancelled.                       |
| `405`  | `Method not allowed. Use POST.`                                        | Wrong method.                            |
| `500`  | `Could not cancel the reservation.`                                    | Unexpected database failure.             |

##### `409` ambiguous — with options

When `reservation_id` is omitted and several bookings qualify, the response lists
them so the client can prompt:

```json
{
  "success": false,
  "error": "This plate has several cancellable reservations. Send reservation_id to pick one.",
  "options": [
    {
      "reservation_id": 19,
      "spot_number": "A-01",
      "start_time": "2026-08-05 08:00:00",
      "end_time": "2026-08-05 17:00:00"
    },
    {
      "reservation_id": 23,
      "spot_number": "B-04",
      "start_time": "2026-08-07 09:00:00",
      "end_time": "2026-08-07 12:00:00"
    }
  ]
}
```

#### Example

```bash
curl -X POST http://localhost:8000/cancel_reservation.php \
  -H 'Content-Type: application/json' \
  -d '{"license_plate": "ZR-123-AB", "reservation_id": 19}'
```

---

## Business rules

### Pricing

Charged **per started hour**: duration is rounded up, minimum one hour. A 61-minute
booking costs the same as two hours.

```
billable_hours = max(1, ceil(duration_seconds / 3600))
subtotal       = hourly_rate × billable_hours
discount_sum   = round(subtotal × discount_rate, 2)
total_price    = subtotal − discount_sum
```

| `discount_type` | Rate | Applied                  |
| --------------- | ---- | ------------------------ |
| `none`          | 0%   | Default                  |
| `student`       | 15%  | Client-selected          |
| `senior`        | 20%  | Client-selected          |
| `evening`       | 25%  | **Server-computed only** |

### Automatic evening discount

A booking qualifies when its **entire** interval falls inside one 18:00 → 06:00
overnight window. Both boundaries are **inclusive**: `18:00 → 06:00` qualifies.

| Booking       | Qualifies | Why                                       |
| ------------- | --------- | ----------------------------------------- |
| 20:00 → 23:00 | Yes       | Wholly inside the evening side            |
| 18:00 → 06:00 | Yes       | Exactly the window                        |
| 22:00 → 02:00 | Yes       | Crossing midnight is fine                 |
| 01:00 → 05:00 | Yes       | Wholly inside the small-hours side        |
| 17:59 → 20:00 | No        | Starts before 18:00                       |
| 20:00 → 07:00 | No        | Ends after 06:00                          |
| 10:00 → 14:00 | No        | Daytime                                   |
| 06:00 → 07:00 | No        | 06:00 is the window's close, not its open |

Because the window is 12 hours long, nothing longer than 12 hours can ever
qualify.

**Interaction with manual discounts:** the larger discount wins. Since `evening`
(25%) exceeds both `student` and `senior`, a qualifying booking always receives
`evening`, and `discount_type` in the database records `evening` — the driver's
student or senior status leaves no trace on the row. Use a separate column if you
need that for reporting.

### Validation rules

| Rule                             | Enforcement                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `end_time > start_time`          | PHP, plus a `CHECK` constraint in the schema                                         |
| `start_time` not in the past     | Compared against `CURRENT_TIMESTAMP` in SQL, with 60 seconds of grace for clock skew |
| Duration ≤ 7 days (168 h)        | Computed in SQL from the supplied timestamps                                         |
| No overlapping bookings per spot | `EXCLUDE USING gist` constraint on `reservations`                                    |
| Spot must be active              | Checked before insert                                                                |

### Overlap semantics

Overlap is evaluated with PostgreSQL `tsrange`, which is **half-open** — `[start,
end)`. Back-to-back bookings do not conflict:

```
Booking A: 10:00 → 12:00
Booking B: 12:00 → 14:00      ✓ both allowed
```

The same rule governs `get_spots.php` availability and the database constraint, so
the two can't disagree.

Overlap is enforced by the database, not by a read-then-write check in PHP. That
pattern has a race window; the constraint does not. Concurrent identical requests
result in exactly one `201` and one `409`.

### Reservation lifecycle

| Status      | Meaning                 | Cancellable                              |
| ----------- | ----------------------- | ---------------------------------------- |
| `confirmed` | Booked, not yet started | Yes, while `start_time` is in the future |
| `active`    | Currently in progress   | No                                       |
| `completed` | Finished                | No                                       |
| `cancelled` | Cancelled               | No (already cancelled)                   |

Cancellation requires `status = 'confirmed'` **and** `start_time >
CURRENT_TIMESTAMP`. Both conditions, not either — a booking that has started
cannot be cancelled even if its status hasn't been advanced to `active` yet.

The whole operation runs in a transaction with `SELECT … FOR UPDATE`, and the
`UPDATE` repeats the eligibility predicate in its `WHERE` clause, so a status
change arriving mid-request cannot slip through.

---

## Error handling

### Standard error payload

```json
{
  "success": false,
  "error": "Reservations cannot exceed 7 days."
}
```

With `APP_DEBUG=true` a `detail` field carrying the underlying exception message
may also be present. It is absent in normal operation — do not depend on it.

### Status codes

| Code                        | Meaning            | Typical cause                                              |
| --------------------------- | ------------------ | ---------------------------------------------------------- |
| `200 OK`                    | Success            | `GET`, or a successful cancellation                        |
| `201 Created`               | Resource created   | Reservation created                                        |
| `204 No Content`            | Success, no body   | `OPTIONS` preflight                                        |
| `400 Bad Request`           | Validation failure | Missing field, bad format, business rule violated          |
| `404 Not Found`             | Resource absent    | Unknown `spot_id`, or no matching reservation              |
| `405 Method Not Allowed`    | Wrong verb         | `POST` to a `GET` endpoint, or vice versa                  |
| `409 Conflict`              | State conflict     | Overlapping booking, inactive spot, ambiguous cancellation |
| `500 Internal Server Error` | Server fault       | Database unreachable, query failure                        |

### Client handling guidance

| Code            | Recommended response                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `400`           | Show `error` to the user; it's written to be displayed. Do not retry unchanged.                    |
| `404`           | Treat as "not found", not as an error to retry.                                                    |
| `409` on create | Refetch availability — the world changed under you. Do not retry blindly.                          |
| `409` on cancel | If `options` is present, prompt the user to choose. Otherwise refetch.                             |
| `500`           | Retry once, then surface a generic failure. The real cause is in the server log, not the response. |

### Non-JSON responses

If PHP raises a fatal error, output may begin before the JSON body, producing an
unparseable response. Note that **the HTTP status may still read `200`** — PHP
sends headers before the body, so a mid-response fatal error doesn't change the
status code. Clients should not treat `response.ok` as proof of a valid payload;
parse defensively and log the raw text on failure.

---

## Data types

### Spot object

| Field          | Type    | Notes                                                    |
| -------------- | ------- | -------------------------------------------------------- |
| `id`           | integer | Primary key                                              |
| `spot_number`  | string  | Unique, max 10 chars — e.g. `A-01`                       |
| `spot_type`    | string  | `standard`, `electric`, `handicapped`                    |
| `hourly_rate`  | number  | Two decimal places                                       |
| `is_active`    | boolean | Inactive spots are never listed                          |
| `is_available` | boolean | Computed per request; `true` when no window was supplied |

### Reservation object

| Field           | Type    | Notes                                                    |
| --------------- | ------- | -------------------------------------------------------- |
| `id`            | integer | Primary key                                              |
| `spot_id`       | integer | FK → `parking_spots.id`, `ON DELETE CASCADE`             |
| `license_plate` | string  | Uppercase, whitespace collapsed, max 15 chars            |
| `start_time`    | string  | `Y-m-d H:i:s`                                            |
| `end_time`      | string  | `Y-m-d H:i:s`                                            |
| `total_price`   | number  | Two decimal places                                       |
| `discount_type` | string  | `none`, `student`, `senior`, `evening`                   |
| `status`        | string  | `confirmed`, `active`, `completed`, `cancelled`          |
| `is_paid`       | boolean | Always `false` on creation; no payment processing exists |
| `created_at`    | string  | Set by the database                                      |
| `can_cancel`    | boolean | Present only in plate-lookup responses                   |

> **Numeric types.** PostgreSQL returns `NUMERIC` as a string over the wire. The
> API casts these to JSON numbers before responding, so `hourly_rate` and
> `total_price` arrive as `2.5`, not `"2.50"`. Booleans are likewise normalised
> from PostgreSQL's `t`/`f` to real JSON booleans.

---

## Security considerations

Not hardened for public deployment. Known gaps:

1. **The licence plate is the only credential.** Anyone who can read a plate can
   list and cancel that plate's bookings. Spot-schedule responses deliberately omit
   plates to limit the exposure, but plates are visible on cars. A booking
   reference issued at creation and required for cancellation is the cheapest fix.
2. **CORS allows any origin.** Replace `*` with your front-end origin before
   deploying. Note that `*` is also incompatible with cookie-based auth if you add
   sessions later.
3. **No rate limiting.** Plate lookup can be enumerated.
4. **No payment integration.** `is_paid` and `refund_due` are informational fields
   with no processing behind them.

SQL injection is not among these — every query uses bound parameters with
`PDO::ATTR_EMULATE_PREPARES => false`, so binding happens server-side in
PostgreSQL.
