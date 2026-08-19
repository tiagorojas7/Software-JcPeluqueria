import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleClientContextRepository } from './client-context.repository';

// cablear-el-mvp C.2/C.4 RED — the client-session counterpart to
// `actor-context.repository.spec.ts`: resolves a session id straight to
// `{userId, clientId}` for a client account (`users.client_id` set,
// `users.role_id` NULL), the exact opposite predicate
// `DrizzleActorContextRepository` uses.
describe('client context resolution (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const clock = new ShopClock();
  const FAR_FUTURE = clock.localTimeToUtc('2026-09-01', '12:00');
  const PAST = clock.localTimeToUtc('2020-01-01', '12:00');

  const newClient = async (): Promise<string> => {
    const id = randomUUID();
    await client`insert into clients (id, name, phone) values (${id}, 'Cliente Test', '3510000000')`;
    return id;
  };

  const newClientUser = async (clientId: string): Promise<string> => {
    const id = randomUUID();
    await client`
      insert into users (id, email, client_id)
      values (${id}, ${`${id}@example.com`}, ${clientId})
    `;
    return id;
  };

  const newStaffUser = async (): Promise<string> => {
    const id = randomUUID();
    await client`insert into users (id, email) values (${id}, ${`${id}@example.com`})`;
    return id;
  };

  const newSession = async (
    userId: string,
    overrides: { expiresAt?: Date; revokedAt?: Date } = {},
  ): Promise<string> => {
    const id = randomUUID();
    await client`
      insert into sessions (id, user_id, expires_at, revoked_at)
      values (${id}, ${userId}, ${(overrides.expiresAt ?? FAR_FUTURE).toISOString()}, ${overrides.revokedAt?.toISOString() ?? null})
    `;
    return id;
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

  it('resolves an active client session to userId and clientId', async () => {
    const clientId = await newClient();
    const userId = await newClientUser(clientId);
    const sessionId = await newSession(userId);
    const repo = new DrizzleClientContextRepository(db);

    const context = await repo.resolveBySessionId(sessionId);

    expect(context).toEqual({ userId, clientId });
  });

  it('returns null for a staff session — access-control never governs clients, and this port never governs staff', async () => {
    const userId = await newStaffUser();
    const sessionId = await newSession(userId);
    const repo = new DrizzleClientContextRepository(db);

    const context = await repo.resolveBySessionId(sessionId);

    expect(context).toBeNull();
  });

  it('returns null for a session id that does not exist', async () => {
    const repo = new DrizzleClientContextRepository(db);

    const context = await repo.resolveBySessionId(randomUUID());

    expect(context).toBeNull();
  });

  it('returns null for an expired client session', async () => {
    const clientId = await newClient();
    const userId = await newClientUser(clientId);
    const sessionId = await newSession(userId, { expiresAt: PAST });
    const repo = new DrizzleClientContextRepository(db);

    const context = await repo.resolveBySessionId(sessionId);

    expect(context).toBeNull();
  });

  it('returns null for a revoked client session, even before its expiry', async () => {
    const clientId = await newClient();
    const userId = await newClientUser(clientId);
    const sessionId = await newSession(userId, { revokedAt: clock.now() });
    const repo = new DrizzleClientContextRepository(db);

    const context = await repo.resolveBySessionId(sessionId);

    expect(context).toBeNull();
  });
});
