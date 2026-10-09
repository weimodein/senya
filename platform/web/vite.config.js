import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the page talks to the API server (default :8000, override with SENYA_API).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.SENYA_API || 'http://127.0.0.1:8000' } },
});
