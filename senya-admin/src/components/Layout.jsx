import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import JobDock from "./JobDock.jsx";

function navClass({ isActive }) {
  return `relative inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold transition ${
    isActive ? "border-[#32669A] text-[#32669A]" : "border-transparent text-[#636B77] hover:text-[#202630]"
  }`;
}

function StatusItem({ label }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-[#636B77]" title={`${label} status is not reported by the current backend`}>
      <span className="h-2 w-2 rounded-full bg-[#B7C0CC]" aria-hidden="true" />
      {label} · Status not reported
    </span>
  );
}

export default function Layout() {
  const { admin, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#202630]">
      <header className="sticky top-0 z-50 border-b border-[#DDE4ED] bg-white shadow-[0_1px_0_rgba(32,38,48,0.03)]">
        <nav className="mx-auto flex min-h-[72px] w-full min-w-0 max-w-[1160px] flex-wrap items-center gap-x-7 gap-y-1 overflow-hidden px-5 py-3 sm:px-8 lg:px-10" aria-label="Admin navigation">
          <Link to="/" className="mr-2 inline-flex min-h-11 items-center gap-2" aria-label="SENYA admin home">
            <img src="/brand/senya-logo-primary.svg" alt="SENYA" className="h-9 w-auto" />
            <span className="text-sm font-semibold text-[#636B77]">Admin</span>
          </Link>

          <div className="order-3 flex w-full items-center gap-6 sm:order-none sm:w-auto">
            <NavLink to="/" end className={navClass}>
              Signs
            </NavLink>
            <NavLink to="/models" className={navClass}>
              Models
            </NavLink>
          </div>

          <div className="ml-auto hidden items-center gap-5 xl:flex">
            <StatusItem label="Server" />
            <StatusItem label="ML service" />
          </div>

          <div className="order-4 flex min-h-11 basis-full items-center justify-start gap-4 border-t border-[#E1E6ED] pt-2 text-sm sm:order-none sm:ml-0 sm:basis-auto sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <span className="font-semibold text-[#636B77]">{admin?.username}</span>
            <button onClick={logout} className="font-medium text-[#636B77] transition hover:text-[#202630] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8BB8E8]/35">
              Log out
            </button>
          </div>
        </nav>
      </header>

      <main className="mx-auto min-w-0 w-full max-w-[1160px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
        <Outlet />
      </main>
      <JobDock />
    </div>
  );
}
