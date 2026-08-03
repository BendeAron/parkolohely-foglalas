const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

/**
 * Thrown for any non-2xx response. `status` lets callers branch on 409, 404, etc.
 */
export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
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