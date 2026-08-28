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

  // The failure the shop actually hit: inviting a barber with an address that
  // already belonged to a CLIENT account passed the staff-scoped check and
  // then died on `users_email_unique` (23505) as a 500. The constraint covers
  // the whole table, so the availability question has to as well.
  it('reports a CLIENT-owned email as in use, even though it is not a staff account', async () => {
    const clientId = randomUUID();
    await client`insert into clients (id, name, phone) values (${clientId}, 'Tiago', '3510000002')`;
    await client`insert into users (id, email, client_id) values (${randomUUID()}, 'tiago@jc.test', ${clientId})`;
    const repo = new DrizzleStaffAccountRepository(db);

    // Not a staff account...
    expect(await repo.findByEmail('tiago@jc.test')).toBeNull();
    // ...but the address is taken all the same, which is what decides whether
    // an alta may claim it.
    expect(await repo.isEmailInUse('tiago@jc.test')).toBe(true);
    expect(await repo.isEmailInUse('libre@jc.test')).toBe(false);
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

  // El duenio pidio poder eliminar cuentas: un barbero que ya no esta seguia
  // apareciendo para siempre en "Cuentas de barberos". Cinco tablas apuntan a
  // `users`, y las tres de auditoria (turnos creados, turnos marcados,
  // ausencias confirmadas) guardan historial DEL LOCAL, no de la cuenta: hay
  // que soltar esas referencias, no borrar los registros. Sin eso el DELETE
  // muere contra la foreign key justo en el caso mas comun — un barbero que
  // efectivamente trabajo.
  it('elimina la cuenta y libera su email', async () => {
    const barberId = await newBarber('Se Fue');
    const repo = new DrizzleStaffAccountRepository(db);
    const created = await repo.create({ email: 'sefue@jc.test', role: 'barber', barberId });

    expect(await repo.deleteAccount(created.id)).toBe(true);

    expect(await repo.findById(created.id)).toBeNull();
    expect(await repo.isEmailInUse('sefue@jc.test')).toBe(false);
  });

  it('conserva los turnos que la cuenta creo o marco, sin la atribucion', async () => {
    const barberId = await newBarber('Con Historial');
    const repo = new DrizzleStaffAccountRepository(db);
    const created = await repo.create({ email: 'historial@jc.test', role: 'barber', barberId });
    const [service] = await client`insert into services (id, name, duration_minutes, price_cents)
      values (${randomUUID()}, 'Corte', 30, 400000) returning id`;
    const [occupancy] = await client`
      insert into slot_occupancies (barber_id, service_id, channel, status, time_range, created_by_user_id, marked_by_user_id)
      values (${barberId}, ${service!.id}, 'telefono', 'realizado',
              '[2026-09-10T12:00:00Z,2026-09-10T12:30:00Z)'::tstzrange, ${created.id}, ${created.id})
      returning id`;

    expect(await repo.deleteAccount(created.id)).toBe(true);

    const [kept] = await client`select status, created_by_user_id, marked_by_user_id
      from slot_occupancies where id = ${occupancy!.id}`;
    // El turno sigue en la agenda del local...
    expect(kept!.status).toBe('realizado');
    // ...sin el "lo cargo Fulano", que es exactamente lo que se resigna.
    expect(kept!.created_by_user_id).toBeNull();
    expect(kept!.marked_by_user_id).toBeNull();
  });

  // La que hacia fallar el DELETE: `confirmed_by_user_id` era NOT NULL, asi
  // que no se podia soltar y la foreign key frenaba el borrado. La ausencia
  // decide si se retuvo la senia — es historial del local y sobrevive.
  it('conserva las ausencias que la cuenta confirmo, sin la atribucion', async () => {
    const barberId = await newBarber('Confirmo Ausencias');
    const repo = new DrizzleStaffAccountRepository(db);
    const created = await repo.create({ email: 'ausencias@jc.test', role: 'barber', barberId });
    const [service] = await client`insert into services (id, name, duration_minutes, price_cents)
      values (${randomUUID()}, 'Corte Ausencia', 30, 400000) returning id`;
    const [clientRow] = await client`insert into clients (id, name, phone)
      values (${randomUUID()}, 'Faltador', '3510009999') returning id`;
    const [occupancy] = await client`
      insert into slot_occupancies (barber_id, service_id, client_id, channel, status, time_range)
      values (${barberId}, ${service!.id}, ${clientRow!.id}, 'telefono', 'ausente',
              '[2026-09-11T12:00:00Z,2026-09-11T12:30:00Z)'::tstzrange)
      returning id`;
    const [absence] = await client`
      insert into client_absences (id, appointment_id, client_id, confirmed_by_user_id, confirmed_at, deposit_forfeited)
      values (${randomUUID()}, ${occupancy!.id}, ${clientRow!.id}, ${created.id}, now(), true)
      returning id`;

    expect(await repo.deleteAccount(created.id)).toBe(true);

    const [kept] = await client`select confirmed_by_user_id, deposit_forfeited
      from client_absences where id = ${absence!.id}`;
    expect(kept!.confirmed_by_user_id).toBeNull();
    // Lo que decide plata sigue intacto.
    expect(kept!.deposit_forfeited).toBe(true);
  });

  it('borra las sesiones y los codigos pendientes: eso ES el acceso', async () => {
    const barberId = await newBarber('Con Sesion');
    const repo = new DrizzleStaffAccountRepository(db);
    const created = await repo.create({ email: 'sesion@jc.test', role: 'barber', barberId });
    await client`insert into sessions (id, user_id, expires_at)
      values (${randomUUID()}, ${created.id}, now() + interval '1 day')`;
    await client`insert into auth_challenges (id, user_id, purpose, code_hash, token_hash, expires_at)
      values (${randomUUID()}, ${created.id}, 'staff_activation', 'h', 't', now() + interval '1 day')`;

    expect(await repo.deleteAccount(created.id)).toBe(true);

    const sessions = await client`select count(*)::int as total from sessions where user_id = ${created.id}`;
    const challenges = await client`select count(*)::int as total from auth_challenges where user_id = ${created.id}`;
    expect([...sessions]).toEqual([{ total: 0 }]);
    expect([...challenges]).toEqual([{ total: 0 }]);
  });

  it('devuelve false para una cuenta que no existe', async () => {
    const repo = new DrizzleStaffAccountRepository(db);

    expect(await repo.deleteAccount(randomUUID())).toBe(false);
  });
});
