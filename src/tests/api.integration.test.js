import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integration tests — these hit the real API and the real database.
 * Start the stack first: `docker compose up`
 *
 * Isolation strategy: every run gets a unique licence plate and books far in
 * the future (400+ days), so tests never collide with seed data, with a
 * developer clicking around the UI, or with each other. Everything created is
 * cancelled in afterAll.
 */

// 127.0.0.1, not localhost: on Windows, Node resolves `localhost` to ::1
// first, and a Docker port bound only to IPv4 leaves the connection hanging
// until the hook times out rather than refusing it.
const API = process.env.TEST_API_BASE ?? "http://127.0.0.1:8000";

/** Fail fast on an unreachable API instead of waiting out the hook timeout. */
const REQUEST_TIMEOUT_MS = 8000;

/** Unique per run, ≤15 chars, matching the plate character rule. */
const PLATE = `T-${Date.now().toString(36).toUpperCase()}`;

/** Far-future day offsets, spaced apart so tests don't overlap each other. */
const DAY = { fetch: 400, create: 410, overlap: 420, cancel: 430, evening: 440 };

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/** Local datetime string in the format the API expects. */
function at(daysFromNow, hour = 12, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);

  const pad = (n) => String(n).padStart(2, "0");

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
}

/**
 * Returns { status, body } rather than throwing, because the status code is
 * what most of these tests are asserting on.
 */
async function call(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${API}${path} (${error.name}). ` +
        `Is the stack up? Try \`docker compose ps\`. ` +
        `On Windows, use TEST_API_BASE=http://127.0.0.1:8000 — ` +
        `\`localhost\` resolves to ::1 and hangs against an IPv4-only binding.`,
    );
  }

  const text = await response.text();

  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Non-JSON response from ${path} (HTTP ${response.status}): ${text.slice(0, 300)}`,
    );
  }

  return { status: response.status, body };
}

function postJson(path, payload) {
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function book(spotId, start, end, extra = {}) {
  return postJson("/create_reservation.php", {
    spot_id: spotId,
    license_plate: PLATE,
    start_time: start,
    end_time: end,
    ...extra,
  });
}

let spotId;
let spotRate;

// ------------------------------------------------------------
// Setup / teardown
// ------------------------------------------------------------
beforeAll(async () => {
  const { status, body } = await call("/get_spots.php");

  if (status !== 200) {
    throw new Error(
      `API not reachable at ${API} (HTTP ${status}). Start it with \`docker compose up\`.`,
    );
  }

  if (!body.data?.length) {
    throw new Error("No parking spots in the database. Did seed.sql run?");
  }

  spotId = body.data[0].id;
  spotRate = body.data[0].hourly_rate;
});

afterAll(async () => {
  // Cancel everything this run created. All test bookings are far-future and
  // 'confirmed', so all of them are cancellable.
  const { body } = await call(
    `/get_reservations.php?license_plate=${encodeURIComponent(PLATE)}&include_past=1`,
  );

  for (const reservation of body.data ?? []) {
    if (reservation.can_cancel) {
      await postJson("/cancel_reservation.php", {
        license_plate: PLATE,
        reservation_id: reservation.id,
      });
    }
  }
});

