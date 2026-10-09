import { Children, forwardRef, useEffect, useId, useRef, useState } from "react";

const control =
  "rounded-xl border border-[#CBD5E1] bg-white text-[#202630] shadow-[0_1px_2px_rgba(32,38,48,0.04)] outline-none transition placeholder:text-[#8B95A5] focus:border-[#32669A] focus:ring-4 focus:ring-[#8BB8E8]/25 disabled:cursor-not-allowed disabled:bg-[#F1F3F6] disabled:text-[#98A2B3]";

export const Button = forwardRef(function Button({ variant = "default", className = "", ...props }, ref) {
  const styles = {
    default: "border border-[#C7D5E7] bg-white text-[#32669A] hover:border-[#8BB8E8] hover:bg-[#F7FBFF]",
    primary: "border border-[#32669A] bg-[#32669A] text-white hover:bg-[#27567F]",
    danger: "border border-[#E7A5A5] bg-white text-[#B34B4B] hover:bg-[#FFF4F4]",
    quiet: "border border-transparent bg-transparent text-[#636B77] hover:bg-[#EEF2F6] hover:text-[#202630]",
  };

  return (
    <button
      ref={ref}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8BB8E8]/35 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
});

export function Input({ label, className = "", ...props }) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm ${className}`}>
      {label && <span className="font-semibold text-[#202630]">{label}</span>}
      <input className={`${control} min-h-11 px-3 text-sm`} {...props} />
    </label>
  );
}

export function Select({ label, className = "", children, value, onChange, disabled = false, ...props }) {
  const options = Children.toArray(children).filter(Boolean);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const id = useId();
  const labelId = `${id}-label`;
  const selectedIndex = Math.max(0, options.findIndex((option) => String(option.props.value) === String(value)));
  const selected = options[selectedIndex];

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  const choose = (option) => {
    onChange?.({ target: { ...props, value: option.props.value } });
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(selectedIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + options.length) % options.length);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[activeIndex]);
    }
  };

  return (
    <div ref={rootRef} className={`relative flex flex-col gap-1.5 text-sm ${className}`}>
      {label && <span id={labelId} className="font-semibold text-[#202630]">{label}</span>}
      <button
        type="button"
        id={props.id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={label ? labelId : undefined}
        onClick={() => setOpen((isOpen) => !isOpen)}
        onKeyDown={onKeyDown}
        className={`${control} flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm`}
      >
        <span className="truncate">{selected?.props.children}</span>
        <span aria-hidden="true" className={`text-[#636B77] transition ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <div role="listbox" aria-labelledby={label ? labelId : undefined} className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-[#CBD5E1] bg-white p-1 shadow-[0_14px_32px_rgba(32,38,48,0.16)]">
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isActive = index === activeIndex;
            return (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                key={String(option.props.value)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
                className={`flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm transition ${isSelected ? "bg-[#E8F2FF] font-semibold text-[#32669A]" : "text-[#364152]"} ${isActive ? "bg-[#F2F7FC]" : ""}`}
              >
                {option.props.children}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", onConfirm, onCancel }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    cancelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#202630]/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="w-full max-w-md rounded-2xl border border-[#DDE4ED] bg-white p-6 shadow-[0_24px_60px_rgba(32,38,48,0.24)]">
        <h2 id="confirm-dialog-title" className="text-lg font-bold text-[#202630]">{title}</h2>
        {description && <p className="mt-2 text-sm leading-6 text-[#636B77]">{description}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button ref={cancelRef} variant="quiet" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function Card({ title, eyebrow, action, className = "", children }) {
  return (
    <section className={`rounded-2xl border border-[#DDE4ED] bg-white p-5 shadow-[0_1px_2px_rgba(32,38,48,0.02)] sm:p-6 ${className}`}>
      {(eyebrow || title || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#7A8493]">{eyebrow}</p>}
            {title && <h2 className="text-lg font-bold tracking-[-0.02em] text-[#202630]">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ eyebrow, title, subtitle, action }) {
  return (
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#7A8493]">{eyebrow}</p>}
        <h1 className="text-[2rem] font-bold leading-tight tracking-[-0.035em] text-[#202630] sm:text-[2.25rem]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-base leading-6 text-[#636B77]">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** color: gray | green | yellow | red | blue */
export function Badge({ color = "gray", children }) {
  const colors = {
    gray: "bg-[#EEF1F5] text-[#636B77]",
    green: "bg-[#E5F7EC] text-[#177245]",
    yellow: "bg-[#FFF5D9] text-[#8A6516]",
    red: "bg-[#FFF0F0] text-[#B34B4B]",
    blue: "bg-[#E8F2FF] text-[#32669A]",
  };
  return <span className={`inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-semibold ${colors[color]}`}>{children}</span>;
}

/** value: 0..1 */
export function ProgressBar({ value, color = "blue", className = "" }) {
  const colors = { blue: "bg-[#32669A]", green: "bg-[#24A660]", yellow: "bg-[#D49A24]", gray: "bg-[#CBD3DE]" };
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-[#E4E9F0] ${className}`}>
      <div className={`h-full rounded-full transition-[width] ${colors[color]}`} style={{ width: `${Math.min(100, Math.max(0, (value || 0) * 100))}%` }} />
    </div>
  );
}

export function Readiness({ value, ready, label }) {
  return (
    <div className="flex min-w-[190px] items-center gap-3">
      <ProgressBar value={value} color={ready ? "green" : "gray"} className="min-w-20 flex-1" />
      <span className="w-10 shrink-0 text-xs font-semibold text-[#636B77]">{Math.round(Math.min(1, value || 0) * 100)}%</span>
      <Badge color={ready ? "green" : "gray"}>{label || (ready ? "Ready" : "Needs data")}</Badge>
    </div>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p role="alert" className="rounded-xl border border-[#F0C3C3] bg-[#FFF4F4] px-4 py-3 text-sm text-[#A63D3D]">{children}</p>;
}

export function Loading() {
  return <p className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white px-5 py-8 text-sm text-[#636B77]">Loading…</p>;
}

export function StatusIcon({ type = "info" }) {
  if (type === "check") {
    return <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#E5F7EC] text-[#177245]">✓</span>;
  }
  return <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#A8B4C4] text-xs font-bold text-[#636B77]">i</span>;
}

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
export const percent = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
