import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleClientAccountRepository } from './client-account.repository';

// cuenta-cliente-persistente: `findByEmail` is the single-hop lookup
// `RequestClientAccessUseCase` now uses instead of the old
// phone -> client -> account two-hop (see that use case's own doc comment).
// No prior spec covered this file at all — `findByClientId`/`create` were
// only ever exercised indirectly through E2E suites; this is the first
// direct, real-Postgres coverage for the repository.
describe('DrizzleClientAccountRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const newClient = async (): Promise<string> => {
    const id = randomUUID();
    await client`insert into clients (id, name, phone) values (${id}, 'Cliente Test', '3510000000')`;
    return id;
  };

  const newStaffUser = async (email: string): Promise<void> => {
    await client`insert into users (id, email) values (${randomUUID()}, ${email})`;
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
      .withStartupTimeout(240_000)
      .start();

    client = postgres(container.getConnectionUri());
    db = drizzle(client);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('resolves a client account by its email', async () => {
    const clientId = await newClient();
    const repo = new DrizzleClientAccountRepository(db);
    const created = await repo.create({ clientId, email: 'sofia@example.com' });

    const found = await repo.findByEmail('sofia@example.com');

    expect(found).toEqual(created);
  });

  it('returns null for an email that is not on file at all', async () => {
    const repo = new DrizzleClientAccountRepository(db);

    const found = await repo.findByEmail('nadie@example.com');

    expect(found).toBeNull();
  });

  // The non-disclosure discipline `RequestClientAccessUseCase` relies on:
  // a STAFF account's email (no `client_id`) must resolve to null here too,
  // exactly like `DrizzleClientContextRepository` excludes staff sessions —
  // this port governs client accounts only.
  it('returns null for an email that belongs to a STAFF user, never a client account', async () => {
    await newStaffUser('dueno@jcbarberia.test');
    const repo = new DrizzleClientAccountRepository(db);

    const found = await repo.findByEmail('dueno@jcbarberia.test');

    expect(found).toBeNull();
  });
});
