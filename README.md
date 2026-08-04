# Parkoló — Parking Spot Reservation System

A parking garage booking app. Drivers pick a time window, see which bays are
actually free for it, and reserve one by licence plate. Bays that are taken show
their schedule so you can find the next gap.

Built as three containerised services: a PostgreSQL database, a PHP REST API, and
a React + Vite front end.

**Stack:** React 18 · Vite · Tailwind CSS · PHP 8 (PDO) · PostgreSQL 16 · Docker Compose

---

## Features

- **Availability by time window** — overlap detection via PostgreSQL `tsrange`, so
  a bay is only red if something actually conflicts with the requested window.
- **Double-booking is impossible** — enforced by a database `EXCLUDE` constraint,
  not by application logic, so concurrent requests can't both win.
- **Per-bay schedules** — click any bay to see its occupied windows on a 24-hour
  timeline.
- **Cancellation** — look up bookings by plate and cancel anything that hasn't
  started yet.
- **Automatic overnight pricing** — bookings that fall entirely between 18:00 and
  06:00 get the evening rate without the driver having to ask.

---

## Prerequisites

**Docker Desktop.** That's it.

You do not need PHP, Node, npm, or PostgreSQL installed locally — everything runs
inside containers. Docker Desktop includes Docker Compose.

Verify your install:

```bash
docker --version
docker compose version
```

---

## Quick start

```bash
git clone <repo-url>
cd parkolo
docker compose up --build
```

First run takes a couple of minutes while images build and dependencies install.
Once the logs settle:

| Service   | URL                   | Container                    |
| --------- | --------------------- | ---------------------------- |
| Front end | http://localhost:5173 | `parkolo_frontend_container` |
| API       | http://localhost:8000 | `parkolo_backend_container`  |
| Database  | `localhost:5432`      | `parkolo_db_container`       |

The database initialises itself on first run: `schema.sql` creates the tables and
constraints, then `seed.sql` populates the bays. Open the front end and you should
see a populated floor plan.

Stop everything with `Ctrl+C`, or from another terminal:

```bash
docker compose down
```

---

## Database reset

The init scripts run **only when the data volume is empty**. Editing `schema.sql`
after the first start has no effect until you wipe the volume — this catches
everyone at least once.

```bash
docker compose down -v      # -v removes the volume, and with it all data
docker compose up --build
```

Without `-v` your data persists and the migrations are skipped.

To inspect the database directly:

```bash
docker exec -it parkolo_db_container psql -U postgres -d parkolo_db
```

Useful once you're in:

```sql
\dt                              -- list tables
SELECT * FROM parking_spots;
SELECT * FROM reservations ORDER BY start_time;
```

---

## Project structure

```
.
├── docker-compose.yaml       Service definitions, ports, volumes
├── schema.sql                Tables, constraints, indexes — runs on first start
├── seed.sql                  Initial parking bays — runs after schema.sql
│
├── backend/                  PHP API (served at :8000)
│   ├── db.php                PDO connection, CORS, JSON helpers — required by all
│   ├── helpers.php           parse_timestamp(), pg_bool(), normalize_plate()
│   ├── get_spots.php         GET  — bays + availability for a window
│   ├── get_reservations.php  GET  — schedule by spot, or bookings by plate
│   ├── create_reservation.php POST — validation, pricing, insert
│   └── cancel_reservation.php POST — cancel an upcoming booking
│
└── src/                      React front end (served at :5173)
    ├── App.jsx               State, data loading, toast orchestration
    ├── api.js                Fetch wrappers and ApiError
    ├── index.css             Tailwind entry, fonts, keyframes
    ├── lib/
    │   └── format.js         Pricing and validation rules mirrored from the API
    └── components/
        ├── TimeRangeBar.jsx      Window picker with min/max constraints
        ├── SpotGrid.jsx          Floor plan layout, loading and error states
        ├── SpotCard.jsx          One bay
        ├── SpotSchedule.jsx      24-hour occupancy timeline
        ├── ReservationDrawer.jsx Booking form and live price preview
        ├── CancelDrawer.jsx      Plate lookup and cancellation
        └── ToastStack.jsx        Success and error banners
```

---

## API reference

All responses are JSON with a `success` boolean. Errors carry an `error` string
and an appropriate HTTP status.

### `GET /get_spots.php`

Lists active bays. With `start_time` and `end_time`, each bay's `is_available`
reflects that window; without them, everything reports available.

```
?start_time=2026-08-03 20:00:00&end_time=2026-08-03 23:00:00
```

Both parameters must be supplied together or neither.

### `GET /get_reservations.php`

Two modes — exactly one of these parameters is required:

