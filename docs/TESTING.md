# Testing

Four suites, split by what they need to run.

| Suite                | Runner  | Needs             | Tests | Time  |
| -------------------- | ------- | ----------------- | ----- | ----- |
| JS unit              | Vitest  | Nothing           | 36    | ~0.4s |
| PHP unit             | PHPUnit | Nothing           | 28    | ~0.4s |
| API integration      | Vitest  | Full Docker stack | 37    | ~2s   |
| Database integration | PHPUnit | PostgreSQL        | 20    | ~0.8s |

**121 tests, 200+ assertions.** All four suites verified passing.

Unit suites are split from integration deliberately: a broken Docker stack
should look like a broken Docker stack, not a broken test suite.

---

## Files

```
vitest.config.js                    Unit config (excludes *.integration.test.js)
vitest.integration.config.js        Integration config (serial, longer timeouts)
src/tests/
  validation.test.js                JS unit tests
  api.integration.test.js           API integration tests

backend/
  phpunit.xml                       Both PHP suites
  composer.json                     PHPUnit dev dependency
  pricing.php                       Extracted pure rules — the PHP unit test target
  tests/
    bootstrap.php                   Loads pricing.php + helpers.php only
    PricingTest.php                 PHP unit tests
    DatabaseConstraintTest.php      PHP integration tests
```

The PHP test scaffolding lives in `backend/` because that directory is what's
bind-mounted to `/var/www/html`. `composer.json` and `vendor/` must sit there or
the container can't see them.

---

## Running

### The four commands

```powershell
npm test                                                                # JS unit
npm run test:integration                                                # JS integration
docker compose exec backend php vendor/bin/phpunit --testsuite unit
docker compose exec backend php vendor/bin/phpunit --testsuite integration
```

Integration suites need the stack up: `docker compose up -d`.

### Why PHPUnit runs in the container

`composer test:unit` and `vendor/bin/phpunit` both assume a working host PHP.
If yours lacks `ext-zip` (Composer can't unpack) or `ext-pdo_pgsql` (database
tests can't connect), skip the host entirely — the container already has a
correctly configured PHP 8.3.

Two details that matter:

- Use `php vendor/bin/phpunit`, **not** `vendor/bin/phpunit`. Windows bind
  mounts don't carry the executable bit, so the direct form fails on permissions.
- `DB_HOST` is `db` inside the Docker network, `localhost` from the host.
  `phpunit.xml` defaults to `db`. Running on the host needs
  `DB_HOST=localhost` in the environment.

### First-time setup

```powershell
npm install --save-dev vitest

docker compose build backend
docker compose up -d --force-recreate backend
docker compose exec backend composer install
```

`--force-recreate` matters: `docker compose build` makes a new image, but a
running container keeps using the old one until it's recreated.

If Composer isn't in the backend image, either add it to the Dockerfile —

```dockerfile
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
```

— or install from a throwaway container without rebuilding:

```powershell
docker run --rm -v ${PWD}/backend:/app composer:2 install --ignore-platform-reqs
```

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.js",
    "test:all": "npm run test && npm run test:integration"
  }
}
```

### Useful flags

```powershell
npx vitest run -t "evening"                                                  # by name
npx vitest --ui                                                              # browser UI
docker compose exec backend php vendor/bin/phpunit --filter Evening
docker compose exec backend php vendor/bin/phpunit --testdox                 # spec-style output
```

---

## Coverage by requirement

### Past dates rejected

| Where   | Test                                                                       |
| ------- | -------------------------------------------------------------------------- |
| JS unit | Yesterday, an hour ago, and the 60s grace boundary at 0s / 30s / 59s / 61s |
| API     | Past start time → 400                                                      |

The grace-window tests run against a **frozen clock** (`vi.setSystemTime`).
Deriving the timestamp from the real clock races it: a `datetime-local` value has
minute precision, so truncating "30 seconds ago" can land up to 89 seconds in the
past and fall outside the allowance. That produced a genuinely flaky test before
it was pinned.

### 7-day duration limit

| Where    | Test                                                               |
| -------- | ------------------------------------------------------------------ |
| JS unit  | Exactly 7 days accepted; 7 days + 1 hour rejected; 8 days rejected |
| PHP unit | `exceeds_max_duration()` at the boundary, one second either side   |
| API      | 8-day booking → 400; exactly 7 days → 201                          |

### Automatic evening discount

| Where    | Test                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| JS unit  | 11 window cases including both boundaries and midnight crossing, plus a proof that nothing over 12 hours qualifies at any start hour |
| PHP unit | The same 14 cases, plus discount resolution and the full price breakdown                                                             |
| API      | `student` upgraded to `evening` on a qualifying booking; untouched on a daytime one; client-supplied `evening` downgraded to `none`  |

The JS and PHP suites assert the same fixtures on purpose. The rules are
implemented twice out of necessity — if the suites ever disagree, they've drifted.

### Cancellation rules

| Where           | Test                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| PHP integration | Future + `confirmed` → cancels; already started → **0 rows affected**; `active` → 0 rows; `completed` → 0 rows; double cancel → 0 rows |
| API             | Cancel frees the slot and the bay becomes rebookable; double cancel → 409; wrong plate → 404; ambiguous → 409 with `options`           |

> A reservation that has already started can't be created through the API —
> creation rejects past start times. That case is therefore only testable at the
> database level, which is why `DatabaseConstraintTest` exists.

### Availability by time window

| Where           | Test                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| API             | Spot flips to `is_available: false` after an overlapping booking; stays `true` for a non-overlapping window; half-supplied window → 400 |
| PHP integration | The same `NOT EXISTS` + `tsrange` query directly, including that cancelled bookings are ignored                                         |

Also asserts field types (`hourly_rate` is a number, `is_available` is a boolean)
— a regression guard for the `pdo_pgsql` string / `t`-`f` behaviour that bit this
project once already.

### Overlap constraint

| Where           | Test                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PHP integration | The constraint exists in `pg_constraint`; identical, partial, and contained overlaps all raise SQLSTATE `23P01`; back-to-back allowed; cancelled rows don't block; different spots may share a window |
| API             | Same overlap shapes via HTTP → 409, plus **three concurrent identical requests → exactly one 201 and two 409s**                                                                                       |

The concurrency test is the one that matters. No read-then-write check in PHP
could pass it; it passes because the constraint lives in the database.

---

## How integration tests stay isolated

**API tests** generate a unique licence plate per run (`T-` plus a base-36
timestamp) and book 400+ days out. They can't collide with seed data, with a
developer clicking around the UI, or with a parallel run. `afterAll` cancels
everything created — all test bookings are far-future and `confirmed`, so all of
them are cancellable.

They also run **serially** (`fileParallelism: false`, `maxWorkers: 1`). Parallel
workers competing for the same spot would produce 409s that look like failures.

**PHP database tests** wrap each test in a transaction and roll it back in
`tearDown`, and create their own throwaway spot rather than touching seed data.
Nothing survives the test. If PostgreSQL is unreachable the suite skips itself
with a clear message instead of failing.

---

## The refactor this required

`create_reservation.php` previously held its pricing rules inline, which made
them unreachable from a test — including the file executes headers, connects to
PostgreSQL, and reads `php://input`.

