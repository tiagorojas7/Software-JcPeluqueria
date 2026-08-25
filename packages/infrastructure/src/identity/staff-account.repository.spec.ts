import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleStaffAccountRepository } from './staff-account.repository';

// README section 3.9 — the barber's account. Everything this repository does
// beyond a plain insert is SQL nothing else in the suite exercises: the join
// to `roles` that turns `role_id` into the domain's `Role`, the role lookup
// `create()` does by NAME (against the rows migration 0006 seeds), and the
// `activated` flag derived from whether `password_hash` is set.
//
// That last one is the point worth proving against a real database: the
// owner's screen reads activation state, and it must come from the column's
// PRESENCE without the credential itself ever leaving the query.
describe('DrizzleStaffAccountRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const newBarber = async (name = 'Barbero Test'): Promise<string> => {
    const id = randomUUID();
    await client`insert into barbers (id, name, active) values (${id}, ${name}, true)`;
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

  it('creates a barber account against the seeded role, and reads it back by barber', async () => {
    const barberId = await newBarber('Juan');
    const repo = new DrizzleStaffAccountRepository(db);

    const created = await repo.create({ email: 'juan@jc.test', role: 'barber', barberId });

    expect(created).toMatchObject({ email: 'juan@jc.test', role: 'barber', barberId, active: true });
    // Created, never activated: the owner made the account, the barber has
    // not chosen a password yet.
    expect(created.activated).toBe(false);
    expect(await repo.findByBarberId(barberId)).toEqual(created);
    expect(await repo.findById(created.id)).toEqual(created);
  });

  it('reports activated once a password hash exists — derived from presence, never from the value', async () => {
    const barberId = await newBarber('Pedro');
    const repo = new DrizzleStaffAccountRepository(db);
    const created = await repo.create({ email: 'pedro@jc.test', role: 'barber', barberId });

    // Written through the OTHER port in production (`PasswordService` ->
    // `DrizzleUserCredentialsRepository.setPassword`); this file has no seam
    // that could write it, which is the whole point.
    await client`update users set password_hash = 'argon2id$fake' where id = ${created.id}`;

    const reloaded = await repo.findById(created.id);
    expect(reloaded?.activated).toBe(true);
    // The hash itself is not part of the shape that leaves this repository.
    expect(Object.keys(reloaded!)).not.toContain('passwordHash');
  });

  it('lists only the barber accounts, never the owner or the secretary', async () => {
    const repo = new DrizzleStaffAccountRepository(db);
    const barberId = await newBarber('Listado');
    await repo.create({ email: 'listado@jc.test', role: 'barber', barberId });
    await repo.create({ email: 'duenio@jc.test', role: 'owner', barberId: null });

    const listed = await repo.listByRole('barber');

    expect(listed.map((account) => account.email)).toContain('listado@jc.test');
    expect(listed.map((account) => account.email)).not.toContain('duenio@jc.test');
    expect(listed.every((account) => account.role === 'barber')).toBe(true);
  });

  it('returns null for an email that belongs to a CLIENT account, never a staff one', async () => {
    const clientId = randomUUID();
    await client`insert into clients (id, name, phone) values (${clientId}, 'Cliente Test', '3510000001')`;
    await client`insert into users (id, email, client_id) values (${randomUUID()}, 'cliente@jc.test', ${clientId})`;
    const repo = new DrizzleStaffAccountRepository(db);

    // The mirror of `DrizzleClientAccountRepository`'s own staff exclusion:
    // the inner join to `roles` is what keeps a client row out, so the alta's
    // email-collision check answers about STAFF accounts only.
    expect(await repo.findByEmail('cliente@jc.test')).toBeNull();
  });

  it('revokes and restores access, and reports false for an id nobody has', async () => {
    const barberId = await newBarber('Acceso');
    const repo = new DrizzleStaffAccountRepository(db);
    const created = await repo.create({ email: 'acceso@jc.test', role: 'barber', barberId });

    expect(await repo.setActive(created.id, false)).toBe(true);
    expect((await repo.findById(created.id))?.active).toBe(false);

    expect(await repo.setActive(created.id, true)).toBe(true);
    expect((await repo.findById(created.id))?.active).toBe(true);

    expect(await repo.setActive(randomUUID(), false)).toBe(false);
  });
});
