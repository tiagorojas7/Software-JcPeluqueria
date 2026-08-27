import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleShopRevenueRepository } from './shop-revenue.repository';

// docs/HUECOS-BACKEND.md #5 — proven against a real database because the
// whole point is that this repository does NOT narrow to one barber, unlike
// its sibling `DrizzleBarberPerformanceRepository`.
describe('DrizzleShopRevenueRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let repository: DrizzleShopRevenueRepository;
  let barberAId: string;
  let barberBId: string;
  let serviceId: string;

  const clock = new ShopClock();
  const at = (calendarDate: string, wallClock: string): Date => clock.localTimeToUtc(calendarDate, wallClock);
  const range = (calendarDate: string, from: string, to: string) =>
    `[${at(calendarDate, from).toISOString()},${at(calendarDate, to).toISOString()})`;
  const AUGUST_RANGE = { start: at('2026-08-01', '00:00'), end: at('2026-08-31', '23:59') };

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
    repository = new DrizzleShopRevenueRepository(db);

    const barberA = createBarber({ id: crypto.randomUUID(), name: 'Juan', active: true });
    const barberB = createBarber({ id: crypto.randomUUID(), name: 'Ana', active: true });
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte clasico',
      durationMinutes: 30,
      priceCents: 500_000,
    });
    await new DrizzleBarberRepository(db).create(barberA);
    await new DrizzleBarberRepository(db).create(barberB);
    await new DrizzleServiceRepository(db).create(service);
    barberAId = barberA.id;
    barberBId = barberB.id;
    serviceId = service.id;

    // Barber A: two realizado in August. Barber B: one realizado in August —
    // BOTH must appear, unlike the per-barber repository's own suite.
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${serviceId}, 'telefonico', 'realizado', ${range('2026-08-05', '09:00', '09:30')}::tstzrange)`;
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${serviceId}, 'telefonico', 'realizado', ${range('2026-08-10', '09:00', '09:30')}::tstzrange)`;
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberBId}, ${serviceId}, 'telefonico', 'realizado', ${range('2026-08-06', '09:00', '09:30')}::tstzrange)`;
    // Must NOT appear: reservado in range, and realizado out of range.
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${serviceId}, 'telefonico', 'reservado', ${range('2026-08-12', '09:00', '09:30')}::tstzrange)`;
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${serviceId}, 'telefonico', 'realizado', ${range('2026-07-20', '09:00', '09:30')}::tstzrange)`;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('returns every realizado turno in range across EVERY barber, with barber and service names', async () => {
    const result = await repository.findCompletedAppointments(AUGUST_RANGE);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.barberId).sort()).toEqual([barberAId, barberAId, barberBId].sort());
    for (const record of result) {
      expect(record.serviceId).toBe(serviceId);
      expect(record.serviceName).toBe('Corte clasico');
      expect(record.listPriceCents).toBe(500_000);
      expect([barberAId, barberBId]).toContain(record.barberId);
      expect(['Juan', 'Ana']).toContain(record.barberName);
    }
  });

  it('excludes a reservado turno and one outside the range', async () => {
    const result = await repository.findCompletedAppointments(AUGUST_RANGE);

    // Exactly the 3 realizado-in-August rows, never the reservado one or the
    // July one — already implied by the length assertion above, restated
    // explicitly here as its own regression lock.
    expect(result).toHaveLength(3);
  });
});
