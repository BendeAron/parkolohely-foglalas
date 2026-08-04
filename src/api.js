const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

/**
 * Thrown for any non-2xx response. `status` lets callers branch on 409, 404, etc.
 */
export class ApiError extends Error {
  constructor(message, status, detail, body = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    // Full payload, so callers can read extra fields like the `options` list
    // a 409 from cancel_reservation.php returns.
    this.body = body;
  }
}

async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(
      "The server returned a response that isn't valid JSON.",
      response.status,
    );
  }
}

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    // fetch only rejects on network-level failures, not HTTP error codes.
    throw new ApiError(
      "Can't reach the server. Check that the API is running on " + API_BASE + ".",
      0,
    );
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw new ApiError(
      body.error ?? `Request failed with status ${response.status}.`,
      response.status,
      body.detail,
      body,
    );
  }

  return body;
}

/**
 * @param {{start: string, end: string} | null} range - datetime-local values, or null for no filter
 */
export function fetchSpots(range) {
  const params = new URLSearchParams();

  if (range?.start && range?.end) {
    params.set("start_time", range.start);
    params.set("end_time", range.end);
  }

  const query = params.toString();

  return request(`/get_spots.php${query ? `?${query}` : ""}`);
}

export function createReservation(payload) {
  return request("/create_reservation.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Occupied windows for one spot. Plates and prices are not returned by the
 * server — this is only about when the bay is busy.
 */
export function fetchSpotSchedule(spotId) {
  return request(`/get_reservations.php?spot_id=${encodeURIComponent(spotId)}`);
}

/** Every upcoming reservation for a plate, each flagged with `can_cancel`. */
export function fetchReservationsByPlate(licensePlate, { includePast = false } = {}) {
  const params = new URLSearchParams({ license_plate: licensePlate });

  if (includePast) params.set("include_past", "1");

  return request(`/get_reservations.php?${params.toString()}`);
}

/**
 * Cancel a booking. `reservationId` is optional when the plate has exactly
 * one cancellable booking; when several exist the server answers 409 and
 * puts the choices in `error.options`.
 */
export function cancelReservation({ licensePlate, reservationId = null }) {
  return request("/cancel_reservation.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      license_plate: licensePlate,
      ...(reservationId !== null ? { reservation_id: reservationId } : {}),
    }),
  });
}