// ============================================================
// GET /get_spots.php
// ============================================================
describe("GET /get_spots.php", () => {
  it("returns the full inventory with no window", async () => {
    const { status, body } = await call("/get_spots.php");

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.filter).toEqual({ start_time: null, end_time: null });

    // Without a window there is nothing to conflict with.
    expect(body.data.every((s) => s.is_available)).toBe(true);
  });

  it("returns correctly typed fields", async () => {
    const { body } = await call("/get_spots.php");
    const spot = body.data[0];

    // Regression guard: pdo_pgsql returns NUMERIC as a string and BOOLEAN as
    // 't'/'f' on some builds. Both must be normalised before responding.
    expect(typeof spot.id).toBe("number");
    expect(typeof spot.hourly_rate).toBe("number");
    expect(typeof spot.is_available).toBe("boolean");
    expect(typeof spot.is_active).toBe("boolean");
    expect(typeof spot.spot_number).toBe("string");
  });

  it("marks a spot unavailable when a booking overlaps the window", async () => {
    const start = at(DAY.fetch, 10);
    const end = at(DAY.fetch, 14);

    const before = await call(
      `/get_spots.php?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
    );
    const target = before.body.data.find((s) => s.id === spotId);
    expect(target.is_available).toBe(true);

    const created = await book(spotId, start, end);
    expect(created.status).toBe(201);

    const after = await call(
      `/get_spots.php?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
    );
    const taken = after.body.data.find((s) => s.id === spotId);

    expect(taken.is_available).toBe(false);
    expect(after.body.filter.start_time).toBe(start);
  });

  it("leaves the spot available for a non-overlapping window", async () => {
    // The booking above runs 10:00–14:00. tsrange is half-open, so a window
    // starting exactly at 14:00 does not conflict.
    const { body } = await call(
      `/get_spots.php?start_time=${encodeURIComponent(at(DAY.fetch, 14))}` +
        `&end_time=${encodeURIComponent(at(DAY.fetch, 16))}`,
    );

    expect(body.data.find((s) => s.id === spotId).is_available).toBe(true);
  });

  it("rejects a half-supplied window", async () => {
    const { status, body } = await call(
      `/get_spots.php?start_time=${encodeURIComponent(at(DAY.fetch, 10))}`,
    );

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });
});

// ============================================================
// POST /create_reservation.php
// ============================================================
describe("POST /create_reservation.php", () => {
  it("creates a reservation and persists it", async () => {
    const start = at(DAY.create, 9);
    const end = at(DAY.create, 12);

    const { status, body } = await book(spotId, start, end);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(typeof body.reservation_id).toBe("number");
    expect(body.data).toMatchObject({
      spot_id: spotId,
      license_plate: PLATE,
      start_time: start,
      end_time: end,
      billable_hours: 3,
      status: "confirmed",
      is_paid: false,
    });
    expect(body.total_price).toBeCloseTo(spotRate * 3, 2);

    // Read it back — the insert must actually be in the database.
    const check = await call(
      `/get_reservations.php?license_plate=${encodeURIComponent(PLATE)}`,
    );
    const found = check.body.data.find((r) => r.id === body.reservation_id);

    expect(found).toBeDefined();
    expect(found.status).toBe("confirmed");
    expect(found.can_cancel).toBe(true);
  });

  it("normalises the licence plate to uppercase", async () => {
    const { status, body } = await postJson("/create_reservation.php", {
      spot_id: spotId,
      license_plate: PLATE.toLowerCase(),
      start_time: at(DAY.create, 15),
      end_time: at(DAY.create, 16),
    });

    expect(status).toBe(201);
    expect(body.data.license_plate).toBe(PLATE);
  });

  it("rejects a start time in the past with 400", async () => {
    const { status, body } = await book(spotId, at(-2, 10), at(-2, 14));

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/past/i);
  });

  it("rejects a booking longer than 7 days with 400", async () => {
    const { status, body } = await book(spotId, at(DAY.create + 30, 10), at(DAY.create + 38, 10));

    expect(status).toBe(400);
    expect(body.error).toMatch(/7 days/);
  });

  it("accepts a booking of exactly 7 days", async () => {
    const { status } = await book(spotId, at(DAY.create + 50, 10), at(DAY.create + 57, 10));

    expect(status).toBe(201);
  });

  it("rejects end_time before start_time with 400", async () => {
    const { status, body } = await book(spotId, at(DAY.create, 14), at(DAY.create, 10));

    expect(status).toBe(400);
    expect(body.error).toMatch(/later/i);
  });

  it("rejects a missing field with 400 and names it", async () => {
    const { status, body } = await postJson("/create_reservation.php", {
      spot_id: spotId,
      start_time: at(DAY.create, 10),
      end_time: at(DAY.create, 11),
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/license_plate/);
  });

  it("rejects an unknown spot with 404", async () => {
    const { status } = await book(999_999, at(DAY.create, 10), at(DAY.create, 11));

    expect(status).toBe(404);
  });

  it("rejects a GET with 405", async () => {
    const { status } = await call("/create_reservation.php");

    expect(status).toBe(405);
  });

  it("applies the evening discount automatically", async () => {
    const { status, body } = await book(
      spotId,
      at(DAY.evening, 20),
      at(DAY.evening, 23),
      { discount_type: "student" },
    );

    expect(status).toBe(201);
    expect(body.data.requested_discount).toBe("student");
    expect(body.data.discount_type).toBe("evening");
    expect(body.data.discount_rate).toBe(0.25);
    expect(body.data.auto_evening).toBe(true);
    expect(body.total_price).toBeCloseTo(spotRate * 3 * 0.75, 2);
  });

  it("does not apply the evening discount to a daytime booking", async () => {
    const { status, body } = await book(
      spotId,
      at(DAY.evening + 1, 10),
      at(DAY.evening + 1, 13),
      { discount_type: "student" },
    );

    expect(status).toBe(201);
    expect(body.data.discount_type).toBe("student");
    expect(body.data.auto_evening).toBe(false);
  });

  it("treats a client-supplied 'evening' as no request rather than erroring", async () => {
    const { status, body } = await book(
      spotId,
      at(DAY.evening + 2, 10),
      at(DAY.evening + 2, 13),
      { discount_type: "evening" },
    );

    expect(status).toBe(201);
    expect(body.data.discount_type).toBe("none");
  });
});

