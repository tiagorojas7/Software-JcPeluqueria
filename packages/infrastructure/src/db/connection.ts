import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test';

const client = postgres(connectionString);

/** Drizzle db handle. Schema is added table-by-table starting Phase 1. */
export const db = drizzle(client);

/** The raw `postgres` client, for the rare caller that needs to end the pool
 *  itself — a long-running process (API, worker) never does this, pg-boss
 *  and Nest's shutdown hooks own their own connections instead; a one-shot
 *  script (`db/seed.ts`) is the actual reason this is exported. */
export const sqlClient = client;
