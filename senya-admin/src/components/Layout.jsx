import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const linkClass = ({ isActive }) => `text-sm font-medium ${isActive ? "text-blue-600" : "text-gray-600 hover:text-gray-900"}`;

export default function Layout() {
  const { admin, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <span className="font-bold">Senya Admin</span>
          <NavLink to="/" end className={linkClass}>
            Signs
          </NavLink>
          <NavLink to="/models" className={linkClass}>
            Models
          </NavLink>
          <span className="ml-auto text-sm text-gray-500">{admin?.username}</span>
          <button onClick={logout} className="text-sm text-gray-600 hover:text-gray-900">
            Log out
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
