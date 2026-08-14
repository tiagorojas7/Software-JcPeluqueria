import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleClientRepository } from '../clients/client.repository';
import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleAbsenceRecordRepository } from './absence-record.repository';

const DAY = '2026-09-01';

describe('DrizzleAbsenceRecordRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let appointmentId: string;
  let clientId: string;
  const staffUserId = crypto.randomUUID();
  const clock = new ShopClock();

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

    // Seed the rows the client_absences FKs require: a user (the staff member
    // who confirmed), a client, and a slot_occupancies appointment row.
    await client`insert into users (id, email) values (${staffUserId}, 'staff@example.com')`;
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Juan', active: true });
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 500000,
    });
    await new DrizzleBarberRepository(db).create(barber);
    await new DrizzleServiceRepository(db).create(service);
    clientId = (
      await new DrizzleClientRepository(db).create({
        name: 'Marcos',
        phone: '3511234567',
        email: null,
        age: null,
      })
    ).id;

    appointmentId = crypto.randomUUID();
    const range = `[${clock.localTimeToUtc(DAY, '10:00').toISOString()},${clock
      .localTimeToUtc(DAY, '10:30')
      .toISOString()})`;
    await client`insert into slot_occupancies (id, barber_id, service_id, client_id, channel, status, time_range)
                 values (${appointmentId}, ${barber.id}, ${service.id}, ${clientId}, 'telefonico', 'sin_registrado', ${range}::tstzrange)`;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('records an absence even when no seña was forfeited — the history is the entire effect', async () => {
    const repo = new DrizzleAbsenceRecordRepository(db);
    const confirmedAt = clock.localTimeToUtc('2026-09-02', '12:00');

    await repo.record({
      appointmentId,
      clientId,
      confirmedByUserId: staffUserId,
      confirmedAt,
      depositForfeited: false,
    });

    const rows = await client`select * from client_absences where appointment_id = ${appointmentId}`;
    expect([...rows]).toEqual([
      expect.objectContaining({
        appointment_id: appointmentId,
        client_id: clientId,
        confirmed_by_user_id: staffUserId,
        deposit_forfeited: false,
      }),
    ]);
    expect(rows[0]?.confirmed_at).toBeDefined();
  });
});