Those rules now live in `pricing.php`: no headers, no database, no output. The
endpoint requires it and calls `quote_price()`. Nothing about the API's behaviour
changed; the logic just became addressable.

`tests/bootstrap.php` loads `pricing.php` and `helpers.php` but deliberately not
`db.php`, for the same reason.

---

## Troubleshooting

**`Hook timed out in 30000ms` with no other error**

The API was unreachable and the connection hung rather than refusing. On Windows,
Node resolves `localhost` to `::1` first; if something else is listening on IPv6
localhost, or Docker bound IPv4 only, the request never returns. The tests default
to `127.0.0.1` and time out each request after 8 seconds for this reason. Check
for a squatter:

```powershell
netstat -ano | findstr :8000
```

Two different PIDs on port 8000 means another process — often a stray `php -S` —
is intercepting IPv6 traffic.

**`No test suite found in file`**

The file is empty or has no `describe`/`it` blocks.

**`There are no commands defined in the "test" namespace`**

Composer found no `composer.json` in the current directory. The PHP scaffolding
lives in `backend/`, and the container commands above sidestep this entirely.

**`exec: "composer": executable file not found in $PATH`**

The backend image predates the Dockerfile change. `docker compose build backend`
then `docker compose up -d --force-recreate backend`.

**`test.poolOptions was removed in Vitest 4`**

`poolOptions` is top-level now — `fileParallelism`, `maxWorkers`, `minWorkers`.
Already fixed in `vitest.integration.config.js`.

---

## Known gaps

- **No React component tests.** Rendering, drawer interaction, and toast
  behaviour are untested. Add `@testing-library/react` and `jsdom` if you want
  them; the current suites cover logic and the API contract only.
- **`status` transitions aren't exercised.** Nothing in the codebase advances
  `confirmed` → `active` → `completed`; presumably a scheduled job that doesn't
  exist yet. The tests set those statuses directly.
- **No coverage reporting configured.** `phpunit.xml` declares a `<source>`
  block, so `--coverage-text` works once a coverage driver (Xdebug or PCOV) is
  installed in the backend image.
