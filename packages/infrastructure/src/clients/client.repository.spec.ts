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

  // Task 10.14/10.15 — admin-operations spec, "Gestión de clientes y de
  // barberos": "El sistema MUST poder ver... los registros de clientes."
  // Approval-style against the already-written adapter, same honest
  // labeling as `repositories.spec.ts`'s own new tests in this slice.
  it('list() returns every client on file', async () => {
    const repo = new DrizzleClientRepository(db);
    const a = await repo.create({ name: 'Nora', phone: '3519990001', email: null, age: null });
    const b = await repo.create({ name: 'Pablo', phone: '3519990002', email: 'pablo@example.com', age: 40 });

    const all = await repo.list();

    expect(all).toEqual(expect.arrayContaining([a, b]));
  });

  // Task 12.5/12.6 — GenerateAbsenceReassignmentOffers needs the affected
  // client's email by id (an appointment carries clientId, not email).
  it('finds an existing client by id', async () => {
    const repo = new DrizzleClientRepository(db);
    const created = await repo.create({ name: 'Sofia', phone: '3519998888', email: 'sofia@example.com', age: 28 });

    const found = await repo.findById(created.id);

    expect(found).toEqual(created);
  });

  it('returns null for an id that does not exist', async () => {
    const repo = new DrizzleClientRepository(db);

    const found = await repo.findById(crypto.randomUUID());

    expect(found).toBeNull();
  });

  // El bug que rompía el flujo público: una persona que ya reservó vuelve y
  // escribe su teléfono distinto. Antes se creaba un cliente nuevo, y como
  // la cuenta va con el email (UNIQUE), el insert moría con un 500.
  describe('reconocer a quien ya vino', () => {
    it('encuentra a la misma persona aunque el telefono venga escrito de otra forma', async () => {
      const repo = new DrizzleClientRepository(db);
      const creado = await repo.create({
        name: 'Vuelve Siempre',
        phone: '3515069498',
        email: 'vuelve@example.com',
        age: null,
      });

      for (const variante of ['351 506-9498', '+54 351 5069498', '0351 5069498', '351 15 5069498']) {
        const encontrado = await repo.findByPhone(variante);
        expect(encontrado?.id, `no reconoció "${variante}"`).toBe(creado.id);
      }
    });

    it('no confunde dos numeros que son realmente distintos', async () => {
      const repo = new DrizzleClientRepository(db);
      await repo.create({ name: 'Uno', phone: '3517770001', email: 'uno-tel@example.com', age: null });
      const dos = await repo.create({ name: 'Dos', phone: '3517770002', email: 'dos-tel@example.com', age: null });

      expect((await repo.findByPhone('3517770002'))?.id).toBe(dos.id);
      expect((await repo.findByPhone('3517770003'))).toBeNull();
    });

    it('encuentra por email, sin importar mayusculas ni espacios', async () => {
      const repo = new DrizzleClientRepository(db);
      const creado = await repo.create({
        name: 'Por Email',
        phone: '3516660001',
        email: 'poremail@example.com',
        age: null,
      });

      expect((await repo.findByEmail('poremail@example.com'))?.id).toBe(creado.id);
      expect((await repo.findByEmail('  PorEmail@Example.COM  '))?.id).toBe(creado.id);
    });

    it('devuelve null para un email que nadie reclamo, y para uno vacio', async () => {
      const repo = new DrizzleClientRepository(db);

      expect(await repo.findByEmail('nadie-jamas@example.com')).toBeNull();
      expect(await repo.findByEmail('')).toBeNull();
    });

    it('no explota con un telefono sin digitos', async () => {
      const repo = new DrizzleClientRepository(db);

      expect(await repo.findByPhone('sin numero')).toBeNull();
    });
  });
});
