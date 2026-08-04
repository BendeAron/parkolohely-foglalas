import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import SpotSchedule from "./SpotSchedule";
import {
  DISCOUNTS,
  EVENING_DISCOUNT_FROM_HOUR,
  isEveningEligible,
  money,
  quotePrice,
  readableTime,
  SPOT_TYPES,
} from "../lib/format";

/**
 * Bottom drawer on phones, centred panel from `sm` up.
 *
 * Two modes, driven by `spot.is_available`:
 *   free  → schedule + booking form
 *   taken → schedule only, so the driver can see when the bay frees up
 *
 * The price preview recalculates on every keystroke using the same rules
 * the server applies, so the number here is the number that gets charged.
 */
export default function ReservationDrawer({ spot, range, onClose, onSubmit, submitting }) {
  const [licensePlate, setLicensePlate] = useState("");
  const [discountType, setDiscountType] = useState("none");
  const [touched, setTouched] = useState(false);
  const plateRef = useRef(null);

  // Reset the form whenever a different bay is opened.
  useEffect(() => {
    setLicensePlate("");
    setDiscountType("none");
    setTouched(false);
    plateRef.current?.focus();
  }, [spot?.id]);

  useEffect(() => {
    const onKeyDown = (e) => e.key === "Escape" && onClose();

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!spot) return null;

  const bookable = spot.is_available;
  const eveningBlocked = discountType === "evening" && !isEveningEligible(range.start);
  const plate = licensePlate.trim().toUpperCase();
  const plateValid = /^[A-Z0-9 -]{2,15}$/.test(plate);

  const quote = quotePrice({
    hourlyRate: spot.hourly_rate,
    start: range.start,
    end: range.end,
    discountType,
  });

  const canSubmit = plateValid && !eveningBlocked && quote.hours > 0 && !submitting;

  const handleSubmit = () => {
    setTouched(true);
    if (!canSubmit) return;

    onSubmit({
      spot_id: spot.id,
      license_plate: plate,
      start_time: range.start,
      end_time: range.end,
      discount_type: discountType,
    });
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
        aria-labelledby="drawer-title"
        className={`relative z-10 max-h-[92vh] w-full overflow-y-auto border-t-2 bg-[#1D2125]
                    sm:max-w-md sm:border-2 motion-safe:animate-[slideUp_180ms_ease-out]
                    ${bookable ? "border-[#F5C518]" : "border-[#E45B5B]"}`}
      >
        <header className="flex items-start justify-between border-b border-[#39424A] bg-[#262C31] px-5 py-4">
          <div>
            <p className="font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.18em] text-[#8A959C]">
              {bookable ? "Booking bay" : "Bay taken"}
            </p>
            <h2
              id="drawer-title"
              className={`font-['IBM_Plex_Mono'] text-3xl font-medium ${
                bookable ? "text-[#F5C518]" : "text-[#E45B5B]"
              }`}
            >
              {spot.spot_number}
            </h2>
            <p className="mt-0.5 text-sm text-[#8A959C]">
              {SPOT_TYPES[spot.spot_type]?.label ?? spot.spot_type} ·{" "}
              {money(spot.hourly_rate)} per hour
            </p>
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
          <dl className="grid grid-cols-2 gap-3 border border-[#39424A] bg-[#14171A] p-3 text-sm">
            <div>
              <dt className={label}>Arrive</dt>
              <dd className="font-['IBM_Plex_Mono'] text-[#D7DCDE]">
                {readableTime(range.start)}
              </dd>
            </div>
            <div>
              <dt className={label}>Leave</dt>
              <dd className="font-['IBM_Plex_Mono'] text-[#D7DCDE]">
                {readableTime(range.end)}
              </dd>
            </div>
          </dl>

          {/* Shown in both modes: knowing the gaps helps you pick a window. */}
          <SpotSchedule spotId={spot.id} />

          {!bookable ? (
            <div className="border border-[#E45B5B]/40 bg-[#E45B5B]/5 px-4 py-3 text-sm text-[#D7DCDE]">
              This bay is taken for the window you checked. Pick a gap from the schedule
              above, change your times, and check again.
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="license_plate" className={label}>
                  Licence plate
                </label>
                <input
                  id="license_plate"
                  ref={plateRef}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  maxLength={15}
                  placeholder="ZR-123-AB"
                  value={licensePlate}
                  onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                  onBlur={() => setTouched(true)}
                  className="w-full border border-[#39424A] bg-[#14171A] px-3 py-2.5
                             font-['IBM_Plex_Mono'] uppercase tracking-widest text-[#D7DCDE]
                             placeholder:normal-case placeholder:tracking-normal placeholder:text-[#4A545B]
                             focus:border-[#F5C518] focus:outline-none focus:ring-1 focus:ring-[#F5C518]"
                />
                {touched && !plateValid && (
                  <p className="mt-1.5 text-sm text-[#E45B5B]">
                    Use 2–15 characters: letters, digits, spaces or hyphens.
                  </p>
                )}
              </div>

              <div>
                <span className={label}>Discount</span>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(DISCOUNTS).map(([key, { label: name, rate }]) => {
                    const active = discountType === key;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDiscountType(key)}
                        className={`border px-3 py-2 text-left transition-colors
                                    focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518] ${
                                      active
                                        ? "border-[#F5C518] bg-[#F5C518]/10 text-[#F5C518]"
                                        : "border-[#39424A] text-[#8A959C] hover:border-[#5A646B] hover:text-[#D7DCDE]"
                                    }`}
                      >
                        <span className="block font-['Barlow_Condensed'] text-sm font-bold uppercase tracking-[0.12em]">
                          {name}
                        </span>
                        <span className="font-['IBM_Plex_Mono'] text-xs opacity-70">
                          {rate > 0 ? `\u2212${Math.round(rate * 100)}%` : "full price"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {eveningBlocked && (
                  <p className="mt-2 text-sm text-[#E45B5B]">
                    The evening discount needs an arrival at {EVENING_DISCOUNT_FROM_HOUR}:00
                    or later. Pick another discount or move your arrival time.
                  </p>
                )}
              </div>

              {/* Price preview — mirrors the server's per-started-hour rounding. */}
              <div className="border border-[#39424A] bg-[#14171A]">
                <div className="space-y-1.5 px-4 py-3 font-['IBM_Plex_Mono'] text-sm">
                  <div className="flex justify-between text-[#8A959C]">
                    <span>
                      {quote.hours} h × {money(spot.hourly_rate)}
                    </span>
                    <span>{money(quote.subtotal)}</span>
                  </div>

                  {quote.discount > 0 && (
                    <div className="flex justify-between text-[#4CD07D]">
                      <span>{DISCOUNTS[discountType].label}</span>
                      <span>{"\u2212"}{money(quote.discount)}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-baseline justify-between border-t border-[#39424A] px-4 py-3">
                  <span className="font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.18em] text-[#8A959C]">
                    Total
                  </span>
                  <span className="font-['IBM_Plex_Mono'] text-2xl text-[#F5C518]">
                    {money(quote.total)}
                  </span>
                </div>

                <p className="border-t border-[#39424A] px-4 py-2 text-xs text-[#8A959C]">
                  Charged per started hour.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex w-full items-center justify-center gap-2 bg-[#F5C518] py-3
                           font-['Barlow_Condensed'] text-base font-bold uppercase tracking-[0.16em] text-[#14171A]
                           transition-colors hover:bg-[#FFD530]
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1D2125]
                           disabled:cursor-not-allowed disabled:bg-[#39424A] disabled:text-[#8A959C]"
              >
                {submitting && (
                  <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />
                )}
                {submitting ? "Reserving" : `Reserve for ${money(quote.total)}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}