import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Role } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleActorContextRepository } from './actor-context.repository';

// Resolving a session id into "who is allowed to do what" is the exact seam
// PermissionsGuard needs populated before it can do anything but deny (see
// permissions.guard.ts's own doc comment on the seam it reads). One
// container for the whole file — startup is the expensive part, same
// reasoning as availability's repositories.spec.ts.
describe('actor context resolution (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const clock = new ShopClock();
  // Same fixed-future/fixed-past convention as session.repository.spec.ts
  // and auth-challenge.repository.spec.ts: far enough from "now" on both
  // sides that it never collides with whenever this suite actually runs.
  const FAR_FUTURE = clock.localTimeToUtc('2026-09-01', '12:00');
  const PAST = clock.localTimeToUtc('2020-01-01', '12:00');

  const roleIdByName = async (name: Role): Promise<string> => {
    const rows = await client`select id from roles where name = ${name}`;
    return rows[0]?.id as string;
  };

  const newBarber = async (): Promise<string> => {
    const id = randomUUID();
    await client`insert into barbers (id, name) values (${id}, 'Test Barber')`;
    return id;
  };

  const newUser = async (overrides: { role?: Role; barberId?: string } = {}): Promise<string> => {
    const id = randomUUID();
    const roleId = overrides.role ? await roleIdByName(overrides.role) : null;
    await client`
      insert into users (id, email, role_id, barber_id)
      values (${id}, ${`${id}@example.com`}, ${roleId}, ${overrides.barberId ?? null})
    `;
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

  it('resolves an active staff session to role and userId, with no barberId for a non-barber role', async () => {
    const userId = await newUser({ role: 'owner' });
    const sessionId = await newSession(userId);
    const repo = new DrizzleActorContextRepository(db);

    const actor = await repo.resolveBySessionId(sessionId);

    expect(actor).toEqual({ userId, role: 'owner', barberId: undefined });
  });

  it('resolves an active barber session to role and their own barberId', async () => {
    const barberId = await newBarber();
    const userId = await newUser({ role: 'barber', barberId });
    const sessionId = await newSession(userId);
    const repo = new DrizzleActorContextRepository(db);

    const actor = await repo.resolveBySessionId(sessionId);

    expect(actor).toEqual({ userId, role: 'barber', barberId });
  });

  it('returns null for a session id that does not exist', async () => {
    const repo = new DrizzleActorContextRepository(db);

    const actor = await repo.resolveBySessionId(randomUUID());

    expect(actor).toBeNull();
  });

  it('returns null for an expired session', async () => {
    const userId = await newUser({ role: 'secretary' });
    const sessionId = await newSession(userId, { expiresAt: PAST });
    const repo = new DrizzleActorContextRepository(db);

    const actor = await repo.resolveBySessionId(sessionId);

    expect(actor).toBeNull();
  });

  it('returns null for a revoked session, even before its expiry', async () => {
    const userId = await newUser({ role: 'secretary' });
    const sessionId = await newSession(userId, { revokedAt: clock.now() });
    const repo = new DrizzleActorContextRepository(db);

    const actor = await repo.resolveBySessionId(sessionId);

    expect(actor).toBeNull();
  });

  it('returns null for a user with no role — access-control governs staff only, never a client session', async () => {
    const userId = await newUser();
    const sessionId = await newSession(userId);
    const repo = new DrizzleActorContextRepository(db);

    const actor = await repo.resolveBySessionId(sessionId);

    expect(actor).toBeNull();
  });

  // The `:own` permissions (`agenda:read:own`, `finance:read:own`) are
  // enforced downstream by comparing `actor.barberId` against the barber id
  // in the request — and `DrizzleAgendaRepository`/`DrizzleBarberPerformanceRepository`
  // both read an ABSENT `barberId` as "this actor is not scoped to one
  // barber", falling back to the id the caller supplied. For an owner or
  // secretary (who hold the `:any` permissions) that is exactly right; for a
  // barber row missing its `barber_id` it is a fail-OPEN: the guard grants
  // `:own`, the repository scopes to nothing, and the barber reads any
  // colleague's agenda and earnings by changing one query parameter. Today
  // no seed produces such a row — this keeps a future one from becoming a
  // silent authorization hole instead of a login that plainly fails.
  it('returns null for a barber whose user row has no barber_id — never a fail-open :own actor', async () => {
    const userId = await newUser({ role: 'barber' });
    const sessionId = await newSession(userId);
    const repo = new DrizzleActorContextRepository(db);

    const actor = await repo.resolveBySessionId(sessionId);

    expect(actor).toBeNull();
  });

  it('still resolves a barber that does have a barber_id', async () => {
    const barberId = await newBarber();
    const userId = await newUser({ role: 'barber', barberId });
    const sessionId = await newSession(userId);
    const repo = new DrizzleActorContextRepository(db);

    const actor = await repo.resolveBySessionId(sessionId);

    expect(actor).toEqual({ userId, role: 'barber', barberId });
  });
});
