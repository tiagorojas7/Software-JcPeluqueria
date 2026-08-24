import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuthChallenge } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleAuthChallengeRepository } from './auth-challenge.repository';

// Single-use consumption is a database guarantee, not an application one —
// same reasoning as slot exclusivity (packages/infrastructure/src/booking).
// Only a small pool: this suite only ever races 2 competitors at a time.
const POOL_SIZE = 10;
const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('auth challenge consumption (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const clock = new ShopClock();
  // A fixed future instant, same reasoning as hold.repository.spec.ts's DAY:
  // far enough out that it never collides with whenever this suite actually
  // runs.
  const FAR_FUTURE = clock.localTimeToUtc('2026-09-01', '12:00');
  // Same reasoning as hold.repository.spec.ts's PAST_HOLD_EXPIRY: a genuinely
  // expired challenge needs an instant in the past relative to whenever this
  // suite runs, on its own unrelated calendar date.
  const PAST = clock.localTimeToUtc('2020-01-01', '12:00');

  const newUser = async (): Promise<string> => {
    const id = randomUUID();
    await client`insert into users (id, email) values (${id}, ${`${id}@example.com`})`;
    return id;
  };

  const issueChallenge = async (
    userId: string,
    overrides: Partial<{ code: string; token: string; expiresAt: Date }> = {},
  ): Promise<{ id: string; code: string; token: string }> => {
    const code = overrides.code ?? '123456';
    const token = overrides.token ?? randomUUID();
    const challenge: AuthChallenge = {
      id: randomUUID(),
      userId,
      purpose: 'client_login',
      codeHash: sha256Hex(code),
      tokenHash: sha256Hex(token),
      expiresAt: overrides.expiresAt ?? FAR_FUTURE,
    };
    await new DrizzleAuthChallengeRepository(db).create(challenge);
    return { id: challenge.id, code, token };
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
      // Same contention allowance as the other Testcontainers suites: this
      // machine's Docker health-check status lags behind actual readiness.
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

  it('stores only the SHA-256 hash of the code and token, never the plaintext', async () => {
    const userId = await newUser();
    const { id, code, token } = await issueChallenge(userId);

    const rows = await client`select code_hash, token_hash from auth_challenges where id = ${id}`;
    expect(rows[0]).toEqual({ code_hash: sha256Hex(code), token_hash: sha256Hex(token) });
    expect(rows[0]?.code_hash).not.toBe(code);
    expect(rows[0]?.token_hash).not.toBe(token);
  });

  it('consumes on a matching code and rejects a replay of the same challenge', async () => {
    const userId = await newUser();
    const { id, code } = await issueChallenge(userId);
    const repo = new DrizzleAuthChallengeRepository(db);

    const first = await repo.consume(id, 'client_login', sha256Hex(code));
    const replay = await repo.consume(id, 'client_login', sha256Hex(code));

    expect(first).toEqual({ consumed: true, userId });
    // Single use: the replay loses because the row is already spent, which is
    // a dead challenge — the caller must request a new one, not guess again.
    expect(replay).toEqual({ consumed: false, reason: 'consumed' });
  });

  it('consumes on a matching magic-link token just as well as the code', async () => {
    const userId = await newUser();
    const { id, token } = await issueChallenge(userId);

    const result = await new DrizzleAuthChallengeRepository(db).consume(
      id,
      'client_login',
      sha256Hex(token),
    );

    expect(result).toEqual({ consumed: true, userId });
  });

  it('never consumes on a wrong secret', async () => {
    const userId = await newUser();
    const { id } = await issueChallenge(userId);

    const result = await new DrizzleAuthChallengeRepository(db).consume(
      id,
      'client_login',
      sha256Hex('000000'),
    );

    // Alive challenge, wrong secret: the only losing case a retry can still fix.
    expect(result).toEqual({ consumed: false, reason: 'mismatch' });
  });

  it('never consumes a challenge issued for a different purpose', async () => {
    const userId = await newUser();
    const { id, code } = await issueChallenge(userId);

    // Same id, same correct code — only the expected purpose differs from
    // the one the challenge was actually issued with.
    const result = await new DrizzleAuthChallengeRepository(db).consume(
      id,
      'staff_password_reset',
      sha256Hex(code),
    );

    // A leaked staff-activation link reports plain `mismatch`, never its own
    // reason: that this id exists under another purpose must not be learnable
    // from the client-login path.
    expect(result).toEqual({ consumed: false, reason: 'mismatch' });
  });

  // The only real proof of single-use under concurrency, mirroring
  // HoldRepository.confirm()'s guarantee: two clients racing to consume the
  // SAME challenge with the SAME correct secret must leave exactly one
  // winner — no double-authentication, no deadlock, no silent double win.
  it('lets exactly one of two simultaneous consumptions win', async () => {
    const userId = await newUser();
    const { id, code } = await issueChallenge(userId);
    const repo = new DrizzleAuthChallengeRepository(db);
    const candidateHash = sha256Hex(code);

    const outcomes = await Promise.all([
      repo.consume(id, 'client_login', candidateHash),
      repo.consume(id, 'client_login', candidateHash),
    ]);

    expect(outcomes.filter((outcome) => outcome.consumed)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.consumed)).toHaveLength(1);
  });

  // The EXCLUDE constraint's lesson applies here too: expiry must be
  // enforced by the WHERE clause of the same statement, not read-then-check
  // in application code. A row genuinely in the past (inserted directly,
  // since there's no application path to fast-forward Postgres's own now())
  // must never be consumable, even with the exactly-correct secret.
  it('rejects consumption of an expired challenge even with the correct secret', async () => {
    const userId = await newUser();
    const code = '123456';
    const id = randomUUID();
    await client`insert into auth_challenges (id, user_id, purpose, code_hash, token_hash, expires_at)
                 values (${id}, ${userId}, 'client_login', ${sha256Hex(code)}, ${sha256Hex(randomUUID())}, ${PAST.toISOString()})`;

    const result = await new DrizzleAuthChallengeRepository(db).consume(id, 'client_login', sha256Hex(code));

    // The requirement's case (client-booking, "Codigo de acceso vencido"):
    // reported as `expired` so the caller can demand a NEW request.
    expect(result).toEqual({ consumed: false, reason: 'expired' });
  });

  // 5 failed attempts must invalidate the challenge outright — the 6th
  // attempt fails even if it finally presents the correct secret.
  it('invalidates the challenge after 5 failed attempts, even with the correct secret on the 6th try', async () => {
    const userId = await newUser();
    const { id, code } = await issueChallenge(userId);
    const repo = new DrizzleAuthChallengeRepository(db);
    const wrongHash = sha256Hex('000000');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await repo.consume(id, 'client_login', wrongHash);
      // Each of the five wrong guesses is still an ordinary retryable miss.
      expect(failed).toEqual({ consumed: false, reason: 'mismatch' });
    }
    const rows = await client`select attempts from auth_challenges where id = ${id}`;
    expect(rows[0]).toEqual({ attempts: 5 });

    const finalTry = await repo.consume(id, 'client_login', sha256Hex(code));

    // The sixth try carries the CORRECT secret and still loses, and the reason
    // is the attempt limit, not the secret — so the caller sends the client to
    // request a new code instead of insisting with a code that is actually right.
    expect(finalTry).toEqual({ consumed: false, reason: 'exhausted' });
  });
});

