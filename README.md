# Parkoló — Parking Spot Reservation System

A parking garage booking app. Drivers pick a time window, see which bays are
actually free for it, and reserve one by licence plate. Bays that are taken show
their schedule so you can find the next gap.

Three containerised services: a PostgreSQL database, a PHP REST API, and a
React + Vite front end.

**Stack:** React 18 · Vite · Tailwind CSS · PHP 8.3 (PDO) · PostgreSQL 16 · Docker Compose

---

## Documentation

| Document                                                 | Contents                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`RENDSZERTERV.md`](RENDSZERTERV.md)                     | Rendszerterv — architektúra, versenyhelyzetek, indexelés, üzleti szabályok _(magyarul)_ |
| [`FELHASZNALOI_KEZIKONYV.md`](FELHASZNALOI_KEZIKONYV.md) | Felhasználói kézikönyv — telepítés, használat, hibaelhárítás _(magyarul)_               |
| [`docs/API.md`](docs/API.md)                             | Full API reference — endpoints, schemas, status codes                                   |
| [`docs/TESTING.md`](docs/TESTING.md)                     | Test suites, commands, coverage by requirement                                          |

---

## Features

- **Availability by time window** — overlap detection via PostgreSQL `tsrange`,
  so a bay is only red if something actually conflicts with the requested window.
- **Double-booking is impossible** — enforced by a database `EXCLUDE` constraint,
  not by application logic, so concurrent requests can't both win.
- **Per-bay schedules** — click any bay, free or taken, to see its occupied
  windows on a 24-hour timeline.
- **Cancellation** — look up bookings by plate and cancel anything that hasn't
  started yet.
- **Automatic overnight pricing** — bookings that fall entirely between 18:00 and
  06:00 get the evening rate without the driver having to ask.
- **121 tests** across four suites, all passing.

---

## Prerequisites

**Docker Desktop.** That's it.

You do not need PHP, Node, npm, or PostgreSQL installed locally — everything runs
inside containers. Docker Desktop includes Docker Compose.

```bash
docker --version
docker compose version
```

---

## Quick start

```bash
git clone <repo-url>
cd parkolohely-foglalas
docker compose up --build
```

First run takes a couple of minutes while images build and dependencies install.
Once the logs settle:

| Service       | URL                       | Container                    |
| ------------- | ------------------------- | ---------------------------- |
| **Front end** | **http://localhost:5173** | `parkolo_frontend_container` |
| API           | http://localhost:8000     | `parkolo_backend_container`  |
| Database      | `localhost:5432`          | `parkolo_db_container`       |

The database initialises itself on first run: `schema.sql` creates the tables and
constraints, then `seed.sql` populates the bays.

> On first load **every bay shows green**. That's the full inventory, not a claim
> about availability — press **Check availability** with a time window to see
> what's actually free.

Stop with `Ctrl+C`, or `docker compose down` from another terminal.

Code edits need no restart: `backend/` and `src/` are bind-mounted, so PHP
changes take effect on the next request and Vite hot-reloads the front end.

---

## Database reset

The init scripts run **only when the data volume is empty**. Editing `schema.sql`
after the first start has no effect until you wipe the volume — this catches
everyone at least once.

```bash
docker compose down -v      # -v removes the volume, and with it all data
docker compose up --build
```

To inspect the database directly:

```bash
docker exec -it parkolo_db_container psql -U postgres -d parkolo_db
```

---

## Project structure