// ============================================================
// Overlap prevention — the EXCLUDE constraint
// ============================================================
describe("overlap constraint", () => {
  const start = () => at(DAY.overlap, 10);
  const end = () => at(DAY.overlap, 14);

  it("rejects a second booking overlapping the first with 409", async () => {
    const first = await book(spotId, start(), end());
    expect(first.status).toBe(201);

    const second = await book(spotId, start(), end());

    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.error).toMatch(/already reserved/i);
  });

  it("rejects a partially overlapping booking", async () => {
    // 12:00–16:00 overlaps the 10:00–14:00 booking above by two hours.
    const { status } = await book(spotId, at(DAY.overlap, 12), at(DAY.overlap, 16));

    expect(status).toBe(409);
  });

  it("rejects a booking fully contained within an existing one", async () => {
    const { status } = await book(spotId, at(DAY.overlap, 11), at(DAY.overlap, 12));

    expect(status).toBe(409);
  });

  it("rejects a booking that fully contains an existing one", async () => {
    const { status } = await book(spotId, at(DAY.overlap, 8), at(DAY.overlap, 18));

    expect(status).toBe(409);
  });

  it("allows a back-to-back booking (tsrange is half-open)", async () => {
    const { status } = await book(spotId, at(DAY.overlap, 14), at(DAY.overlap, 16));

    expect(status).toBe(201);
  });

  it("survives concurrent identical requests — exactly one wins", async () => {
    // The real concurrency case: no read-then-write check could catch this,
    // which is why the constraint lives in the database.
    const attempts = await Promise.all([
      book(spotId, at(DAY.overlap + 1, 10), at(DAY.overlap + 1, 12)),
      book(spotId, at(DAY.overlap + 1, 10), at(DAY.overlap + 1, 12)),
      book(spotId, at(DAY.overlap + 1, 10), at(DAY.overlap + 1, 12)),
    ]);

    const created = attempts.filter((a) => a.status === 201);
    const conflicted = attempts.filter((a) => a.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(2);
  });
});

// ============================================================
// GET /get_reservations.php
// ============================================================
describe("GET /get_reservations.php", () => {
  it("returns a spot's schedule without exposing plates or prices", async () => {
    const { status, body } = await call(`/get_reservations.php?spot_id=${spotId}`);

    expect(status).toBe(200);
    expect(body.mode).toBe("spot");
    expect(body.spot.id).toBe(spotId);
    expect(body.data.length).toBeGreaterThan(0);

    for (const slot of body.data) {
      expect(slot).toHaveProperty("start_time");
      expect(slot).toHaveProperty("end_time");
      expect(slot).toHaveProperty("status");
      // Privacy: other people's plates and prices must not leak here.
      expect(slot).not.toHaveProperty("license_plate");
      expect(slot).not.toHaveProperty("total_price");
      expect(slot.status).not.toBe("cancelled");
    }
  });

  it("returns slots ordered by start time", async () => {
    const { body } = await call(`/get_reservations.php?spot_id=${spotId}`);
    const times = body.data.map((s) => s.start_time);

    expect(times).toEqual([...times].sort());
  });

  it("returns full detail in plate mode", async () => {
    const { status, body } = await call(
      `/get_reservations.php?license_plate=${encodeURIComponent(PLATE)}`,
    );

    expect(status).toBe(200);
    expect(body.mode).toBe("plate");
    expect(body.license_plate).toBe(PLATE);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("can_cancel");
    expect(body.data[0]).toHaveProperty("total_price");
  });

  it("rejects both parameters at once with 400", async () => {
    const { status } = await call(
      `/get_reservations.php?spot_id=${spotId}&license_plate=${PLATE}`,
    );

    expect(status).toBe(400);
  });

  it("rejects neither parameter with 400", async () => {
    const { status } = await call("/get_reservations.php");

    expect(status).toBe(400);
  });

  it("returns 404 for an unknown spot", async () => {
    const { status } = await call("/get_reservations.php?spot_id=999999");

    expect(status).toBe(404);
  });
});

