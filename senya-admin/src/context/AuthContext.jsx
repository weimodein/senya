import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { auth } from "../api/index.js";
import { setUnauthorizedHandler, tokenStore } from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [checking, setChecking] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.set(null);
    setAdmin(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    auth
      .me()
      .then(setAdmin)
      .catch(logout)
      .finally(() => setChecking(false));
  }, [logout]);

  const login = useCallback(async (username, password) => {
    const res = await auth.login(username, password);
    tokenStore.set(res.token);
    setAdmin(res.admin);
  }, []);

  const value = useMemo(() => ({ admin, checking, login, logout }), [admin, checking, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
