/**
 * These rules mirror create_reservation.php exactly. If you change the
 * discount table or the rounding rule on the server, change it here too —
 * otherwise the preview price and the charged price drift apart.
 */

export const DISCOUNTS = {
  none: { label: "No discount", rate: 0 },
  student: { label: "Student", rate: 0.15 },
  senior: { label: "Senior", rate: 0.2 },
  evening: { label: "Evening", rate: 0.25 },
};

export const EVENING_DISCOUNT_FROM_HOUR = 18;

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

export function isEveningEligible(start) {
  if (!start) return false;

  return new Date(start).getHours() >= EVENING_DISCOUNT_FROM_HOUR;
}

/**
 * @returns {{hours: number, subtotal: number, rate: number, discount: number, total: number}}
 */
export function quotePrice({ hourlyRate, start, end, discountType }) {
  const hours = billableHours(start, end);
  const subtotal = round2(hourlyRate * hours);

  const eligible = discountType !== "evening" || isEveningEligible(start);
  const rate = eligible ? (DISCOUNTS[discountType]?.rate ?? 0) : 0;

  const discount = round2(subtotal * rate);

  return { hours, subtotal, rate, discount, total: round2(subtotal - discount) };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function money(value) {
  return value.toLocaleString(undefined, {
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