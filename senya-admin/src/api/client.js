// The panel's only HTTP client (docs/architecture.md §5.2). Relative URLs: Vite proxies them in dev, and in
// production senya-backend serves this panel from the same origin.
import axios from "axios";

const TOKEN_KEY = "senya.token";

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: stay logged in for this tab only */
    }
  },
};

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "" });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.endsWith("/auth/login")) onUnauthorized();
    return Promise.reject(err);
  },
);

/** The backend always answers errors as {message}. */
export const errorMessage = (err) =>
  err?.response?.data?.message ||
  (err?.code === "ERR_NETWORK" ? "Can't reach the backend. Is senya-backend running?" : err?.message) ||
  "Something went wrong";

export default api;
