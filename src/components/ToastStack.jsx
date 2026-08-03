import { useEffect } from "react";
import { CircleAlert, CircleCheck, TriangleAlert, X } from "lucide-react";

const TONE = {
  success: {
    Icon: CircleCheck,
    frame: "border-[#4CD07D] bg-[#12251B]",
    accent: "text-[#4CD07D]",
  },
  error: {
    Icon: CircleAlert,
    frame: "border-[#E45B5B] bg-[#2A1618]",
    accent: "text-[#E45B5B]",
  },
  warning: {
    Icon: TriangleAlert,
    frame: "border-[#F5C518] bg-[#2A2313]",
    accent: "text-[#F5C518]",
  },
};

function Toast({ toast, onDismiss }) {
  const { Icon, frame, accent } = TONE[toast.tone] ?? TONE.error;

  useEffect(() => {
    if (toast.tone === "success") return; // confirmations stay until dismissed

    const timer = setTimeout(() => onDismiss(toast.id), 7000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-3 border-l-4 border-y border-r border-y-[#39424A] border-r-[#39424A] px-4 py-3 shadow-lg motion-safe:animate-[slideIn_180ms_ease-out] ${frame}`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${accent}`} aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="font-['Barlow_Condensed'] text-sm font-bold uppercase tracking-[0.14em] text-[#D7DCDE]">
          {toast.title}
        </p>
        {toast.body && <p className="mt-0.5 text-sm text-[#A8B2B8]">{toast.body}</p>}
        {toast.code && (
          <p className="mt-1.5 font-['IBM_Plex_Mono'] text-sm text-[#D7DCDE]">{toast.code}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 text-[#8A959C] transition-colors hover:text-[#D7DCDE]
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518]"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-96">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}