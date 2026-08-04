/**
 * These rules mirror create_reservation.php exactly. If you change the
 * discount table, the rounding rule, the 7-day cap or the evening window on
 * the server, change it here too — otherwise the preview and the charge drift
 * apart. The two implementations are duplicated by necessity (PHP / JS);
 * they are not independent sources of truth. The server always wins.
 */

export const DISCOUNTS = {
  none: { label: "No discount", rate: 0 },
  student: { label: "Student", rate: 0.15 },
  senior: { label: "Senior", rate: 0.2 },
  evening: { label: "Evening", rate: 0.25 },
};

/** What the driver can pick. `evening` is granted automatically, never chosen. */
export const SELECTABLE_DISCOUNTS = ["none", "student", "senior"];

/** The overnight window, inclusive at both edges: 18:00 → 06:00 next day. */
export const EVENING_WINDOW_START_HOUR = 18;
export const EVENING_WINDOW_END_HOUR = 6;

export const MAX_RESERVATION_DAYS = 7;
export const MAX_RESERVATION_MS = MAX_RESERVATION_DAYS * 24 * 3_600_000;

export const SPOT_TYPES = {
  standard: { label: "Standard" },
  electric: { label: "Electric" },
  handicapped: { label: "Accessible" },
};

/** Format a Date as the value a datetime-local input expects. */
export function toInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Next full hour, through the following two hours — a sensible first guess. */
export function defaultRange() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);

  const end = new Date(start);
  end.setHours(end.getHours() + 2);

  return { start: toInputValue(start), end: toInputValue(end) };
}

/** Whole hours between two datetime-local strings, rounded up. Minimum 1. */
export function billableHours(start, end) {
  if (!start || !end) return 0;

  const ms = new Date(end) - new Date(start);
  if (!Number.isFinite(ms) || ms <= 0) return 0;

  return Math.max(1, Math.ceil(ms / 3_600_000));
}

/**
 * True when the whole interval sits inside one 18:00 → 06:00 window.
 * Mirrors qualifies_for_evening() in create_reservation.php.
 */
export function qualifiesForEvening(start, end) {
  if (!start || !end) return false;

  const from = new Date(start);
  const to = new Date(end);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;

  const durationMinutes = Math.round((to - from) / 60_000);
  if (durationMinutes <= 0) return false;

  const startMinutes = from.getHours() * 60 + from.getMinutes();
  const eveningOpens = EVENING_WINDOW_START_HOUR * 60;
  const morningCloses = EVENING_WINDOW_END_HOUR * 60;

  let minutesLeftInWindow;

  if (startMinutes >= eveningOpens) {
    minutesLeftInWindow = 24 * 60 + morningCloses - startMinutes;
  } else if (startMinutes <= morningCloses) {
    minutesLeftInWindow = morningCloses - startMinutes;
  } else {
    return false; // daytime
  }

  return durationMinutes <= minutesLeftInWindow;
}

/** The evening rate is granted automatically when it's worth at least as much. */
export function resolveDiscount(requested, start, end) {
  if (!qualifiesForEvening(start, end)) return requested;

  return DISCOUNTS.evening.rate >= (DISCOUNTS[requested]?.rate ?? 0)
    ? "evening"
    : requested;
}

/**
 * Every reason a window can be rejected, in the order the server checks them.
 *
 * @returns {{ok: boolean, error: string|null}}
 */
export function validateRange(start, end) {
  if (!start || !end) {
    return { ok: false, error: "Pick an arrival and a departure time." };
  }

  const from = new Date(start);
  const to = new Date(end);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, error: "Those times aren't valid dates." };
  }

  if (to <= from) {
    return { ok: false, error: "Set a departure time later than your arrival time." };
  }

  // 60s of slack, matching PAST_START_GRACE_SECONDS on the server.
  if (from.getTime() < Date.now() - 60_000) {
    return { ok: false, error: "Reservations can't start in the past." };
  }

  if (to - from > MAX_RESERVATION_MS) {
    return { ok: false, error: `Reservations can't exceed ${MAX_RESERVATION_DAYS} days.` };
  }

  return { ok: true, error: null };
}

/**
 * @returns {{hours, subtotal, requestedType, appliedType, autoEvening, rate, discount, total}}
 */
export function quotePrice({ hourlyRate, start, end, discountType }) {
  const hours = billableHours(start, end);
  const subtotal = round2(hourlyRate * hours);

  const appliedType = resolveDiscount(discountType, start, end);
  const rate = DISCOUNTS[appliedType]?.rate ?? 0;
  const discount = round2(subtotal * rate);

  return {
    hours,
    subtotal,
    requestedType: discountType,
    appliedType,
    autoEvening: appliedType === "evening" && discountType !== "evening",
    rate,
    discount,
    total: round2(subtotal - discount),
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function money(value) {
  return Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "Mon 3 Aug, 10:00" — compact enough for the sign bar. */
export function readableTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "14:30" */
export function timeOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "Today", "Tomorrow", or "Mon 3 Aug" */
export function dayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((midnight(date) - midnight(new Date())) / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const DAY_MS = 86_400_000;

/**
 * Split reservations into per-day rows, clipping any booking that crosses
 * midnight so each day's track only ever holds 0–100% segments.
 *
 * @returns {Array<{key: string, label: string, blocks: Array}>}
 */
export function splitByDay(reservations) {
  const days = new Map();

  for (const item of reservations) {
    const start = new Date(item.start_time);
    const end = new Date(item.end_time);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());

    while (cursor < end) {
      const dayEnd = new Date(cursor.getTime() + DAY_MS);
      const from = start > cursor ? start : cursor;
      const to = end < dayEnd ? end : dayEnd;

      const key = `${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`;

      if (!days.has(key)) {
        days.set(key, { key, label: dayLabel(cursor), sort: cursor.getTime(), blocks: [] });
      }

      days.get(key).blocks.push({
        id: `${item.id}-${key}`,
        reservationId: item.id,
        status: item.status,
        leftPct: ((from - cursor) / DAY_MS) * 100,
        widthPct: Math.max(((to - from) / DAY_MS) * 100, 0.8), // keep hairline slots visible
        startLabel: timeOnly(item.start_time),
        endLabel: timeOnly(item.end_time),
        continuesBefore: start < cursor,
        continuesAfter: end > dayEnd,
      });

      cursor = dayEnd;
    }
  }

  return [...days.values()].sort((a, b) => a.sort - b.sort);
}