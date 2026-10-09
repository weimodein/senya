import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the panel talks to senya-backend on :8000 through this proxy (same-origin, no CORS).
// In production senya-backend serves the built panel itself, so relative URLs work everywhere.
const backend = process.env.VITE_BACKEND_URL || "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": backend, "/models": backend, "/health": backend },
  },
});
