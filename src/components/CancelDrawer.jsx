import { useEffect, useRef, useState } from "react";
import { CircleSlash, Loader2, Search, TriangleAlert, X } from "lucide-react";
import { cancelReservation, fetchReservationsByPlate } from "../api";
import { money, readableTime } from "../lib/format";

/**
 * Three steps in one panel: enter a plate, pick from what comes back,
 * confirm the one you meant. Ineligible bookings are listed too — greyed
 * out with the reason, so nobody wonders why their booking vanished.
 */
export default function CancelDrawer({ onClose, onCancelled, onError }) {
  const [plate, setPlate] = useState("");
  const [reservations, setReservations] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const plateRef = useRef(null);

  useEffect(() => {
    plateRef.current?.focus();

    const onKeyDown = (e) => e.key === "Escape" && onClose();

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const normalised = plate.trim().toUpperCase();
  const plateValid = /^[A-Z0-9 -]{2,15}$/.test(normalised);

  const search = async () => {
    if (!plateValid || searching) return;

    setSearching(true);
    setLookupError(null);
    setConfirmId(null);

    try {
      const body = await fetchReservationsByPlate(normalised);
      setReservations(body.data ?? []);
    } catch (error) {
      setLookupError(error.message);
      setReservations(null);
    } finally {
      setSearching(false);
    }
  };

  const confirmCancel = async (reservation) => {
    setCancellingId(reservation.id);

    try {
      const body = await cancelReservation({
        licensePlate: normalised,
        reservationId: reservation.id,
      });

      // Drop it from the list rather than refetching — one fewer round trip,
      // and the row the user just acted on disappears immediately.
      setReservations((current) => current.filter((r) => r.id !== reservation.id));
      setConfirmId(null);

      onCancelled({
        reservationId: body.reservation_id,
        spotNumber: body.data.spot_number,
        refund: body.data.refund_due,
      });
    } catch (error) {
      // 400 means it started while the panel was open; refresh so the row
      // shows its real state instead of a stale Cancel button.
      if (error.status === 400 || error.status === 409) {
        search();
      }

      onError(error.message);
    } finally {
      setCancellingId(null);
    }
  };

  const label =
    "mb-1.5 block font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.16em] text-[#8A959C]";

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/70 motion-safe:animate-[fadeIn_150ms_ease-out]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-title"
        className="relative z-10 max-h-[92vh] w-full overflow-y-auto border-t-2 border-[#E45B5B]
                   bg-[#1D2125] sm:max-w-lg sm:border-2
                   motion-safe:animate-[slideUp_180ms_ease-out]"
      >
        <header className="flex items-start justify-between border-b border-[#39424A] bg-[#262C31] px-5 py-4">
          <div>
            <p className="font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.18em] text-[#8A959C]">
              Manage bookings
            </p>
            <h2
              id="cancel-title"
              className="font-['Barlow_Condensed'] text-2xl font-extrabold uppercase leading-none tracking-[0.08em] text-[#D7DCDE]"
            >
              Cancel a reservation
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-[#8A959C] transition-colors hover:text-[#D7DCDE]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-5 px-5 py-5">
          {/* Step 1 — find the booking */}
          <div>
            <label htmlFor="cancel_plate" className={label}>
              Licence plate
            </label>
            <div className="flex gap-2">
              <input
                id="cancel_plate"
                ref={plateRef}
                type="text"
                autoComplete="off"
                maxLength={15}
                placeholder="ZR-123-AB"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && search()}
                className="min-w-0 flex-1 border border-[#39424A] bg-[#14171A] px-3 py-2.5
                           font-['IBM_Plex_Mono'] uppercase tracking-widest text-[#D7DCDE]
                           placeholder:normal-case placeholder:tracking-normal placeholder:text-[#4A545B]
                           focus:border-[#F5C518] focus:outline-none focus:ring-1 focus:ring-[#F5C518]"
              />
              <button
                type="button"
                onClick={search}
                disabled={!plateValid || searching}
                className="flex shrink-0 items-center gap-2 bg-[#F5C518] px-5
                           font-['Barlow_Condensed'] text-sm font-bold uppercase tracking-[0.16em] text-[#14171A]
                           transition-colors hover:bg-[#FFD530]
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1D2125]
                           disabled:cursor-not-allowed disabled:bg-[#39424A] disabled:text-[#8A959C]"
              >
                {searching ? (
                  <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Search size={14} aria-hidden="true" />
                )}
                Find
              </button>
            </div>
          </div>

          {lookupError && (
            <p role="alert" className="text-sm text-[#E45B5B]">
              {lookupError}
            </p>
          )}

          {/* Step 2 — pick one */}
          {reservations !== null && reservations.length === 0 && (
            <div className="border border-[#39424A] bg-[#14171A] px-4 py-6 text-center text-sm text-[#8A959C]">
              No upcoming bookings for {normalised}. Check the plate and try again.
            </div>
          )}

          {reservations !== null && reservations.length > 0 && (
            <ul className="space-y-2">
              {reservations.map((r) => {
                const confirming = confirmId === r.id;
                const busy = cancellingId === r.id;

                return (
                  <li
                    key={r.id}
                    className={`border px-4 py-3 ${
                      r.can_cancel
                        ? "border-[#39424A] bg-[#14171A]"
                        : "border-[#262C31] bg-[#171A1D]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          className={`font-['IBM_Plex_Mono'] text-lg ${
                            r.can_cancel ? "text-[#D7DCDE]" : "text-[#5A646B]"
                          }`}
                        >
                          {r.spot_number}
                        </p>
                        <p className="mt-0.5 text-sm text-[#8A959C]">
                          {readableTime(r.start_time)} → {readableTime(r.end_time)}
                        </p>
                        <p className="mt-0.5 font-['IBM_Plex_Mono'] text-xs text-[#8A959C]">
                          #{r.id} · {money(r.total_price)} · {r.status}
                        </p>
                      </div>

                      {r.can_cancel ? (
                        <button
                          type="button"
                          onClick={() => setConfirmId(confirming ? null : r.id)}
                          disabled={busy}
                          className="shrink-0 border border-[#E45B5B] px-4 py-2
                                     font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.14em] text-[#E45B5B]
                                     transition-colors hover:bg-[#E45B5B] hover:text-[#14171A]
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E45B5B]
                                     disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {confirming ? "Keep it" : "Cancel"}
                        </button>
                      ) : (
                        <span className="flex shrink-0 items-center gap-1.5 font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.14em] text-[#5A646B]">
                          <CircleSlash size={12} aria-hidden="true" />
                          {r.status === "active" ? "In progress" : "Locked"}
                        </span>
                      )}
                    </div>

                    {/* Step 3 — confirm. Destructive and irreversible, so it
                        never happens on a single click. */}
                    {confirming && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#39424A] pt-3">
                        <TriangleAlert
                          size={16}
                          className="shrink-0 text-[#F5C518]"
                          aria-hidden="true"
                        />
                        <p className="min-w-0 flex-1 text-sm text-[#D7DCDE]">
                          Cancel bay {r.spot_number} on {readableTime(r.start_time)}? This
                          can't be undone.
                        </p>
                        <button
                          type="button"
                          onClick={() => confirmCancel(r)}
                          disabled={busy}
                          className="flex items-center gap-2 bg-[#E45B5B] px-4 py-2
                                     font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.14em] text-[#14171A]
                                     transition-colors hover:bg-[#F06E6E]
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E45B5B]
                                     disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {busy && (
                            <Loader2
                              size={12}
                              className="motion-safe:animate-spin"
                              aria-hidden="true"
                            />
                          )}
                          {busy ? "Cancelling" : "Yes, cancel it"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {reservations === null && !lookupError && (
            <p className="text-sm text-[#8A959C]">
              Enter the plate you booked with to see your upcoming reservations. Bookings
              that have already started can't be cancelled.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}