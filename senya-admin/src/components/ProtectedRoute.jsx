import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Loading } from "./ui.jsx";

export default function ProtectedRoute({ children }) {
  const { admin, checking } = useAuth();
  const location = useLocation();
  if (checking) return <Loading />;
  return admin ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
