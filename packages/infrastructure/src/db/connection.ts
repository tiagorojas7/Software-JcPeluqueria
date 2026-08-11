import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test';

const client = postgres(connectionString);

/** Drizzle db handle. Schema is added table-by-table starting Phase 1. */
export const db = drizzle(client);
