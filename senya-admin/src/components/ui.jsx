import { Loader2 } from "lucide-react";

const BUTTON = {
  primary: "bg-clay text-card hover:bg-clay-deep shadow-lift",
  secondary: "bg-card text-ink hover:bg-well shadow-lift",
  ghost: "text-ink-2 hover:bg-well hover:text-ink",
  danger: "text-rust hover:bg-rust-wash",
};

export function Button({ variant = "secondary", size = "md", loading, icon: Icon, children, className = "", ...props }) {
  const sizing = size === "sm" ? "h-8 px-2.5 text-meta gap-1.5" : "h-9 px-3.5 text-body gap-2";
  return (
    <button
      className={`inline-flex shrink-0 items-center justify-center rounded-sm font-medium transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ${sizing} ${BUTTON[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon && <Icon className="size-4" />}
      {children}
    </button>
  );
}

const TONES = {
  live: "bg-clay-wash text-clay-deep",
  ok: "bg-leaf-wash text-leaf",
  busy: "bg-ochre-wash text-ochre",
  bad: "bg-rust-wash text-rust",
  plain: "bg-well text-ink-3",
};

export function Badge({ tone = "plain", children, className = "" }) {
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-caption font-medium normal-case ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** A sign drawn like an entry on an alphabet chart. Multi-letter labels (NG, _none) step down in size. */
export function Glyph({ label, size = "md", className = "" }) {
  const isNone = label === "_none";
  const text = isNone ? "∅" : label;
  const scale = {
    sm: text.length > 2 ? "text-[15px]" : "text-[22px]",
    md: text.length > 2 ? "text-[20px]" : text.length === 2 ? "text-[34px]" : "text-[44px]",
    lg: text.length > 2 ? "text-[28px]" : text.length === 2 ? "text-[48px]" : "text-[64px]",
  }[size];
  return (
    <span
      className={`font-glyph font-semibold leading-none tracking-[-0.03em] ${isNone ? "text-ink-4" : "text-ink"} ${scale} ${className}`}
    >
      {text}
    </span>
  );
}

/** Data collected toward the training threshold. Fills ochre, turns leaf once the sign is ready. */
export function Readiness({ count, target, className = "" }) {
  const ratio = Math.min(1, count / target);
  const ready = count >= target;
  return (
    <div className={className}>
      <div className="h-1.5 overflow-hidden rounded-full bg-well">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${ready ? "bg-leaf" : count ? "bg-ochre" : ""}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

export function Spinner({ className = "" }) {
  return <Loader2 className={`size-4 animate-spin text-ink-3 ${className}`} />;
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {Icon && <Icon className="size-6 text-ink-4" strokeWidth={1.5} />}
      <p className="text-h3 font-medium text-ink-2">{title}</p>
      {children && <p className="max-w-sm text-body text-ink-3">{children}</p>}
    </div>
  );
}

export const formatWhen = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

export const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
