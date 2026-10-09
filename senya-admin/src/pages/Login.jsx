import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { errorMessage } from "../api/client.js";
import { Button } from "../components/ui.jsx";

export default function Login() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (admin) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-end gap-3">
          <span className="font-glyph text-[56px] font-semibold leading-[0.8] tracking-[-0.04em]">Senya</span>
          <span className="pb-1 text-caption font-medium uppercase text-ink-4">admin</span>
        </div>
        <form onSubmit={submit} className="panel flex flex-col gap-4 p-6">
          <div>
            <h1 className="text-h2 font-semibold">Sign in</h1>
            <p className="mt-1 text-body text-ink-3">Manage signs, upload clips and ship models to phones.</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-ink-2">Username</span>
            <input
              className="field"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-ink-2">Password</span>
            <input
              className="field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="rounded-sm bg-rust-wash px-3 py-2 text-meta text-rust">{error}</p>}
          <Button variant="primary" type="submit" loading={busy} className="mt-1 w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