// ============================================================
// POST /cancel_reservation.php
// ============================================================
describe("POST /cancel_reservation.php", () => {
  it("cancels an upcoming reservation and frees the slot", async () => {
    const start = at(DAY.cancel, 9);
    const end = at(DAY.cancel, 12);

    const created = await book(spotId, start, end);
    expect(created.status).toBe(201);

    const taken = await call(
      `/get_spots.php?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
    );
    expect(taken.body.data.find((s) => s.id === spotId).is_available).toBe(false);

    const { status, body } = await postJson("/cancel_reservation.php", {
      license_plate: PLATE,
      reservation_id: created.body.reservation_id,
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe("cancelled");
    expect(body.data.reservation_id).toBe(created.body.reservation_id);

    // The bay must be bookable again — the EXCLUDE constraint skips
    // cancelled rows, so cancelling genuinely releases the slot.
    const freed = await call(
      `/get_spots.php?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
    );
    expect(freed.body.data.find((s) => s.id === spotId).is_available).toBe(true);

    const rebooked = await book(spotId, start, end);
    expect(rebooked.status).toBe(201);
  });

  it("returns 409 when cancelling the same reservation twice", async () => {
    const created = await book(spotId, at(DAY.cancel + 2, 9), at(DAY.cancel + 2, 11));

    const first = await postJson("/cancel_reservation.php", {
      license_plate: PLATE,
      reservation_id: created.body.reservation_id,
    });
    expect(first.status).toBe(200);

    const second = await postJson("/cancel_reservation.php", {
      license_plate: PLATE,
      reservation_id: created.body.reservation_id,
    });

    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already been cancelled/i);
  });

  it("refuses to cancel a booking belonging to another plate", async () => {
    const created = await book(spotId, at(DAY.cancel + 4, 9), at(DAY.cancel + 4, 11));

    const { status } = await postJson("/cancel_reservation.php", {
      license_plate: "ZZ-000-ZZ",
      reservation_id: created.body.reservation_id,
    });

    // 404, not 403 — an identical response to a nonexistent ID, so the
    // endpoint can't be used to probe which IDs exist.
    expect(status).toBe(404);
  });

  it("returns 409 with options when the plate has several cancellable bookings", async () => {
    await book(spotId, at(DAY.cancel + 6, 9), at(DAY.cancel + 6, 11));
    await book(spotId, at(DAY.cancel + 7, 9), at(DAY.cancel + 7, 11));

    const { status, body } = await postJson("/cancel_reservation.php", {
      license_plate: PLATE,
    });

    expect(status).toBe(409);
    expect(Array.isArray(body.options)).toBe(true);
    expect(body.options.length).toBeGreaterThan(1);
    expect(body.options[0]).toHaveProperty("reservation_id");
    expect(body.options[0]).toHaveProperty("spot_number");
  });

  it("returns 404 for a plate with no bookings", async () => {
    const { status } = await postJson("/cancel_reservation.php", {
      license_plate: "NO-SUCH-PLATE",
    });

    expect(status).toBe(404);
  });

  it("returns 400 when license_plate is missing", async () => {
    const { status, body } = await postJson("/cancel_reservation.php", {
      reservation_id: 1,
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/license_plate/);
  });

  it("rejects a GET with 405", async () => {
    const { status } = await call("/cancel_reservation.php");

    expect(status).toBe(405);
  });
});

// ============================================================
// CORS
// ============================================================
describe("CORS", () => {
  it("answers preflight with 204", async () => {
    const response = await fetch(`${API}/get_spots.php`, { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});