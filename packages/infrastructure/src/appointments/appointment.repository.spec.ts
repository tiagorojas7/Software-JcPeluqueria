import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService, SlotUnavailableError } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { DrizzleClientRepository } from '../clients/client.repository';
import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleAppointmentRepository } from './appointment.repository';

const DAY = '2026-09-01';

describe('DrizzleAppointmentRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let barberId: string;
  let otherBarberId: string;
  let serviceId: string;
  let clientId: string;

  const clock = new ShopClock();
  const at = (wallClock: string): Date => clock.localTimeToUtc(DAY, wallClock);
  const range = (from: string, to: string) =>
    `[${at(from).toISOString()},${at(to).toISOString()})`;
  const workingWindow = { start: at('09:00'), end: at('18:00') };

  const insertAppointment = async (barber: string, from: string, to: string) => {
    const id = crypto.randomUUID();
    await client`insert into slot_occupancies (id, barber_id, service_id, client_id, channel, status, time_range)
                 values (${id}, ${barber}, ${serviceId}, ${clientId}, 'telefonico', 'reservado', ${range(from, to)}::tstzrange)`;
    return id;
  };

  // A FRESH barber per test that needs one, isolated from the shared
  // `barberId`/`otherBarberId` fixtures OTHER tests in this file accumulate
  // `reservado` rows against over the whole suite's run (no per-test reset).
  // findReservedByBarberInRange's own tests query a WIDE working-day window
  // by design (that IS the detection query's real shape), so they need this
  // isolation to avoid seeing leftover rows from earlier, unrelated tests.
  const newBarber = async (): Promise<string> => {
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Barbero aislado', active: true });
    await new DrizzleBarberRepository(db).create(barber);
    return barber.id;
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

    const barber = createBarber({ id: crypto.randomUUID(), name: 'Juan', active: true });
    const otherBarber = createBarber({ id: crypto.randomUUID(), name: 'Ana', active: true });
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte clasico',
      durationMinutes: 30,
      priceCents: 500000,
    });
    await new DrizzleBarberRepository(db).create(barber);
    await new DrizzleBarberRepository(db).create(otherBarber);
    await new DrizzleServiceRepository(db).create(service);
    barberId = barber.id;
    otherBarberId = otherBarber.id;
    serviceId = service.id;
    clientId = (await new DrizzleClientRepository(db).create({
      name: 'Marcos',
      phone: '3511234567',
      email: null,
      age: null,
    })).id;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('finds an existing reservado appointment by id, with no deposit', async () => {
    const id = await insertAppointment(barberId, '10:00', '10:30');
    const repo = new DrizzleAppointmentRepository(db);

    const appointment = await repo.findById(id);

    expect(appointment).toMatchObject({
      id,
      barberId,
      serviceId,
      clientId,
      channel: 'telefonico',
      status: 'reservado',
      deposit: { kind: 'not_applicable' },
    });
  });

  it('returns null for an id that does not exist', async () => {
    const repo = new DrizzleAppointmentRepository(db);

    const appointment = await repo.findById(crypto.randomUUID());

    expect(appointment).toBeNull();
  });

  it('moves the appointment to a different barber, service and horario', async () => {
    const id = await insertAppointment(barberId, '11:00', '11:30');
    const repo = new DrizzleAppointmentRepository(db);

    await repo.updateSchedule(
      id,
      { barberId: otherBarberId, serviceId, timeRange: { start: at('12:00'), end: at('12:30') } },
      workingWindow,
    );

    const updated = await repo.findById(id);
    expect(updated?.barberId).toBe(otherBarberId);
    expect(updated?.timeRange).toEqual({ start: at('12:00'), end: at('12:30') });
  });

  it('rejects moving an appointment onto a range another turno already occupies', async () => {
    await insertAppointment(barberId, '13:00', '13:30');
    const movingId = await insertAppointment(otherBarberId, '15:00', '15:30');
    const repo = new DrizzleAppointmentRepository(db);

    const error = await repo
      .updateSchedule(movingId, { barberId, serviceId, timeRange: { start: at('13:00'), end: at('13:30') } }, workingWindow)
      .catch((e) => e);

    expect(error).toBeInstanceOf(SlotUnavailableError);
  });

  it('cancels an appointment by persisting only its status', async () => {
    const id = await insertAppointment(barberId, '16:00', '16:30');
    const repo = new DrizzleAppointmentRepository(db);

    await repo.updateStatus(id, 'cancelado');

    const rows = await client`select status from slot_occupancies where id = ${id}`;
    expect([...rows]).toEqual([{ status: 'cancelado' }]);
  });

  // Task 12.7/12.9 bugfix — findById used to THROW for any appointment
  // carrying a deposit_id ("the deposits table is not wired yet", a Phase 4
  // comment nobody updated once Phase 5 actually built it). Without this
  // fix, the "con seña" path barber-absence-reassignment spec explicitly
  // requires to work — "el turno original puede tener o no tener seña
  // asociada ... ambos casos deben resolverse correctamente" — could never
  // even load. Mirrors DrizzleDepositRepository.findDepositForAppointment's
  // own reconstruction exactly.
  it('reconstructs a settled DepositState instead of throwing, for a web appointment with a real deposit_id', async () => {
    const appointmentId = crypto.randomUUID();
    const [deposit] = await client`insert into deposits (amount_cents, payment_id, state)
                                     values (250000, ${'mp-' + appointmentId}, 'settled') returning id`;
    await client`insert into slot_occupancies (id, barber_id, service_id, client_id, channel, status, time_range, deposit_id)
                 values (${appointmentId}, ${barberId}, ${serviceId}, ${clientId}, 'web', 'reservado', ${range('08:00', '08:30')}::tstzrange, ${deposit!.id})`;
    const repo = new DrizzleAppointmentRepository(db);

    const appointment = await repo.findById(appointmentId);

    expect(appointment?.deposit).toEqual({ kind: 'settled', paymentId: 'mp-' + appointmentId, amountCents: 250000 });
  });

  it('reconstructs a refunded DepositState the same way', async () => {
    const appointmentId = crypto.randomUUID();
    const [deposit] = await client`insert into deposits (amount_cents, payment_id, state)
                                     values (250000, ${'mp-refunded-' + appointmentId}, 'refunded') returning id`;
    await client`insert into slot_occupancies (id, barber_id, service_id, client_id, channel, status, time_range, deposit_id)
                 values (${appointmentId}, ${barberId}, ${serviceId}, ${clientId}, 'web', 'cancelado', ${range('08:30', '09:00')}::tstzrange, ${deposit!.id})`;
    const repo = new DrizzleAppointmentRepository(db);

    const appointment = await repo.findById(appointmentId);

    expect(appointment?.deposit).toEqual({ kind: 'refunded', refundId: '', amountCents: 250000 });
  });

  // 12.1/12.2/12.12/12.13 — barber-absence-reassignment, "Detección de
  // turnos afectados" + "No interferencia con otros turnos": the WHERE
  // clause is what makes the scope structural.
  describe('findReservedByBarberInRange (12.1/12.2/12.12/12.13)', () => {
    it('returns only THIS barber\'s reservado appointments inside the range, excluding another barber\'s turno in the exact same window', async () => {
      const absentBarber = await newBarber();
      const otherActiveBarber = await newBarber();
      const affected = await insertAppointment(absentBarber, '09:00', '09:30');
      // Same window, different (non-absent) barber — MUST NOT come back.
      await insertAppointment(otherActiveBarber, '09:00', '09:30');
      const repo = new DrizzleAppointmentRepository(db);

      const found = await repo.findReservedByBarberInRange(absentBarber, {
        start: at('09:00'),
        end: at('18:00'),
      });

      expect(found.map((a) => a.id)).toEqual([affected]);
    });

    it('excludes a reservado appointment for the same barber OUTSIDE the range', async () => {
      const barber = await newBarber();
      await insertAppointment(barber, '20:00', '20:30');
      const repo = new DrizzleAppointmentRepository(db);

      const found = await repo.findReservedByBarberInRange(barber, {
        start: at('09:00'),
        end: at('18:00'),
      });

      expect(found).toEqual([]);
    });

    it('excludes a cancelled appointment for the same barber inside the range — only reservado counts', async () => {
      const barber = await newBarber();
      const id = await insertAppointment(barber, '17:00', '17:30');
      const repo = new DrizzleAppointmentRepository(db);
      await repo.updateStatus(id, 'cancelado');

      const found = await repo.findReservedByBarberInRange(barber, {
        start: at('09:00'),
        end: at('18:00'),
      });

      expect(found).toEqual([]);
    });
  });

  // cablear-el-mvp C.3 — "Mi cuenta" needs every one of the client's OWN
  // appointments, any status, and structurally none of anybody else's.
  describe('findByClientId (C.3)', () => {
    const newClientRecord = async (): Promise<string> => {
      const id = crypto.randomUUID();
      await client`insert into clients (id, name, phone) values (${id}, 'Cliente aislado', '3510000001')`;
      return id;
    };

    const insertAppointmentFor = async (
      client_: string,
      barber: string,
      from: string,
      to: string,
      status = 'reservado',
    ) => {
      const id = crypto.randomUUID();
      await client`insert into slot_occupancies (id, barber_id, service_id, client_id, channel, status, time_range)
                   values (${id}, ${barber}, ${serviceId}, ${client_}, 'telefonico', ${status}, ${range(from, to)}::tstzrange)`;
      return id;
    };

    it("returns every one of the client's own appointments, any status, and none of another client's", async () => {
      const own = await newClientRecord();
      const other = await newClientRecord();
      // Deliberately BEFORE 07:00 — every other test in this file's shared
      // `barberId` fixture books from 08:00 onward, and rows accumulate
      // across the whole suite's run (no per-test reset).
      const reservado = await insertAppointmentFor(own, barberId, '05:00', '05:30', 'reservado');
      const cancelado = await insertAppointmentFor(own, barberId, '05:30', '06:00', 'cancelado');
      await insertAppointmentFor(other, barberId, '06:00', '06:30');
      const repo = new DrizzleAppointmentRepository(db);

      const found = await repo.findByClientId(own);

      expect(found.map((a) => a.id).sort()).toEqual([cancelado, reservado].sort());
    });

    it('returns an empty list for a client with no appointments, never an error', async () => {
      const lonely = await newClientRecord();
      const repo = new DrizzleAppointmentRepository(db);

      const found = await repo.findByClientId(lonely);

      expect(found).toEqual([]);
    });
  });
});