```
.
├── docker-compose.yaml
├── schema.sql                      Tables, constraints, indexes — runs on first start
├── seed.sql                        Initial parking bays — runs after schema.sql
├── README.md
├── RENDSZERTERV.md                 System design (HU)
├── FELHASZNALOI_KEZIKONYV.md       User manual (HU)
│
├── docs/
│   ├── API.md
│   └── TESTING.md
│
├── backend/                        Mounted to /var/www/html
│   ├── Dockerfile
│   ├── composer.json               PHPUnit dev dependency
│   ├── phpunit.xml
│   │
│   ├── db.php                      PDO connection, CORS, JSON helpers
│   ├── helpers.php                 parse_timestamp(), pg_bool(), normalize_plate()
│   ├── pricing.php                 Pure business rules — no side effects, unit tested
│   ├── get_spots.php               GET  — bays + availability for a window
│   ├── get_reservations.php        GET  — schedule by spot, or bookings by plate
│   ├── create_reservation.php      POST — validation, pricing, insert
│   ├── cancel_reservation.php      POST — cancel an upcoming booking
│   │
│   └── tests/
│       ├── bootstrap.php
│       ├── PricingTest.php
│       └── DatabaseConstraintTest.php
│
├── package.json
├── vite.config.js
├── vitest.config.js                Unit tests
├── vitest.integration.config.js    Integration tests (serial)
│
└── src/
    ├── App.jsx                     State, data loading, toast orchestration
    ├── api.js                      Fetch wrappers and ApiError
    ├── index.css                   Tailwind entry, fonts, keyframes
    ├── lib/
    │   └── format.js               Pricing and validation mirrored from the API
    ├── components/
    │   ├── TimeRangeBar.jsx        Window picker with min/max constraints
    │   ├── SpotGrid.jsx            Floor plan layout, loading and error states
    │   ├── SpotCard.jsx            One bay
    │   ├── SpotSchedule.jsx        24-hour occupancy timeline
    │   ├── ReservationDrawer.jsx   Booking form and live price preview
    │   ├── CancelDrawer.jsx        Plate lookup and cancellation
    │   └── ToastStack.jsx          Success and error banners
    └── tests/
        ├── validation.test.js
        └── api.integration.test.js
```

**`composer.json`, `phpunit.xml`, `tests/`, and `vendor/` must live inside
`backend/`** — that's the directory mounted to `/var/www/html`, and the container
can't see anything outside it.

---

## API summary

| Method | Endpoint                               | Purpose                                               |
| ------ | -------------------------------------- | ----------------------------------------------------- |
| `GET`  | `/get_spots.php`                       | Active bays, with availability for an optional window |
| `GET`  | `/get_reservations.php?spot_id=`       | One bay's occupied windows                            |
| `GET`  | `/get_reservations.php?license_plate=` | One plate's bookings                                  |
| `POST` | `/create_reservation.php`              | Create a booking                                      |
| `POST` | `/cancel_reservation.php`              | Cancel an upcoming booking                            |

All responses are JSON with a `success` boolean. Errors carry an `error` string
written to be shown to the user directly.

Full request/response schemas, status codes, and examples: [`docs/API.md`](docs/API.md).

---

## Business rules

| Rule                 | Behaviour                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Billing**          | Per started hour — 61 minutes bills as 2 hours, minimum 1 hour.                                                                                                          |
| **No past bookings** | `start_time` must not precede `CURRENT_TIMESTAMP`. 60s of grace absorbs clock skew.                                                                                      |
| **Maximum duration** | 7 days (168 hours) per reservation.                                                                                                                                      |
| **Student discount** | 15%, driver-selected.                                                                                                                                                    |
| **Senior discount**  | 20%, driver-selected.                                                                                                                                                    |
| **Evening discount** | 25%, applied **automatically** when the entire booking falls between 18:00 and 06:00 (both boundaries inclusive). Never selectable. Overrides a smaller manual discount. |
| **Cancellation**     | Allowed only while `status = 'confirmed'` **and** `start_time` is still in the future.                                                                                   |
| **Overlap**          | Enforced by an `EXCLUDE USING gist` constraint. Cancelled reservations are excluded, so cancelling frees the slot immediately.                                           |

Time ranges are half-open: a booking ending at 12:00 and one starting at 12:00 do
not conflict.

> Pricing and validation are implemented twice — `backend/pricing.php` and
> `src/lib/format.js` — so the front end can preview a price without a round trip.
> They are duplicated by necessity, not independent. **Change both together; the
> server is authoritative.** Both test suites assert the same fixtures, so drift
> shows up as a test failure.

