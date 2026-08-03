import { AlertTriangle, ParkingCircle } from "lucide-react";
import SpotCard from "./SpotCard";

function Skeleton() {
  return (
    <div className="min-h-[9rem] border-2 border-[#262C31] bg-[#1D2125] motion-safe:animate-pulse" />
  );
}

export default function SpotGrid({ spots, loading, error, selectedId, onSelect, onRetry }) {
  const grid =
    "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

  if (loading) {
    return (
      <div className={grid} aria-busy="true" aria-label="Loading parking spots">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-[#E45B5B]/40 bg-[#E45B5B]/5 p-8 text-center">
        <AlertTriangle size={24} className="mx-auto text-[#E45B5B]" aria-hidden="true" />
        <p className="mt-3 text-[#D7DCDE]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 border border-[#39424A] px-5 py-2
                     font-['Barlow_Condensed'] text-sm font-bold uppercase tracking-[0.16em] text-[#D7DCDE]
                     transition-colors hover:border-[#F5C518] hover:text-[#F5C518]
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518]"
        >
          Try again
        </button>
      </div>
    );
  }

  if (spots.length === 0) {
    return (
      <div className="border border-[#39424A] bg-[#1D2125] p-10 text-center">
        <ParkingCircle size={24} className="mx-auto text-[#8A959C]" aria-hidden="true" />
        <p className="mt-3 text-[#8A959C]">
          No spots are set up in this garage yet. Add rows to{" "}
          <code className="font-['IBM_Plex_Mono'] text-[#D7DCDE]">parking_spots</code> to see
          them here.
        </p>
      </div>
    );
  }

  return (
    <div className={grid}>
      {spots.map((spot) => (
        <SpotCard
          key={spot.id}
          spot={spot}
          selected={spot.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}