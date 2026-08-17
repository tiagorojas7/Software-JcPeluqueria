import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService, FakeClock, SlotUnavailableError } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { DrizzleWalkInRepository } from './walk-in.repository';

const DAY = '2026-09-01';
const dateBuilder = new FakeClock();
const range = (from: string, to: string) => ({
  start: dateBuilder.localTimeToUtc(DAY, from),
  end: dateBuilder.localTimeToUtc(DAY, to),
});
const WORKING_WINDOW = range('09:00', '18:00');

describe('DrizzleWalkInRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let barberId: string;
  let serviceId: string;

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
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 500000,
    });
    await new DrizzleBarberRepository(db).create(barber);
    await new DrizzleServiceRepository(db).create(service);
    barberId = barber.id;
    serviceId = service.id;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('inserts a walk-in directly into realizado with channel walk_in and no client', async () => {
    const repo = new DrizzleWalkInRepository(db);
    const id = crypto.randomUUID();

    await repo.create(
      { id, barberId, serviceId, clientId: null, timeRange: range('10:00', '10:30') },
      WORKING_WINDOW,
    );

    const rows = await client`select channel, status, client_id, hold_expires_at, deposit_id
                             from slot_occupancies where id = ${id}`;
    expect([...rows]).toEqual([
      { channel: 'walk_in', status: 'realizado', client_id: null, hold_expires_at: null, deposit_id: null },
    ]);
  });

  it('makes the slot unavailable — an overlapping walk-in is rejected with SlotUnavailableError', async () => {
    // admin-operations spec, "Carga de walk-ins": "ese horario deja de figurar
    // como disponible para reserva online". The `realizado` row occupies the
    // EXCLUDE predicate, so any overlapping create — walk-in or hold — is
    // rejected. Proven here by attempting a second walk-in on the same range.
    const repo = new DrizzleWalkInRepository(db);
    await repo.create(
      { id: crypto.randomUUID(), barberId, serviceId, clientId: null, timeRange: range('11:00', '11:30') },
      WORKING_WINDOW,
    );

    const error = await repo
      .create(
        { id: crypto.randomUUID(), barberId, serviceId, clientId: null, timeRange: range('11:00', '11:30') },
        WORKING_WINDOW,
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(SlotUnavailableError);
  });
});
