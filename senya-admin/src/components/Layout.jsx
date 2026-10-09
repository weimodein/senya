import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Boxes, LogOut, Shapes, Smartphone } from "lucide-react";
import { models, MODELS_CHANGED } from "../api/index.js";
import { useAuth } from "../context/AuthContext.jsx";

const NAV = [
  { to: "/", label: "Signs", icon: Shapes, end: true },
  { to: "/models", label: "Models", icon: Boxes },
];

/** Which version phones are downloading right now: the one fact worth seeing from every page. */
function LiveModel() {
  const { pathname } = useLocation();
  const [live, setLive] = useState(undefined);
  useEffect(() => {
    const refresh = () =>
      models
        .list()
        .then((list) => setLive(list.find((m) => m.status === "deployed") || null))
        .catch(() => setLive(undefined));
    refresh();
    window.addEventListener(MODELS_CHANGED, refresh);
    return () => window.removeEventListener(MODELS_CHANGED, refresh);
  }, [pathname]);

  if (live === undefined) return null;
  return (
    <div className="rounded-md bg-well px-3 py-2.5">
      <div className="eyebrow flex items-center gap-1.5">
        <Smartphone className="size-3" /> On phones
      </div>
      <div className="mt-1 text-h3 font-semibold text-ink num">
        {live ? `Version ${live.version}` : <span className="font-medium text-ink-3">Nothing deployed</span>}
      </div>
      {live?.labels && <div className="mt-0.5 truncate text-meta text-ink-3">{live.labels.join(" ")}</div>}
    </div>
  );
}

export default function Layout() {
  const { admin, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-rule px-3 py-5">
        <div className="flex items-baseline gap-2 px-2">
          <span className="font-glyph text-[22px] font-semibold leading-none tracking-[-0.03em]">Senya</span>
          <span className="text-caption font-medium uppercase text-ink-4">admin</span>
        </div>
        <nav className="mt-7 flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-body font-medium transition-colors duration-150 ${
                  isActive ? "bg-card text-ink shadow-lift" : "text-ink-3 hover:bg-well hover:text-ink"
                }`
              }
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <LiveModel />
          <div className="flex items-center justify-between px-2">
            <span className="truncate text-meta text-ink-3">{admin?.username}</span>
            <button
              onClick={logout}
              className="rounded-sm p-1.5 text-ink-3 transition-colors hover:bg-well hover:text-ink"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-10 py-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
