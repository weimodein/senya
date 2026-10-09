import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

const ToastContext = createContext(() => {});

/** toast("Saved") or toast("Couldn't save", "error"). Toasts stack bottom-right and leave after 4 s. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, tone = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="rise flex items-start gap-2.5 rounded-md bg-card px-3.5 py-3 text-body shadow-float">
            {t.tone === "error" ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-rust" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-leaf" />
            )}
            <span className="text-ink-2">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
