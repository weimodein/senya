import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { errorMessage } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

function EyeIcon({ closed }) {
  return closed ? (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.1A10.9 10.9 0 0 1 12 4.9c5.3 0 8.8 4.6 9.8 7.1a.9.9 0 0 1 0 .6 13.6 13.6 0 0 1-3.2 4.3M6.3 6.3A13.5 13.5 0 0 0 2.2 12a.9.9 0 0 0 0 .6c1 2.5 4.5 7.1 9.8 7.1 1.5 0 2.8-.3 4-.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.2 12c1-2.5 4.5-7.1 9.8-7.1s8.8 4.6 9.8 7.1a.9.9 0 0 1 0 .6c-1 2.5-4.5 7.1-9.8 7.1S3.2 15.1 2.2 12.6a.9.9 0 0 1 0-.6Z" strokeLinejoin="round" />
      <circle cx="12" cy="12.3" r="3" />
    </svg>
  );
}

function StatusIcon({ locked }) {
  return locked ? (
    <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) : (
    <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" /></svg>
  );
}

function Workflow() {
  const steps = ["Upload", "Train", "Review", "Publish"];
  return (
    <div className="grid min-w-0 grid-cols-2 items-center gap-2 text-xs font-medium text-slate-500 sm:grid-cols-4 sm:gap-4">
      {steps.map((step, index) => (
        <div className="flex min-w-0 items-center gap-2 sm:gap-4" key={step}>
          <span>{step}</span>
          {index < steps.length - 1 && <span aria-hidden="true" className="text-base font-normal text-slate-400">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function Login() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  if (admin) return <Navigate to="/" replace />;

  const locked = Boolean(error) && /too many failed login attempts/i.test(error);
  const disabled = busy || locked;
  const visibleError = locked ? "Too many attempts, try again in 15 minutes" : error;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err?.response?.status === 401 ? "Incorrect username or password." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen w-full max-w-full items-start justify-center overflow-x-hidden bg-slate-100 p-4 text-slate-950 sm:p-6 lg:items-center lg:p-8">
      <div className="my-0 grid min-w-0 w-full max-w-full grid-cols-1 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-lg sm:my-2 sm:max-w-5xl lg:my-0 lg:grid-cols-2">
        <section className="flex min-w-0 min-h-[460px] flex-col justify-between bg-slate-50 px-7 py-8 sm:px-10 sm:py-10 lg:min-h-[590px]" aria-labelledby="brand-title">
          <img src="/brand/senya-logo-primary.svg" alt="SENYA" className="h-10 w-auto sm:h-11" />

          <div className="my-12 max-w-md lg:my-0">
            <h1 id="brand-title" className="w-full max-w-sm text-4xl font-bold leading-[1.05] tracking-tight text-slate-950 sm:text-5xl"><span>Better models. </span><span className="block">Clearer signs.</span></h1>
            <p className="mt-5 max-w-[18rem] break-words text-lg leading-7 text-slate-500 sm:max-w-sm">Train static and motion models, review accuracy, and publish updates for the SENYA app.</p>
          </div>

          <Workflow />
        </section>

        <section className="flex min-w-0 min-h-[460px] flex-col bg-white px-7 py-8 sm:px-10 sm:py-10 lg:min-h-[590px] lg:px-14" aria-labelledby="login-title">
          <p className="text-right text-xs font-medium text-slate-500">Admin platform</p>
          <div className="mx-auto flex w-full max-w-xs flex-1 flex-col justify-center py-8">
            <p className="text-xs font-medium text-slate-500">Team access</p>
            <h2 id="login-title" className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Admin sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Manage SENYA&apos;s sign models.</p>

            <form onSubmit={submit} className="mt-7 space-y-4" aria-busy={busy}>
              <div>
                <label htmlFor="username" className="text-xs font-medium text-slate-700">Username</label>
                <input id="username" className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus disabled={disabled} required />
              </div>
              <div>
                <label htmlFor="password" className="text-xs font-medium text-slate-700">Password</label>
                <div className="relative mt-1">
                  <input id="password" className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" value={password} onChange={(event) => setPassword(event.target.value)} type={passwordVisible ? "text" : "password"} autoComplete="current-password" disabled={disabled} required />
                  <button type="button" className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-500 outline-none hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:text-slate-300" onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? "Hide password" : "Show password"} disabled={disabled}>
                    <span className="h-4 w-4"><EyeIcon closed={passwordVisible} /></span>
                  </button>
                </div>
              </div>
              {visibleError && <p role="alert" className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700"><StatusIcon locked={locked} /><span>{visibleError}</span></p>}
              <button className="w-full rounded-md bg-blue-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400" type="submit" disabled={disabled}>{busy ? "Signing in…" : "Sign in"}</button>
            </form>
            <p className="mt-3 text-center text-[11px] text-slate-400">Static letters + J/Z motion</p>
          </div>
        </section>
      </div>
    </main>
  );
}
