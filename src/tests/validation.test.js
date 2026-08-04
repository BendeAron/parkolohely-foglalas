import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billableHours,
  DISCOUNTS,
  MAX_RESERVATION_DAYS,
  qualifiesForEvening,
  quotePrice,
  resolveDiscount,
  SELECTABLE_DISCOUNTS,
  validateRange,
} from "../lib/format.js";

/**
 * Build a local datetime-local string relative to now.
 * Using relative dates keeps the "is it in the past" tests honest — a
 * hardcoded date would silently start failing once it goes stale.
 */
function at(daysFromNow, hour = 12, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);

  const pad = (n) => String(n).padStart(2, "0");

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// ============================================================
// Rule 1 — no bookings that start in the past
// ============================================================
describe("past bookings are rejected", () => {
  it("rejects a start time yesterday", () => {
    const result = validateRange(at(-1, 10), at(1, 10));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/past/i);
  });

  it("rejects a start time an hour ago", () => {
    const hourAgo = new Date(Date.now() - 3_600_000);
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${hourAgo.getFullYear()}-${pad(hourAgo.getMonth() + 1)}-${pad(hourAgo.getDate())}` +
      `T${pad(hourAgo.getHours())}:${pad(hourAgo.getMinutes())}`;

    expect(validateRange(stamp, at(1, 10)).ok).toBe(false);
  });

  it("accepts a start time in the future", () => {
    expect(validateRange(at(1, 10), at(1, 14))).toEqual({ ok: true, error: null });
  });

  // The grace window is asserted against a frozen clock. Deriving the stamp
  // from the real clock races it: a datetime-local value has minute
  // precision, so truncating "30 seconds ago" can land up to 89 seconds in
  // the past and fall outside the 60s allowance.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows a start time inside the 60s grace window", () => {
    vi.useFakeTimers();

    const BOOKING = ["2030-06-01T12:00", "2030-06-01T14:00"];

    // Exactly now.
    vi.setSystemTime(new Date(2030, 5, 1, 12, 0, 0));
    expect(validateRange(...BOOKING).ok).toBe(true);

    // 30 seconds past — a picker rounded to the minute, which is the case
    // PAST_START_GRACE_SECONDS exists for.
    vi.setSystemTime(new Date(2030, 5, 1, 12, 0, 30));
    expect(validateRange(...BOOKING).ok).toBe(true);

    // 59 seconds past — still inside.
    vi.setSystemTime(new Date(2030, 5, 1, 12, 0, 59));
    expect(validateRange(...BOOKING).ok).toBe(true);
  });

  it("rejects a start time beyond the 60s grace window", () => {
    vi.useFakeTimers();

    const BOOKING = ["2030-06-01T12:00", "2030-06-01T14:00"];

    // 61 seconds past — over the line.
    vi.setSystemTime(new Date(2030, 5, 1, 12, 1, 1));
    expect(validateRange(...BOOKING).ok).toBe(false);

    // Comfortably past.
    vi.setSystemTime(new Date(2030, 5, 1, 12, 30, 0));
    expect(validateRange(...BOOKING).ok).toBe(false);
  });
});

// ============================================================
// Rule 2 — maximum 7 days
// ============================================================
describe("maximum reservation duration", () => {
  it("accepts exactly 7 days", () => {
    expect(validateRange(at(1, 10), at(8, 10)).ok).toBe(true);
  });

  it("rejects 7 days and one hour", () => {
    const result = validateRange(at(1, 10), at(8, 11));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/7 days/);
  });

  it("rejects 8 days", () => {
    expect(validateRange(at(1, 10), at(9, 10)).ok).toBe(false);
  });

  it("agrees with the documented constant", () => {
    expect(MAX_RESERVATION_DAYS).toBe(7);
  });
});

// ============================================================
// Rule 3 — automatic evening discount
// ============================================================
describe("evening window eligibility", () => {
  // [description, startHour:startMin, offsetDays, endHour:endMin, expected]
  const cases = [
    ["20:00 → 23:00, wholly inside the evening", [20, 0], 0, [23, 0], true],
    ["18:00 → 06:00, exactly the window", [18, 0], 1, [6, 0], true],
    ["22:00 → 02:00, crossing midnight", [22, 0], 1, [2, 0], true],
    ["01:00 → 05:00, the small-hours side", [1, 0], 0, [5, 0], true],
    ["18:00 → 18:30, a short evening slot", [18, 0], 0, [18, 30], true],
    ["17:59 → 20:00, starts one minute early", [17, 59], 0, [20, 0], false],
    ["20:00 → 07:00, ends one hour late", [20, 0], 1, [7, 0], false],
    ["10:00 → 14:00, plain daytime", [10, 0], 0, [14, 0], false],
    ["03:00 → 09:00, spills past 06:00", [3, 0], 0, [9, 0], false],
    ["06:00 → 07:00, 06:00 closes the window", [6, 0], 0, [7, 0], false],
    ["12:00 → 12:00 next day, 24h", [12, 0], 1, [12, 0], false],
  ];

  for (const [name, [sh, sm], offset, [eh, em], expected] of cases) {
    it(`${expected ? "qualifies" : "does not qualify"}: ${name}`, () => {
      expect(qualifiesForEvening(at(2, sh, sm), at(2 + offset, eh, em))).toBe(expected);
    });
  }

  it("never qualifies anything longer than the 12-hour window", () => {
    // The window is 12h wide, so a 13h booking cannot fit however it's placed.
    for (let hour = 0; hour < 24; hour++) {
      expect(qualifiesForEvening(at(2, hour), at(3, (hour + 13) % 24))).toBe(false);
    }
  });
});

describe("automatic evening discount application", () => {
  it("upgrades 'none' to 'evening' for a qualifying booking", () => {
    expect(resolveDiscount("none", at(2, 20), at(2, 23))).toBe("evening");
  });

  it("overrides 'student' because evening is the larger discount", () => {
    expect(resolveDiscount("student", at(2, 20), at(2, 23))).toBe("evening");
    expect(DISCOUNTS.evening.rate).toBeGreaterThan(DISCOUNTS.student.rate);
  });

  it("overrides 'senior' because evening is the larger discount", () => {
    expect(resolveDiscount("senior", at(2, 20), at(2, 23))).toBe("evening");
    expect(DISCOUNTS.evening.rate).toBeGreaterThan(DISCOUNTS.senior.rate);
  });

  it("leaves a manual discount alone during the day", () => {
    expect(resolveDiscount("student", at(2, 10), at(2, 13))).toBe("student");
  });

  it("does not offer 'evening' as a selectable option", () => {
    expect(SELECTABLE_DISCOUNTS).not.toContain("evening");
    expect(SELECTABLE_DISCOUNTS).toEqual(["none", "student", "senior"]);
  });
});

// ============================================================
// Pricing
// ============================================================
describe("price calculation", () => {
  it("bills per started hour", () => {
    expect(billableHours(at(1, 10), at(1, 12))).toBe(2);
    expect(billableHours(at(1, 10, 0), at(1, 11, 1))).toBe(2); // 61 minutes → 2h
    expect(billableHours(at(1, 10, 0), at(1, 10, 15))).toBe(1); // minimum 1h
  });

  it("computes a daytime quote with no discount", () => {
    const quote = quotePrice({
      hourlyRate: 2.5,
      start: at(2, 10),
      end: at(2, 13),
      discountType: "none",
    });

    expect(quote).toMatchObject({
      hours: 3,
      subtotal: 7.5,
      appliedType: "none",
      discount: 0,
      total: 7.5,
      autoEvening: false,
    });
  });

  it("applies the student rate during the day", () => {
    const quote = quotePrice({
      hourlyRate: 2,
      start: at(2, 10),
      end: at(2, 15),
      discountType: "student",
    });

    expect(quote.appliedType).toBe("student");
    expect(quote.subtotal).toBe(10);
    expect(quote.discount).toBe(1.5);
    expect(quote.total).toBe(8.5);
  });

  it("applies the evening rate automatically and flags the override", () => {
    const quote = quotePrice({
      hourlyRate: 2,
      start: at(2, 20),
      end: at(2, 23),
      discountType: "student",
    });

    expect(quote).toMatchObject({
      hours: 3,
      subtotal: 6,
      requestedType: "student",
      appliedType: "evening",
      autoEvening: true,
      rate: 0.25,
      discount: 1.5,
      total: 4.5,
    });
  });

  it("rounds money to two decimals", () => {
    const quote = quotePrice({
      hourlyRate: 2.5,
      start: at(2, 20),
      end: at(2, 23),
      discountType: "none",
    });

    // 7.50 × 0.25 = 1.875 → 1.88
    expect(quote.discount).toBe(1.88);
    expect(quote.total).toBe(5.62);
  });
});

// ============================================================
// Ordering / degenerate input
// ============================================================
describe("range validation edge cases", () => {
  it("rejects an end time equal to the start", () => {
    const result = validateRange(at(1, 10), at(1, 10));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/later/i);
  });

  it("rejects an end time before the start", () => {
    expect(validateRange(at(1, 14), at(1, 10)).ok).toBe(false);
  });

  it("rejects missing values", () => {
    expect(validateRange("", "").ok).toBe(false);
    expect(validateRange(null, at(1, 10)).ok).toBe(false);
  });

  it("rejects unparseable values", () => {
    expect(validateRange("not-a-date", "also-not").ok).toBe(false);
  });

  it("reports the past-date error before the duration error", () => {
    // Both rules are violated; the message should name the first one checked,
    // matching the server's ordering.
    const result = validateRange(at(-1, 10), at(20, 10));

    expect(result.error).toMatch(/past/i);
  });
});