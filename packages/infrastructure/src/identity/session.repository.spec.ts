import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Session } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleSessionRepository } from './session.repository';

const POOL_SIZE = 10;

describe('session persistence and revocation (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const clock = new ShopClock();
  const FAR_FUTURE = clock.localTimeToUtc('2026-09-01', '12:00');

  const newUser = async (): Promise<string> => {
    const id = randomUUID();
    await client`insert into users (id, email) values (${id}, ${`${id}@example.com`})`;
    return id;
  };

  const session = (userId: string): Session => ({
    id: randomUUID(),
    userId,
    expiresAt: FAR_FUTURE,
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
      .withStartupTimeout(240_000)
      .start();

    client = postgres(container.getConnectionUri(), { max: POOL_SIZE });
    db = drizzle(client);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('persists a freshly created session with its expiry', async () => {
    const userId = await newUser();
    const repo = new DrizzleSessionRepository(db);
    const toCreate = session(userId);

    await repo.create(toCreate);

    // Compare the timestamp inside SQL (same pattern as
    // hold.repository.spec.ts's `time_range = ... as exact`) rather than
    // parsing the raw-SQL string back into a Date in test code.
    const rows = await client`select user_id, revoked_at,
                                 expires_at = ${toCreate.expiresAt.toISOString()}::timestamptz as expiry_matches
                               from sessions where id = ${toCreate.id}`;
    expect(rows[0]).toEqual({ user_id: userId, revoked_at: null, expiry_matches: true });
  });

  it('revokes every active session for the given user', async () => {
    const userId = await newUser();
    const repo = new DrizzleSessionRepository(db);
    const first = session(userId);
    const second = session(userId);
    await repo.create(first);
    await repo.create(second);

    await repo.revokeAllForUser(userId);

    const rows = await client`select revoked_at from sessions where user_id = ${userId}`;
    expect(rows).toHaveLength(2);
    expect([...rows].every((row) => row.revoked_at !== null)).toBe(true);
  });

  it('never revokes a different user’s sessions', async () => {
    const targetUser = await newUser();
    const otherUser = await newUser();
    const repo = new DrizzleSessionRepository(db);
    const otherUsersSession = session(otherUser);
    await repo.create(session(targetUser));
    await repo.create(otherUsersSession);

    await repo.revokeAllForUser(targetUser);

    const rows = await client`select revoked_at from sessions where id = ${otherUsersSession.id}`;
    expect(rows[0]?.revoked_at).toBeNull();
  });
});
