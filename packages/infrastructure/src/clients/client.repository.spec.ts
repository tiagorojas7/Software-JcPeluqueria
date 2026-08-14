import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleClientRepository } from './client.repository';

describe('DrizzleClientRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

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

  it('creates a client with only name and phone, email and age left null', async () => {
    const repo = new DrizzleClientRepository(db);

    const created = await repo.create({ name: 'Laura', phone: '3517654321', email: null, age: null });

    expect(created).toMatchObject({ name: 'Laura', phone: '3517654321', email: null, age: null });
    expect(created.id).toBeDefined();
  });

  it('finds an existing client by phone instead of creating a duplicate', async () => {
    const repo = new DrizzleClientRepository(db);
    const created = await repo.create({
      name: 'Marcos',
      phone: '3511112222',
      email: 'marcos@example.com',
      age: 30,
    });

    const found = await repo.findByPhone('3511112222');

    expect(found).toEqual(created);
  });

  it('returns null when no client has that phone', async () => {
    const repo = new DrizzleClientRepository(db);

    const found = await repo.findByPhone('0000000000');

    expect(found).toBeNull();
  });
});
