import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { fetchSpotSchedule } from "../api";
import { splitByDay } from "../lib/format";

const HOUR_MARKS = [0, 6, 12, 18, 24];

/**
 * A 24-hour track per day with the occupied windows painted on it.
 * Bookings that cross midnight are clipped into one block per day.
 */
export default function SpotSchedule({ spotId, highlight }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchSpotSchedule(spotId)
      .then((body) => {
        if (!cancelled) setSlots(body.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [spotId]);

  const days = splitByDay(slots);

  return (
    <section className="border border-[#39424A] bg-[#14171A]">
      <header className="flex items-center gap-2 border-b border-[#39424A] px-4 py-2.5">
        <CalendarClock size={14} className="text-[#8A959C]" aria-hidden="true" />
        <h3 className="font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.18em] text-[#8A959C]">
          Already booked
        </h3>
        {loading && (
          <Loader2 size={12} className="ml-auto motion-safe:animate-spin text-[#8A959C]" aria-hidden="true" />
        )}
      </header>

      <div className="px-4 py-3">
        {error && <p className="text-sm text-[#E45B5B]">{error}</p>}

        {!loading && !error && days.length === 0 && (
          <p className="text-sm text-[#8A959C]">
            Nothing booked here yet — the whole bay is open.
          </p>
        )}

        {days.length > 0 && (
          <>
            <div className="space-y-3">
              {days.map((day) => (
                <div key={day.key}>
                  <p className="mb-1 font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.16em] text-[#D7DCDE]">
                    {day.label}
                  </p>

                  {/* 24-hour track */}
                  <div className="relative h-6 border border-[#262C31] bg-[#1D2125]">
                    {HOUR_MARKS.slice(1, -1).map((hour) => (
                      <span
                        key={hour}
                        aria-hidden="true"
                        className="absolute inset-y-0 w-px bg-[#262C31]"
                        style={{ left: `${(hour / 24) * 100}%` }}
                      />
                    ))}

                    {day.blocks.map((block) => (
                      <span
                        key={block.id}
                        title={`${block.startLabel} – ${block.endLabel} (${block.status})`}
                        className={`absolute inset-y-0 ${
                          block.status === "active"
                            ? "bg-[#E45B5B]"
                            : "bg-[#E45B5B]/45"
                        } ${
                          highlight === block.reservationId
                            ? "ring-2 ring-inset ring-[#F5C518]"
                            : ""
                        }`}
                        style={{ left: `${block.leftPct}%`, width: `${block.widthPct}%` }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-1.5 flex justify-between font-['IBM_Plex_Mono'] text-[0.65rem] text-[#5A646B]">
              {HOUR_MARKS.map((hour) => (
                <span key={hour}>{String(hour % 24).padStart(2, "0")}</span>
              ))}
            </div>

            {/* The bars give the shape; the list gives the exact times. */}
            <ul className="mt-3 space-y-1 border-t border-[#262C31] pt-3 font-['IBM_Plex_Mono'] text-xs">
              {slots.map((slot) => (
                <li key={slot.id} className="flex items-center justify-between gap-3">
                  <span className="text-[#D7DCDE]">
                    {slot.start_time.replace("T", " ").slice(0, 16)} →{" "}
                    {slot.end_time.replace("T", " ").slice(11, 16)}
                  </span>
                  <span
                    className={
                      slot.status === "active" ? "text-[#E45B5B]" : "text-[#8A959C]"
                    }
                  >
                    {slot.status === "active" ? "in progress" : "booked"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}