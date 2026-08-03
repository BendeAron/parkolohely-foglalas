import { Accessibility, Car, Check, Zap } from "lucide-react";
import { money, SPOT_TYPES } from "../lib/format";

const TYPE_ICON = {
  standard: Car,
  electric: Zap,
  handicapped: Accessibility,
};

/**
 * One bay on the floor plan. Free bays are painted green and clickable;
 * taken bays get hazard tape across them and drop out of the tab order.
 */
export default function SpotCard({ spot, selected, onSelect }) {
  const Icon = TYPE_ICON[spot.spot_type] ?? Car;
  const typeLabel = SPOT_TYPES[spot.spot_type]?.label ?? spot.spot_type;
  const free = spot.is_available;

  const base =
    "group relative flex min-h-[9rem] flex-col justify-between overflow-hidden " +
    "border-2 p-3 text-left transition-colors duration-150";

  const state = !free
    ? "cursor-not-allowed border-[#39424A] bg-[#1A1E21]"
    : selected
      ? "border-[#F5C518] bg-[#F5C518]/10"
      : "border-[#4CD07D] bg-[#1D2125] hover:bg-[#4CD07D]/10 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518] focus-visible:ring-offset-2 focus-visible:ring-offset-[#14171A]";

  return (
    <button
      type="button"
      disabled={!free}
      aria-pressed={free ? selected : undefined}
      aria-label={`Spot ${spot.spot_number}, ${typeLabel}, ${
        free ? `${money(spot.hourly_rate)} per hour, available` : "already reserved"
      }`}
      onClick={() => free && onSelect(spot)}
      className={`${base} ${state}`}
    >
      {/* Hazard tape marks a bay you can't take. */}
      {!free && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, #F5C518 0 8px, transparent 8px 16px)",
          }}
        />
      )}

      <div className="relative flex items-start justify-between">
        <span
          className={`font-['IBM_Plex_Mono'] text-2xl font-medium tracking-tight ${
            free ? "text-[#D7DCDE]" : "text-[#5A646B]"
          }`}
        >
          {spot.spot_number}
        </span>

        {selected && free ? (
          <Check size={18} className="text-[#F5C518]" aria-hidden="true" />
        ) : (
          <Icon
            size={18}
            aria-hidden="true"
            className={free ? "text-[#8A959C]" : "text-[#4A545B]"}
          />
        )}
      </div>

      <div className="relative">
        <p
          className={`font-['Barlow_Condensed'] text-xs font-bold uppercase tracking-[0.16em] ${
            free ? "text-[#8A959C]" : "text-[#4A545B]"
          }`}
        >
          {typeLabel}
        </p>

        <p
          className={`mt-1 font-['IBM_Plex_Mono'] text-sm ${
            free ? "text-[#D7DCDE]" : "text-[#5A646B]"
          }`}
        >
          {money(spot.hourly_rate)}
          <span className="text-[#8A959C]"> /h</span>
        </p>
      </div>

      {/* Painted curb line along the bottom of the bay. */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 h-1 ${
          !free ? "bg-[#E45B5B]/50" : selected ? "bg-[#F5C518]" : "bg-[#4CD07D]"
        }`}
      />
    </button>
  );
}