import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { SESSION_TTL_MINUTES_BY_SUBJECT } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleClientContextRepository } from './client-context.repository';

// cablear-el-mvp C.2/C.4 RED (extended by cuenta-cliente-persistente for the
// rolling-session renewal): the client-session counterpart to
// `actor-context.repository.spec.ts`: resolves a session id straight to
// `{userId, clientId, sessionExpiresAt}` for a client account (`users.client_id`
// set, `users.role_id` NULL), the exact opposite predicate
// `DrizzleActorContextRepository` uses.
describe('client context resolution (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  // A REAL clock (never `new Date()` directly — the repo-wide ESLint rule
  // allows it only inside ShopClock/FakeClock): every fixture below is
  // expressed RELATIVE to "now" via `clock.addMinutes`, never as a hardcoded
  // calendar date, because Postgres' own `now()` (what the renewal SQL
  // compares against) is real wall-clock time. A fixed future literal like
  // "2026-09-01" would silently drift in or out of the renewal window
  // depending on when the suite happens to run.
  const clock = new ShopClock();
  const TTL_MINUTES = SESSION_TTL_MINUTES_BY_SUBJECT.client;
  const PAST = clock.addMinutes(clock.now(), -60);
  // Comfortably more than half the TTL remains — must NOT renew.
  const WELL_WITHIN_LIFE = clock.addMinutes(clock.now(), TTL_MINUTES - 60);
  // Less than half the TTL remains — MUST renew back out to the full TTL.
  const DUE_FOR_RENEWAL = clock.addMinutes(clock.now(), 60);

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
      values (${id}, ${userId}, ${(overrides.expiresAt ?? WELL_WITHIN_LIFE).toISOString()}, ${overrides.revokedAt?.toISOString() ?? null})
    `;
    return id;
  };

  // Compares the persisted timestamp INSIDE SQL (same pattern
  // `session.repository.spec.ts` already established) rather than parsing
  // the raw-query result back into a JS Date in test code.
  const expiryMatches = async (sessionId: string, expected: Date): Promise<boolean> => {
    const rows = await client`
      select expires_at = ${expected.toISOString()}::timestamptz as matches
      from sessions where id = ${sessionId}
    `;
    return Boolean(rows[0]?.matches);
  };

  const expiryWithin = async (sessionId: string, min: Date, max: Date): Promise<boolean> => {
    const rows = await client`
      select expires_at >= ${min.toISOString()}::timestamptz
             and expires_at <= ${max.toISOString()}::timestamptz as within
      from sessions where id = ${sessionId}
    `;
    return Boolean(rows[0]?.within);
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

  it('resolves an active client session to userId, clientId and its current expiry', async () => {
    const clientId = await newClient();
    const userId = await newClientUser(clientId);
    const sessionId = await newSession(userId, { expiresAt: WELL_WITHIN_LIFE });
    const repo = new DrizzleClientContextRepository(db, clock);

    const context = await repo.resolveBySessionId(sessionId);

    expect(context?.userId).toBe(userId);
    expect(context?.clientId).toBe(clientId);
    // Well within its life: no renewal, the exact original expiry comes back.
    expect(context?.sessionExpiresAt.getTime()).toBe(WELL_WITHIN_LIFE.getTime());
  });

  it('returns null for a staff session — access-control never governs clients, and this port never governs staff', async () => {
    const userId = await newStaffUser();
    const sessionId = await newSession(userId);
    const repo = new DrizzleClientContextRepository(db, clock);

    const context = await repo.resolveBySessionId(sessionId);

    expect(context).toBeNull();
  });

  it('returns null for a session id that does not exist', async () => {
    const repo = new DrizzleClientContextRepository(db, clock);

    const context = await repo.resolveBySessionId(randomUUID());

    expect(context).toBeNull();
  });

  it('returns null for an expired client session', async () => {
    const clientId = await newClient();
    const userId = await newClientUser(clientId);
    const sessionId = await newSession(userId, { expiresAt: PAST });
    const repo = new DrizzleClientContextRepository(db, clock);

    const context = await repo.resolveBySessionId(sessionId);

    expect(context).toBeNull();
  });

  it('returns null for a revoked client session, even before its expiry', async () => {
    const clientId = await newClient();
    const userId = await newClientUser(clientId);
    const sessionId = await newSession(userId, { revokedAt: clock.now() });
    const repo = new DrizzleClientContextRepository(db, clock);

    const context = await repo.resolveBySessionId(sessionId);

    expect(context).toBeNull();
  });

  // cuenta-cliente-persistente: the rolling-session renewal itself.
  describe('rolling renewal', () => {
    it('extends a session back out to the full TTL once less than half its life remains', async () => {
      const clientId = await newClient();
      const userId = await newClientUser(clientId);
      const sessionId = await newSession(userId, { expiresAt: DUE_FOR_RENEWAL });
      const repo = new DrizzleClientContextRepository(db, clock);

      const before = clock.now();
      const context = await repo.resolveBySessionId(sessionId);
      const after = clock.now();

      expect(context).not.toBeNull();
      // Renewed to (roughly) now + the full client TTL — bounded by the
      // real wall-clock window this test call took, never an exact literal.
      const minExpected = clock.addMinutes(before, TTL_MINUTES);
      const maxExpected = clock.addMinutes(after, TTL_MINUTES);
      expect(await expiryWithin(sessionId, minExpected, maxExpected)).toBe(true);
      // The RETURNED value must correspond to what got persisted — a
      // renewal that only lived in the return value would leave the NEXT
      // request's read (and Postgres' own idea of validity) unchanged. Only
      // to millisecond tolerance: Postgres' `timestamptz` keeps microsecond
      // precision, a JS `Date` cannot, so `clock.parseInstant` necessarily
      // rounds — exact SQL equality against the truncated value would be a
      // false negative, not a real behavioural gap.
      const ONE_MS_IN_MINUTES = 1 / 60_000;
      const oneMsBefore = clock.addMinutes(context!.sessionExpiresAt, -ONE_MS_IN_MINUTES);
      const oneMsAfter = clock.addMinutes(context!.sessionExpiresAt, ONE_MS_IN_MINUTES);
      expect(await expiryWithin(sessionId, oneMsBefore, oneMsAfter)).toBe(true);
    });

    it('does NOT renew, and does NOT write, a session with comfortably more than half its life left', async () => {
      const clientId = await newClient();
      const userId = await newClientUser(clientId);
      const sessionId = await newSession(userId, { expiresAt: WELL_WITHIN_LIFE });
      const repo = new DrizzleClientContextRepository(db, clock);

      const context = await repo.resolveBySessionId(sessionId);

      expect(context).not.toBeNull();
      expect(await expiryMatches(sessionId, WELL_WITHIN_LIFE)).toBe(true);
    });

    it('never renews a REVOKED session even when it is otherwise due — revocation must stay a single, final statement', async () => {
      const clientId = await newClient();
      const userId = await newClientUser(clientId);
      const sessionId = await newSession(userId, { expiresAt: DUE_FOR_RENEWAL, revokedAt: clock.now() });
      const repo = new DrizzleClientContextRepository(db, clock);

      const context = await repo.resolveBySessionId(sessionId);

      expect(context).toBeNull();
      expect(await expiryMatches(sessionId, DUE_FOR_RENEWAL)).toBe(true);
    });
  });
});
