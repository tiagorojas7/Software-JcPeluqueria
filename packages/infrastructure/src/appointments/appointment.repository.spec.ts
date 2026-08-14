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
});