// fix/acceso-cliente-sin-id RED: `ClientLoginByEmailUseCase` needs to resolve
// EMAIL -> the one challenge to check a typed code against, without the
// client ever typing a `challengeId`. Two outstanding `client_login`
// challenges for the SAME user CAN coexist (nothing invalidates an older
// request when a new one is issued) — `findLatestActiveId` is what keeps that
// resolution unambiguous: always the most recently issued STILL-ALIVE one,
// never a scan matching a bare code across every live challenge.
describe('findLatestActiveId (fix/acceso-cliente-sin-id)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const clock = new ShopClock();
  const FAR_FUTURE = clock.localTimeToUtc('2026-09-01', '12:00');
  const LATER = clock.addMinutes(FAR_FUTURE, 5);
  const PAST = clock.localTimeToUtc('2020-01-01', '12:00');

  const newUser = async (): Promise<string> => {
    const id = randomUUID();
    await client`insert into users (id, email) values (${id}, ${`${id}@example.com`})`;
    return id;
  };

  const issueChallenge = async (
    userId: string,
    overrides: Partial<{ purpose: AuthChallenge['purpose']; expiresAt: Date }> = {},
  ): Promise<string> => {
    const challenge: AuthChallenge = {
      id: randomUUID(),
      userId,
      purpose: overrides.purpose ?? 'client_login',
      codeHash: sha256Hex('123456'),
      tokenHash: sha256Hex(randomUUID()),
      expiresAt: overrides.expiresAt ?? FAR_FUTURE,
    };
    await new DrizzleAuthChallengeRepository(db).create(challenge);
    return challenge.id;
  };

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

  it('returns null when the user has no challenge at all', async () => {
    const userId = await newUser();

    const result = await new DrizzleAuthChallengeRepository(db).findLatestActiveId(userId, 'client_login');

    expect(result).toBeNull();
  });

  it('picks the most recently issued challenge when two are alive at once', async () => {
    const userId = await newUser();
    await issueChallenge(userId, { expiresAt: FAR_FUTURE });
    const latest = await issueChallenge(userId, { expiresAt: LATER });

    const result = await new DrizzleAuthChallengeRepository(db).findLatestActiveId(userId, 'client_login');

    expect(result).toBe(latest);
  });

  it('skips a consumed challenge and falls back to the older still-alive one', async () => {
    const userId = await newUser();
    const older = await issueChallenge(userId, { expiresAt: FAR_FUTURE });
    const newer = await issueChallenge(userId, { expiresAt: LATER });
    const repo = new DrizzleAuthChallengeRepository(db);
    await repo.consume(newer, 'client_login', sha256Hex('123456'));

    const result = await repo.findLatestActiveId(userId, 'client_login');

    expect(result).toBe(older);
  });

  it('never returns an expired challenge, even when it is the only one', async () => {
    const userId = await newUser();
    await issueChallenge(userId, { expiresAt: PAST });

    const result = await new DrizzleAuthChallengeRepository(db).findLatestActiveId(userId, 'client_login');

    expect(result).toBeNull();
  });

  it('never returns a challenge issued for a different purpose', async () => {
    const userId = await newUser();
    await issueChallenge(userId, { purpose: 'staff_password_reset', expiresAt: FAR_FUTURE });

    const result = await new DrizzleAuthChallengeRepository(db).findLatestActiveId(userId, 'client_login');

    expect(result).toBeNull();
  });

  it('never returns another user\'s challenge', async () => {
    const owner = await newUser();
    const someoneElse = await newUser();
    await issueChallenge(someoneElse, { expiresAt: FAR_FUTURE });

    const result = await new DrizzleAuthChallengeRepository(db).findLatestActiveId(owner, 'client_login');

    expect(result).toBeNull();
  });
});
