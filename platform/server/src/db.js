// Database adapter. Real PostgreSQL (pg) when DATABASE_URL is set, otherwise PGlite (Postgres compiled to WASM)
// so local development and tests need no installed database. Both expose the same two calls.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(here, '..', 'schema.sql');

/** @returns {Promise<{query: (text: string, params?: any[]) => Promise<{rows: any[]}>, tx: <T>(fn: (q: Function) => Promise<T>) => Promise<T>, close: () => Promise<void>}>} */
export async function openDb({ url = process.env.DATABASE_URL, dataDir = process.env.PGLITE_DIR } = {}) {
  let db;
  if (url) {
    const { default: pg } = await import('pg');
    const ssl = /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false };
    const pool = new pg.Pool({ connectionString: url, ssl });
    db = {
      query: (text, params) => pool.query(text, params),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn((t, p) => client.query(t, p));
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = new PGlite(dataDir); // undefined = in memory
    await lite.waitReady;
    db = {
      query: (text, params) => lite.query(text, params),
      tx: (fn) => lite.transaction((t) => fn((text, params) => t.query(text, params))),
      exec: (sql) => lite.exec(sql),
      close: () => lite.close(),
    };
  }
  await db.exec(readFileSync(SCHEMA, 'utf8'));
  return db;
}
