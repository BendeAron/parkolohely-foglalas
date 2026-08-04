import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SquareParking, Ticket } from "lucide-react";
import TimeRangeBar from "./components/TimeRangeBar";
import SpotGrid from "./components/SpotGrid";
import ReservationDrawer from "./components/ReservationDrawer";
import CancelDrawer from "./components/CancelDrawer";
import ToastStack from "./components/ToastStack";
import { createReservation, fetchSpots } from "./api";
import { defaultRange, money, readableTime } from "./lib/format";

export default function App() {
  const [range, setRange] = useState(defaultRange);
  const [appliedRange, setAppliedRange] = useState(null); // the window the board reflects
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState([]);

  const toastId = useRef(0);

  const pushToast = useCallback((toast) => {
    toastId.current += 1;
    setToasts((current) => [...current, { id: toastId.current, ...toast }]);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const rangeInvalid = Boolean(range.start && range.end && range.end <= range.start);

  const load = useCallback(async (windowToCheck) => {
    setLoading(true);
    setLoadError(null);

    try {
      const body = await fetchSpots(windowToCheck);
      setSpots(body.data ?? []);
      setAppliedRange(windowToCheck);
    } catch (error) {
      setLoadError(error.message);
      setSpots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // First paint shows the full inventory; availability arrives once a window is checked.
  useEffect(() => {
    load(null);
  }, [load]);

  const handleCheck = () => {
    if (rangeInvalid) return;

    setSelectedSpot(null);
    load({ start: range.start, end: range.end });
  };

  const handleReserve = async (payload) => {
    setSubmitting(true);

    try {
      const body = await createReservation(payload);

      pushToast({
        tone: "success",
        title: "Reserved",
        body: `Bay ${selectedSpot.spot_number} is held for ${payload.license_plate}.`,
        code: `Reservation #${body.reservation_id} · ${money(body.total_price)}`,
      });

      setSelectedSpot(null);
      // Refresh so the bay flips to taken for everyone looking at this window.
      load(appliedRange);
    } catch (error) {
      if (error.status === 409) {
        pushToast({
          tone: "warning",
          title: "Already taken",
          body: error.message,
        });

        // Someone else got there first — pull fresh availability.
        load(appliedRange);
        setSelectedSpot(null);
      } else {
        pushToast({
          tone: "error",
          title: "Couldn't reserve",
          body: error.message,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelled = ({ reservationId, spotNumber, refund }) => {
    pushToast({
      tone: "success",
      title: "Cancelled",
      body: `Bay ${spotNumber} is back on the board.`,
      code: `Reservation #${reservationId} · ${money(refund)} due back`,
    });

    // The bay is free again in whatever window is on screen.
    load(appliedRange);
  };

  const counts = useMemo(() => {
    const free = spots.filter((s) => s.is_available).length;
    return { free, taken: spots.length - free, total: spots.length };
  }, [spots]);

  return (
    <div className="min-h-screen bg-[#14171A] text-[#D7DCDE]">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Entrance signboard */}
      <header className="border-b border-[#39424A] bg-[#1D2125]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center bg-[#F5C518] text-[#14171A]">
              <SquareParking size={22} aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-['Barlow_Condensed'] text-2xl font-extrabold uppercase leading-none tracking-[0.1em]">
                Parkoló
              </h1>
              <p className="font-['Barlow_Condensed'] text-xs uppercase tracking-[0.22em] text-[#8A959C]">
                Reserve a bay
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="flex items-center gap-2 border border-[#39424A] px-4 py-2.5
                         font-['Barlow_Condensed'] text-sm font-bold uppercase tracking-[0.14em] text-[#D7DCDE]
                         transition-colors hover:border-[#E45B5B] hover:text-[#E45B5B]
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518]"
            >
              <Ticket size={14} aria-hidden="true" />
              My booking
            </button>

            <div className="flex divide-x divide-[#39424A] border border-[#39424A]">
              <Tally value={counts.free} label="Free" accent="text-[#4CD07D]" />
              <Tally value={counts.taken} label="Taken" accent="text-[#E45B5B]" />
              <Tally value={counts.total} label="Total" accent="text-[#D7DCDE]" />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <TimeRangeBar
          range={range}
          onChange={setRange}
          onCheck={handleCheck}
          loading={loading}
          invalid={rangeInvalid}
        />

        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-['Barlow_Condensed'] text-lg font-bold uppercase tracking-[0.16em]">
              Floor plan
            </h2>
            <p className="text-sm text-[#8A959C]">
              {appliedRange
                ? `Showing availability for ${readableTime(appliedRange.start)} → ${readableTime(appliedRange.end)}`
                : "Pick a time window to see what's actually free."}
            </p>
          </div>

          <SpotGrid
            spots={spots}
            loading={loading}
            error={loadError}
            selectedId={selectedSpot?.id}
            onSelect={setSelectedSpot}
            onRetry={() => load(appliedRange)}
          />

          <Legend />
        </section>
      </main>

      {selectedSpot && (
        <ReservationDrawer
          spot={selectedSpot}
          range={appliedRange ?? range}
          submitting={submitting}
          onClose={() => setSelectedSpot(null)}
          onSubmit={handleReserve}
        />
      )}

      {cancelOpen && (
        <CancelDrawer
          onClose={() => setCancelOpen(false)}
          onCancelled={handleCancelled}
          onError={(message) =>
            pushToast({ tone: "error", title: "Couldn't cancel", body: message })
          }
        />
      )}
    </div>
  );
}

function Tally({ value, label, accent }) {
  return (
    <div className="px-4 py-2 text-center">
      <p className={`font-['IBM_Plex_Mono'] text-xl leading-none ${accent}`}>{value}</p>
      <p className="mt-1 font-['Barlow_Condensed'] text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[#8A959C]">
        {label}
      </p>
    </div>
  );
}

function Legend() {
  const items = [
    { color: "bg-[#4CD07D]", label: "Free — tap to book" },
    { color: "bg-[#F5C518]", label: "Selected" },
    { color: "bg-[#E45B5B]/60", label: "Reserved — tap to see when it frees up" },
  ];

  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#8A959C]">
      {items.map(({ color, label }) => (
        <li key={label} className="flex items-center gap-2">
          <span className={`h-1 w-6 ${color}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}