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

import { DrizzleStaffAccountRepository } from '../identity/staff-account.repository';
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

  // The owner's report: a barber out sick for a day had to be deactivated
  // so nobody could book them, and there was no way back — reconfiguring
  // the whole week from scratch every time was the actual complaint.
  // Migration 0013 adds `reactivate`/`setPermanentLeave`/`delete`; these
  // prove them against real Postgres, including the CHECK constraint that
  // makes `active AND permanent_leave` unrepresentable.
  describe('baja temporal / baja definitiva (migration 0013)', () => {
    it('reactivate() flips a deactivated barber back to active with permanentLeave false, and reports false for a missing id', async () => {
      const repo = new DrizzleBarberRepository(db);
      const barber = createBarber({ id: crypto.randomUUID(), name: 'Hernan', active: true });
      await repo.create(barber);
      await repo.deactivate(barber.id);

      const reactivated = await repo.reactivate(barber.id);
      const missing = await repo.reactivate(crypto.randomUUID());

      expect(reactivated).toBe(true);
      expect(missing).toBe(false);
      expect(await repo.findById(barber.id)).toEqual({ ...barber, active: true, permanentLeave: false });
    });

    // The exact case the report named: a barber's whole week has to survive
    // a baja/reactivate round trip with nothing reconfigured.
    it('reactivating a barber restores their base schedule for free — it was never touched', async () => {
      const barberRepo = new DrizzleBarberRepository(db);
      const scheduleRepo = new DrizzleScheduleRepository(db);
      const barber = createBarber({ id: crypto.randomUUID(), name: 'Ines', active: true });
      await barberRepo.create(barber);
      await scheduleRepo.createBarberSchedule(
        createBarberSchedule({ barberId: barber.id, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
      );

      await barberRepo.deactivate(barber.id);
      await barberRepo.reactivate(barber.id);

      const own = await scheduleRepo.listBarberSchedule(barber.id);
      expect(own).toEqual([
        createBarberSchedule({ barberId: barber.id, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
      ]);
    });

    it('setPermanentLeave() sets active=false and permanentLeave=true together, and reports false for a missing id', async () => {
      const repo = new DrizzleBarberRepository(db);
      const barber = createBarber({ id: crypto.randomUUID(), name: 'Ignacio', active: true });
      await repo.create(barber);

      const updated = await repo.setPermanentLeave(barber.id, true);
      const missing = await repo.setPermanentLeave(crypto.randomUUID(), true);

      expect(updated).toBe(true);
      expect(missing).toBe(false);
      expect(await repo.findById(barber.id)).toEqual({ ...barber, active: false, permanentLeave: true });
    });

    // The invariant the design leans on: this combination must be
    // impossible to write, not merely avoided by application code.
    it('the CHECK constraint refuses active=true together with permanent_leave=true at the SQL level', async () => {
      const barber = createBarber({ id: crypto.randomUUID(), name: 'Julieta', active: true });
      await new DrizzleBarberRepository(db).create(barber);

      await expect(
        sql`update barbers set active = true, permanent_leave = true where id = ${barber.id}`,
      ).rejects.toThrow();
    });

    it('hasAppointments() is false with no history and true after a real slot_occupancies row', async () => {
      const barberRepo = new DrizzleBarberRepository(db);
      const serviceRepo = new DrizzleServiceRepository(db);
      const barber = createBarber({ id: crypto.randomUUID(), name: 'Karina', active: true });
      const service = createService({
        id: crypto.randomUUID(),
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 500000,
      });
      await barberRepo.create(barber);
      await serviceRepo.create(service);

      expect(await barberRepo.hasAppointments(barber.id)).toBe(false);

      await sql`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                values (${barber.id}, ${service.id}, 'telefonico', 'reservado', '["2026-09-01T12:00:00Z","2026-09-01T12:30:00Z")'::tstzrange)`;

      expect(await barberRepo.hasAppointments(barber.id)).toBe(true);
    });

    it('delete() reports not-found for a missing id', async () => {
      const repo = new DrizzleBarberRepository(db);

      expect(await repo.delete(crypto.randomUUID())).toBe('not-found');
    });

    it('delete() removes the barber, their schedule and their time off in one shot', async () => {
      const barberRepo = new DrizzleBarberRepository(db);
      const scheduleRepo = new DrizzleScheduleRepository(db);
      const barber = createBarber({ id: crypto.randomUUID(), name: 'Leo', active: false, permanentLeave: true });
      await barberRepo.create(barber);
      await scheduleRepo.createBarberSchedule(
        createBarberSchedule({ barberId: barber.id, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
      );
      await scheduleRepo.createBarberTimeOff(
        createBarberTimeOff({ barberId: barber.id, startDate: '2026-09-01', endDate: '2026-09-03' }),
      );

      const outcome = await barberRepo.delete(barber.id);

      expect(outcome).toBe('deleted');
      expect(await barberRepo.findById(barber.id)).toBeNull();
      expect(await scheduleRepo.listBarberSchedule(barber.id)).toEqual([]);
      expect(await scheduleRepo.listBarberTimeOff(barber.id)).toEqual([]);
    });

    // README 3.9: the account is the door into the panel. Deleting the
    // barber for good must not leave an orphan `users` row behind.
    it('delete() removes the staff account too, reusing the exact same deletion logic deleteAccount uses', async () => {
      const barberRepo = new DrizzleBarberRepository(db);
      const accountRepo = new DrizzleStaffAccountRepository(db);
      const barber = createBarber({ id: crypto.randomUUID(), name: 'Marisa', active: true });
      await barberRepo.create(barber);
      const account = await accountRepo.create({ email: 'marisa@jc.test', role: 'barber', barberId: barber.id });

      const outcome = await barberRepo.delete(barber.id);

      expect(outcome).toBe('deleted');
      expect(await accountRepo.findById(account.id)).toBeNull();
    });

    it('delete() refuses a barber with real appointment history, and writes NOTHING', async () => {
      const barberRepo = new DrizzleBarberRepository(db);
      const scheduleRepo = new DrizzleScheduleRepository(db);
      const serviceRepo = new DrizzleServiceRepository(db);
      const barber = createBarber({ id: crypto.randomUUID(), name: 'Nestor', active: true });
      const service = createService({
        id: crypto.randomUUID(),
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 500000,
      });
      await barberRepo.create(barber);
      await serviceRepo.create(service);
      await scheduleRepo.createBarberSchedule(
        createBarberSchedule({ barberId: barber.id, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
      );
      await sql`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                values (${barber.id}, ${service.id}, 'telefonico', 'realizado', '["2026-09-01T12:00:00Z","2026-09-01T12:30:00Z")'::tstzrange)`;

      const outcome = await barberRepo.delete(barber.id);

      expect(outcome).toBe('has-appointments');
      // Refused before touching anything — the barber and their schedule
      // are exactly as they were.
      expect(await barberRepo.findById(barber.id)).toEqual(barber);
      expect(await scheduleRepo.listBarberSchedule(barber.id)).toHaveLength(1);
    });
  });
});
