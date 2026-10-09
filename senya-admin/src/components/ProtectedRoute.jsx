import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Spinner } from "./ui.jsx";

export default function ProtectedRoute({ children }) {
  const { admin, checking } = useAuth();
  const location = useLocation();
  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }
  return admin ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