---

## Configuration

Defaults work out of the box. Override in `docker-compose.yaml` or a `.env` file:

| Variable        | Service  | Default                 | Purpose                                           |
| --------------- | -------- | ----------------------- | ------------------------------------------------- |
| `DB_HOST`       | backend  | `db`                    | Database host (`localhost` from the host machine) |
| `DB_PORT`       | backend  | `5432`                  | Database port                                     |
| `DB_NAME`       | backend  | `parkolo_db`            | Database name                                     |
| `DB_USER`       | backend  | `postgres`              | Database user                                     |
| `DB_PASS`       | backend  | _(empty)_               | Database password                                 |
| `APP_DEBUG`     | backend  | `false`                 | Include exception detail in error responses       |
| `VITE_API_BASE` | frontend | `http://localhost:8000` | API base URL                                      |
| `TEST_API_BASE` | tests    | `http://127.0.0.1:8000` | API base for integration tests                    |

---

## Testing

| Suite                | Command                                                                      | Tests |
| -------------------- | ---------------------------------------------------------------------------- | ----- |
| JS unit              | `npm test`                                                                   | 36    |
| PHP unit             | `docker compose exec backend php vendor/bin/phpunit --testsuite unit`        | 28    |
| API integration      | `npm run test:integration`                                                   | 37    |
| Database integration | `docker compose exec backend php vendor/bin/phpunit --testsuite integration` | 20    |

Integration suites need the stack running (`docker compose up -d`). First-time
PHP setup:

```bash
docker compose exec backend composer install
```

Full details, isolation strategy, and coverage by requirement:
[`docs/TESTING.md`](docs/TESTING.md).

---

## Troubleshooting

**"The server returned a response that isn't valid JSON"**

PHP emitted a fatal error or a warning before the JSON body:

```bash
curl -s http://localhost:8000/get_spots.php
docker compose logs backend
```

PHP sends a `200` header before the body, so a fatal error mid-response still
logs as `[200]` — the status code isn't trustworthy once output has started.

**Every bay shows as available even though bookings exist**

Press **Check availability**. On first load the app requests the full inventory
with no time window, and the API reports everything available by design. Also
confirm your window actually overlaps the booking — a 10:00–14:00 window will not
conflict with a 20:00–23:00 reservation.

**Schema changes aren't taking effect**

The init scripts only run against an empty volume. See
[Database reset](#database-reset).

**Requests hang instead of failing**

Two processes may be sharing port 8000. On Windows, Node and browsers resolve
`localhost` to `::1` first, so a stray process on IPv6 localhost intercepts
traffic meant for Docker:

```powershell
netstat -ano | findstr :8000
```

Two different PIDs means a squatter. Kill it, or use `127.0.0.1`.

**CORS headers look wrong on one endpoint**

CORS lives in `db.php` only. A leftover `header()` block at the top of an
endpoint runs _before_ `db.php` loads and silently overrides the real policy:

```bash
docker compose exec backend grep -ln "Allow-Origin" *.php
```

Only `db.php` should match.

---

## Security notes

Not hardened for public deployment. Two things to address first:

1. **The licence plate is the only credential.** Anyone who can read a plate in
   the garage can list and cancel that plate's bookings. Spot-schedule responses
   deliberately omit plates to limit the exposure, but plates are visible on cars.
   A booking reference issued at creation and required for cancellation is the
   cheapest fix.
2. **CORS is wide open** (`Access-Control-Allow-Origin: *`). Replace it with your
   actual front-end origin. Note that `*` is also incompatible with cookie-based
   auth if you add sessions later.

SQL injection is not among these — every query uses bound parameters with
`PDO::ATTR_EMULATE_PREPARES => false`, so binding happens server-side in
PostgreSQL.

Also note `TIMESTAMP` columns store naive local time. If the garage ever spans
time zones — or you want DST handled correctly — migrate to `TIMESTAMPTZ`.