- `?spot_id=3` — occupied windows for one bay. Returns times and status only;
  plates and prices are deliberately withheld.
- `?license_plate=ZR-123-AB` — that plate's bookings in full, each with a
  `can_cancel` flag.

Add `&include_past=1` to include finished reservations.

### `POST /create_reservation.php`

```json
{
  "spot_id": 3,
  "license_plate": "ZR-123-AB",
  "start_time": "2026-08-03 20:00:00",
  "end_time": "2026-08-03 23:00:00",
  "discount_type": "student"
}
```

Returns `201` with `reservation_id` and `total_price`. Returns `409` if the bay is
already booked for that window.

### `POST /cancel_reservation.php`

```json
{
  "license_plate": "ZR-123-AB",
  "reservation_id": 42
}
```

`reservation_id` is optional when the plate has exactly one cancellable booking.
If several exist, the response is `409` with the choices listed under `options`.

---

## Business rules

| Rule                 | Behaviour                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Billing**          | Per started hour — 61 minutes bills as 2 hours, minimum 1 hour.                                                                              |
| **No past bookings** | `start_time` must not precede `CURRENT_TIMESTAMP`. 60s of grace absorbs clock skew.                                                          |
| **Maximum duration** | 7 days (168 hours) per reservation.                                                                                                          |
| **Student discount** | 15%, driver-selected.                                                                                                                        |
| **Senior discount**  | 20%, driver-selected.                                                                                                                        |
| **Evening discount** | 25%, applied **automatically** when the entire booking falls between 18:00 and 06:00. Never selectable. Overrides a smaller manual discount. |
| **Cancellation**     | Allowed only while `status = 'confirmed'` **and** `start_time` is still in the future.                                                       |
| **Overlap**          | Enforced by an `EXCLUDE USING gist` constraint. Cancelled reservations are excluded, so cancelling frees the slot immediately.               |

Time ranges are half-open: a booking ending at 12:00 and one starting at 12:00 do
not conflict.

> Pricing and validation rules are implemented twice — in `create_reservation.php`
> and in `src/lib/format.js` — so the front end can preview a price without a round
> trip. They are duplicated by necessity, not independent. **Change both together;
> the server is authoritative.**

---

## Configuration

The defaults work out of the box. To override, set these in `docker-compose.yaml`
or a `.env` file:

| Variable        | Service  | Default                 | Purpose                                     |
| --------------- | -------- | ----------------------- | ------------------------------------------- |
| `DB_HOST`       | backend  | `localhost`             | Database host                               |
| `DB_PORT`       | backend  | `5432`                  | Database port                               |
| `DB_NAME`       | backend  | `parkolo_db`            | Database name                               |
| `DB_USER`       | backend  | `postgres`              | Database user                               |
| `DB_PASS`       | backend  | _(empty)_               | Database password                           |
| `APP_DEBUG`     | backend  | `false`                 | Include exception detail in error responses |
| `VITE_API_BASE` | frontend | `http://localhost:8000` | API base URL                                |

---

## Troubleshooting

**"The server returned a response that isn't valid JSON"**

PHP emitted a fatal error or a warning before the JSON body. See what it actually
sent:

```bash
curl -s http://localhost:8000/get_spots.php
docker compose logs backend
```

Note that PHP sends a `200` header before the body, so a fatal error mid-response
still logs as `[200]` — the status code isn't trustworthy once output has started.

**Every bay shows as available even though bookings exist**

Press **Check availability**. On first load the app requests the full inventory
with no time window, and the API reports everything available by design. Also
confirm your window actually overlaps the booking — a 10:00–14:00 window will not
conflict with a 20:00–23:00 reservation.

**Schema changes aren't taking effect**

The init scripts only run against an empty volume. See
[Database reset](#database-reset).

**Port already in use**

Something else holds 5173, 8000, or 5432. Find it with `lsof -i :5432`, or remap
the host side in `docker-compose.yaml` (`"5433:5432"`).

**Front end can't reach the API**

Check that the backend is up (`docker compose ps`) and that `VITE_API_BASE` points
where you think. Browser DevTools → Network → the failing request → **Response**
tab shows what actually came back.

---

## Security notes

This is a course/portfolio project and is not hardened for public deployment. Two
things to address before it goes anywhere real:

1. **The licence plate is the only credential.** Anyone who can read a plate in the
   garage can list and cancel that plate's bookings. A booking reference issued at
   creation and required for cancellation is the cheapest fix.
2. **CORS is wide open** (`Access-Control-Allow-Origin: *`). Replace it with your
   actual front-end origin.

Also note `TIMESTAMP` columns store naive local time. If the garage ever spans
time zones — or you want DST handled correctly — migrate to `TIMESTAMPTZ`.
