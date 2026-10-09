// Every shared piece of styling lives here. Restyle the whole panel by editing this one file.

export function Button({ variant = "default", className = "", ...props }) {
  const styles = {
    default: "bg-white border border-gray-300 text-gray-800 hover:bg-gray-100",
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    danger: "bg-white border border-red-300 text-red-700 hover:bg-red-50",
  };
  return (
    <button
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({ label, className = "", ...props }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      {label && <span className="font-medium text-gray-700">{label}</span>}
      <input className="rounded border border-gray-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none" {...props} />
    </label>
  );
}

export function Card({ title, className = "", children }) {
  return (
    <section className={`rounded-lg border border-gray-200 bg-white p-4 ${className}`}>
      {title && <h2 className="mb-3 font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function PageTitle({ title, subtitle, action }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** color: gray | green | yellow | red | blue */
export function Badge({ color = "gray", children }) {
  const colors = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-green-100 text-green-800",
    yellow: "bg-yellow-100 text-yellow-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colors[color]}`}>{children}</span>;
}

/** value: 0..1 */
export function ProgressBar({ value, color = "blue" }) {
  const colors = { blue: "bg-blue-600", green: "bg-green-600", yellow: "bg-yellow-500" };
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
      <div className={`h-full ${colors[color]}`} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p>;
}

export function Loading() {
  return <p className="text-sm text-gray-500">Loading…</p>;
}

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
export const percent = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
