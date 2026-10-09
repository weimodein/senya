import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  console.error('ADMIN_TOKEN is not set. Set it in the environment (a long random string); the server will not start without it.');
  process.exit(1);
}
const db = await openDb({ dataDir: process.env.PGLITE_DIR || path.join(here, '..', 'data', 'pgdata') });
const app = createApp(db, { adminToken, webDir: path.join(here, '..', '..', 'web', 'dist') });
const port = Number(process.env.PORT) || 8000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Senya platform on :${port} (${process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite local database'})`);
});
