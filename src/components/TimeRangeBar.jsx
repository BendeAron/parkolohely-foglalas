import { useEffect, useState } from "react";
import { ArrowRight, Clock, RefreshCw } from "lucide-react";
import { MAX_RESERVATION_DAYS, toInputValue } from "../lib/format";

/**
 * The entrance sign: pick your arrival and departure, then check the board.
 *
 * `min` on both inputs blocks past times in the picker UI. It's a
 * convenience, not a guarantee — the value is still typeable and the server
 * revalidates, which is why `validation` is passed in rather than trusted here.
 */
export default function TimeRangeBar({ range, onChange, onCheck, loading, validation }) {
  // Refreshed each minute so `min` doesn't go stale on a long-open tab.
  const [now, setNow] = useState(() => toInputValue(new Date()));

  useEffect(() => {
    const timer = setInterval(() => setNow(toInputValue(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);

  const maxEnd = range.start
    ? toInputValue(
        new Date(new Date(range.start).getTime() + MAX_RESERVATION_DAYS * 86_400_000),
      )
    : undefined;

  const field =
    "w-full bg-[#14171A] border border-[#39424A] text-[#D7DCDE] " +
    "font-['IBM_Plex_Mono'] text-sm px-3 py-2.5 " +
    "focus:outline-none focus:border-[#F5C518] focus:ring-1 focus:ring-[#F5C518] " +
    "[color-scheme:dark]";

  const invalid = !validation.ok;

  return (
    <section className="border border-[#39424A] bg-[#1D2125]">
      <div className="flex items-center gap-2 border-b border-[#39424A] bg-[#262C31] px-4 py-2">
        <Clock size={14} className="text-[#F5C518]" aria-hidden="true" />
        <h2 className="font-['Barlow_Condensed'] text-sm font-bold uppercase tracking-[0.18em] text-[#8A959C]">
          When are you parking?
        </h2>
        <span className="ml-auto font-['Barlow_Condensed'] text-xs uppercase tracking-[0.14em] text-[#5A646B]">
          Up to {MAX_RESERVATION_DAYS} days
        </span>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
        <div>
          <label
            htmlFor="start_time"
            className="mb-1.5 block font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.16em] text-[#8A959C]"
          >
            Arrive
          </label>
          <input
            id="start_time"
            type="datetime-local"
            className={field}
            value={range.start}
            min={now}
            onChange={(e) => onChange({ ...range, start: e.target.value })}
          />
        </div>

        <ArrowRight
          size={18}
          aria-hidden="true"
          className="mx-auto hidden self-center text-[#39424A] sm:block sm:pb-2.5"
        />

        <div>
          <label
            htmlFor="end_time"
            className="mb-1.5 block font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.16em] text-[#8A959C]"
          >
            Leave
          </label>
          <input
            id="end_time"
            type="datetime-local"
            className={field}
            value={range.end}
            min={range.start || now}
            max={maxEnd}
            onChange={(e) => onChange({ ...range, end: e.target.value })}
          />
        </div>

        <button
          type="button"
          onClick={onCheck}
          disabled={loading || invalid}
          className="flex items-center justify-center gap-2 bg-[#F5C518] px-6 py-2.5
                     font-['Barlow_Condensed'] text-sm font-bold uppercase tracking-[0.16em] text-[#14171A]
                     transition-colors hover:bg-[#FFD530]
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1D2125]
                     disabled:cursor-not-allowed disabled:bg-[#39424A] disabled:text-[#8A959C]"
        >
          <RefreshCw
            size={14}
            aria-hidden="true"
            className={loading ? "motion-safe:animate-spin" : ""}
          />
          {loading ? "Checking" : "Check availability"}
        </button>
      </div>

      {invalid && (
        <p
          role="alert"
          className="border-t border-[#39424A] px-4 py-2 text-sm text-[#E45B5B]"
        >
          {validation.error}
        </p>
      )}
    </section>
  );
}