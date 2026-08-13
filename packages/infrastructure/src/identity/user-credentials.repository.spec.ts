import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleUserCredentialsRepository } from './user-credentials.repository';

const POOL_SIZE = 10;

describe('user credentials persistence (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const newUser = async (
    overrides: Partial<{ email: string; active: boolean; passwordHash: string | null }> = {},
  ): Promise<{ id: string; email: string }> => {
    const id = randomUUID();
    const email = overrides.email ?? `${id}@example.com`;
    await client`insert into users (id, email, active, password_hash)
                 values (${id}, ${email}, ${overrides.active ?? true}, ${overrides.passwordHash ?? null})`;
    return { id, email };
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

  it('finds a user by email with their stored password hash', async () => {
    const { id, email } = await newUser({ passwordHash: '$argon2id$fake-for-test$abc' });
    const repo = new DrizzleUserCredentialsRepository(db);

    const found = await repo.findByEmail(email);

    expect(found).toEqual({ id, passwordHash: '$argon2id$fake-for-test$abc', active: true });
  });

  it('returns null for an email that matches no user', async () => {
    const repo = new DrizzleUserCredentialsRepository(db);

    const found = await repo.findByEmail('nobody-at-all@example.com');

    expect(found).toBeNull();
  });

  it('reports a deactivated user with active: false rather than hiding them', async () => {
    const { email } = await newUser({ active: false, passwordHash: '$argon2id$fake-for-test$abc' });
    const repo = new DrizzleUserCredentialsRepository(db);

    const found = await repo.findByEmail(email);

    expect(found?.active).toBe(false);
  });

  it('overwrites the stored password hash and stamps password_changed_at', async () => {
    const { id, email } = await newUser({ passwordHash: null });
    const repo = new DrizzleUserCredentialsRepository(db);

    await repo.setPassword(id, '$argon2id$brand-new-hash$xyz');

    const found = await repo.findByEmail(email);
    expect(found?.passwordHash).toBe('$argon2id$brand-new-hash$xyz');
    const rows = await client`select password_changed_at from users where id = ${id}`;
    expect(rows[0]?.password_changed_at).not.toBeNull();
  });
});
