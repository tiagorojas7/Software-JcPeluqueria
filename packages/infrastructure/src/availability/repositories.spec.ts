import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createBarber,
  createBarberSchedule,
  createBarberTimeOff,
  createService,
  createShopHours,
} from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from './barber.repository';
import { DrizzleScheduleRepository } from './schedule.repository';
import { DrizzleServiceRepository } from './service.repository';

// Real PostgreSQL via Testcontainers — the same constraint (EXCLUDE-free,
// but the two new UNIQUE constraints) has to be proven against the actual
// engine, not simulated. One container for the whole file: startup is the
// expensive part, and each test scopes its own rows.
describe('availability repositories (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
      // This machine's Docker VM runs several unrelated containers
      // concurrently (other projects) on a constrained memory limit, so
      // pg_isready's own health-check wait can legitimately take longer
      // than testcontainers' 120s default under contention.
      .withStartupTimeout(240_000)
      .start();

    sql = postgres(container.getConnectionUri());
    db = drizzle(sql);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  }, 300_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  }, 60_000);

  it('creates and finds a barber by id', async () => {
    const repo = new DrizzleBarberRepository(db);
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Juan', active: true });

    await repo.create(barber);
    const found = await repo.findById(barber.id);

    expect(found).toEqual(barber);
  });

  it('lists every created barber', async () => {
    const repo = new DrizzleBarberRepository(db);
    const a = createBarber({ id: crypto.randomUUID(), name: 'Ana', active: true });
    const b = createBarber({ id: crypto.randomUUID(), name: 'Beto', active: false });

    await repo.create(a);
    await repo.create(b);
    const all = await repo.list();

    expect(all).toEqual(expect.arrayContaining([a, b]));
  });

  it('returns null when a barber id does not exist', async () => {
    const repo = new DrizzleBarberRepository(db);

    const found = await repo.findById(crypto.randomUUID());

    expect(found).toBeNull();
  });

  it('creates and finds a service by id', async () => {
    const repo = new DrizzleServiceRepository(db);
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte clasico',
      durationMinutes: 30,
      priceCents: 500000,
    });

    await repo.create(service);
    const found = await repo.findById(service.id);

    expect(found).toEqual(service);
  });

  it('creates shop hours and lists them back with HH:mm precision', async () => {
    const repo = new DrizzleScheduleRepository(db);
    const hours = createShopHours({ dayOfWeek: 3, opensAt: '09:00', closesAt: '20:00' });

    await repo.createShopHours(hours);
    const all = await repo.listShopHours();

    expect(all).toEqual(expect.arrayContaining([hours]));
  });

  it('rejects a second shop-hours row for the same day of week (unique constraint)', async () => {
    const repo = new DrizzleScheduleRepository(db);
    await repo.createShopHours(createShopHours({ dayOfWeek: 4, opensAt: '09:00', closesAt: '20:00' }));

    await expect(
      repo.createShopHours(createShopHours({ dayOfWeek: 4, opensAt: '10:00', closesAt: '18:00' })),
    ).rejects.toThrow();
  });

  it('creates a barber schedule and lists it back scoped to that barber', async () => {
    const barberRepo = new DrizzleBarberRepository(db);
    const scheduleRepo = new DrizzleScheduleRepository(db);
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Carla', active: true });
    await barberRepo.create(barber);
    const schedule = createBarberSchedule({
      barberId: barber.id,
      dayOfWeek: 2,
      opensAt: '10:00',
      closesAt: '18:00',
    });

    await scheduleRepo.createBarberSchedule(schedule);
    const own = await scheduleRepo.listBarberSchedule(barber.id);

    expect(own).toEqual([schedule]);
  });

  it('rejects a second schedule row for the same barber and day (unique constraint)', async () => {
    const barberRepo = new DrizzleBarberRepository(db);
    const scheduleRepo = new DrizzleScheduleRepository(db);
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Diego', active: true });
    await barberRepo.create(barber);
    await scheduleRepo.createBarberSchedule(
      createBarberSchedule({ barberId: barber.id, dayOfWeek: 5, opensAt: '10:00', closesAt: '18:00' }),
    );

    await expect(
      scheduleRepo.createBarberSchedule(
        createBarberSchedule({ barberId: barber.id, dayOfWeek: 5, opensAt: '11:00', closesAt: '19:00' }),
      ),
    ).rejects.toThrow();
  });

  it('creates barber time off and lists it back scoped to that barber', async () => {
    const barberRepo = new DrizzleBarberRepository(db);
    const scheduleRepo = new DrizzleScheduleRepository(db);
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Elena', active: true });
    await barberRepo.create(barber);
    const timeOff = createBarberTimeOff({
      barberId: barber.id,
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    });

    await scheduleRepo.createBarberTimeOff(timeOff);
    const own = await scheduleRepo.listBarberTimeOff(barber.id);

    expect(own).toEqual([timeOff]);
  });

  // Task 10.14/10.15 — admin-operations spec, "Gestión de clientes y de
  // barberos": "el alta y baja de barberos, y la configuración de horarios
  // base y precios de servicios". These three prove the atomic
  // `UPDATE ... RETURNING` idiom for real against Postgres, the same "zero
  // rows means not found, never an exception" shape `HoldRepository.confirm()`
  // established in Fase 2 — approval-style against the already-written
  // adapter (strict-tdd.md), same honest labeling `repositories.spec.ts`
  // used for 8.7's dedicated Testcontainers pass.
  it('deactivate() flips active to false for a real row and reports false for a missing id', async () => {
    const repo = new DrizzleBarberRepository(db);
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Franco', active: true });
    await repo.create(barber);

    const deactivated = await repo.deactivate(barber.id);
    const missing = await repo.deactivate(crypto.randomUUID());

    expect(deactivated).toBe(true);
    expect(missing).toBe(false);
    expect(await repo.findById(barber.id)).toEqual({ ...barber, active: false });
  });

  it('updatePrice() changes only price_cents for a real service and reports false for a missing id', async () => {
    const repo = new DrizzleServiceRepository(db);
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte + barba',
      durationMinutes: 45,
      priceCents: 600000,
    });
    await repo.create(service);

    const updated = await repo.updatePrice(service.id, 650000);
    const missing = await repo.updatePrice(crypto.randomUUID(), 650000);

    expect(updated).toBe(true);
    expect(missing).toBe(false);
    expect(await repo.findById(service.id)).toEqual({ ...service, priceCents: 650000 });
  });

  it('updateBarberSchedule() changes an existing day and never inserts a second row for it', async () => {
    const barberRepo = new DrizzleBarberRepository(db);
    const scheduleRepo = new DrizzleScheduleRepository(db);
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Gaby', active: true });
    await barberRepo.create(barber);
    await scheduleRepo.createBarberSchedule(
      createBarberSchedule({ barberId: barber.id, dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }),
    );

    const updated = await scheduleRepo.updateBarberSchedule(
      createBarberSchedule({ barberId: barber.id, dayOfWeek: 1, opensAt: '10:00', closesAt: '19:00' }),
    );
    const missingDay = await scheduleRepo.updateBarberSchedule(
      createBarberSchedule({ barberId: barber.id, dayOfWeek: 2, opensAt: '10:00', closesAt: '19:00' }),
    );

    expect(updated).toBe(true);
    expect(missingDay).toBe(false); // no row for day 2 yet — caller falls back to create
    const own = await scheduleRepo.listBarberSchedule(barber.id);
    expect(own).toEqual([
      createBarberSchedule({ barberId: barber.id, dayOfWeek: 1, opensAt: '10:00', closesAt: '19:00' }),
    ]);
  });

  // docs/HUECOS-BACKEND.md #6, "Apagar un día en Horarios no apaga el día":
  // the real bug — the operator unchecked a day, saved, and the barber kept
  // working it. Proven against real Postgres because the whole point is
  // whether the DELETE actually reaches the row.
  it('deleteBarberScheduleForDaysNotIn() borra los dias que no vienen en la lista, y respeta los que si', async () => {
    const barberRepo = new DrizzleBarberRepository(db);
    const scheduleRepo = new DrizzleScheduleRepository(db);
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Lucas', active: true });
    await barberRepo.create(barber);
    for (const dayOfWeek of [1, 2, 3] as const) {
      await scheduleRepo.createBarberSchedule(
        createBarberSchedule({ barberId: barber.id, dayOfWeek, opensAt: '09:00', closesAt: '18:00' }),
      );
    }

    await scheduleRepo.deleteBarberScheduleForDaysNotIn(barber.id, [1, 3]);

    const own = await scheduleRepo.listBarberSchedule(barber.id);
    expect(own.map((day) => day.dayOfWeek).sort()).toEqual([1, 3]);
  });

  it('deleteBarberScheduleForDaysNotIn() nunca toca la fila de OTRO barbero', async () => {
    const barberRepo = new DrizzleBarberRepository(db);
    const scheduleRepo = new DrizzleScheduleRepository(db);
    const barberA = createBarber({ id: crypto.randomUUID(), name: 'A', active: true });
    const barberB = createBarber({ id: crypto.randomUUID(), name: 'B', active: true });
    await barberRepo.create(barberA);
    await barberRepo.create(barberB);
    await scheduleRepo.createBarberSchedule(
      createBarberSchedule({ barberId: barberA.id, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
    );
    await scheduleRepo.createBarberSchedule(
      createBarberSchedule({ barberId: barberB.id, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
    );

    await scheduleRepo.deleteBarberScheduleForDaysNotIn(barberA.id, []);

    expect(await scheduleRepo.listBarberSchedule(barberA.id)).toEqual([]);
    expect(await scheduleRepo.listBarberSchedule(barberB.id)).toHaveLength(1);
  });
});
