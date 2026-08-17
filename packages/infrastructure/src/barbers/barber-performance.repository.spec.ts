import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService, type ActorContext } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleBarberPerformanceRepository } from './barber-performance.repository';

// Row-level narrowing by barber_id, and the "only realizado, only inside
// range" filter, are database guarantees here (same rule as
// day-board.repository.spec.ts / agenda.repository.spec.ts) — provable only
// against a real PostgreSQL engine, not a fake.
describe('DrizzleBarberPerformanceRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let repository: DrizzleBarberPerformanceRepository;
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
    repository = new DrizzleBarberPerformanceRepository(db);

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

    // Channels are `telefonico` here, deliberately. Phase 5's
    // `web_channel_requires_deposit_once_settled` makes a `web` row past the
    // hold stage without a `deposit_id` unrepresentable, so seeding one would
    // be seeding a state the running system can never produce. Own stats count
    // `realizado` regardless of channel — the theoretical revenue is by list
    // price, not by what was collected — so the channel is not this suite's
    // subject and the deposit-free one keeps the fixture honest.
    //
    // Barber A: two realizado in August (counts), one reservado in August
    // (must not count), one realizado in July (out of range, must not count).
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${serviceId}, 'telefonico', 'realizado', ${range('2026-08-05', '09:00', '09:30')}::tstzrange)`;
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${serviceId}, 'telefonico', 'realizado', ${range('2026-08-10', '09:00', '09:30')}::tstzrange)`;
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${serviceId}, 'telefonico', 'reservado', ${range('2026-08-12', '09:00', '09:30')}::tstzrange)`;
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${serviceId}, 'telefonico', 'realizado', ${range('2026-07-20', '09:00', '09:30')}::tstzrange)`;
    // Barber B: one realizado in August — must never appear in barber A's result.
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberBId}, ${serviceId}, 'telefonico', 'realizado', ${range('2026-08-06', '09:00', '09:30')}::tstzrange)`;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('returns only the own realizado appointments inside the requested range, with the current list price', async () => {
    const actor: ActorContext = { userId: 'barber-a-user', role: 'barber', barberId: barberAId };

    const result = await repository.findCompletedAppointments(barberAId, AUGUST_RANGE, actor);

    expect(result.outcome).toBe('allowed');
    if (result.outcome !== 'allowed') throw new Error('unreachable');
    expect(result.appointments).toHaveLength(2);
    for (const appointment of result.appointments) {
      expect(appointment.listPriceCents).toBe(500_000);
      expect(appointment.serviceId).toBe(serviceId);
    }
  });

  it("rejects a request for a colleague's id — never runs the query scoped to that colleague", async () => {
    const actor: ActorContext = { userId: 'barber-a-user', role: 'barber', barberId: barberAId };

    const result = await repository.findCompletedAppointments(barberBId, AUGUST_RANGE, actor);

    expect(result).toEqual({ outcome: 'forbidden' });
  });

  it('an actor with no barberId (owner/secretary) can address any barber id directly', async () => {
    const owner: ActorContext = { userId: 'owner-1', role: 'owner' };

    const result = await repository.findCompletedAppointments(barberBId, AUGUST_RANGE, owner);

    expect(result.outcome).toBe('allowed');
    if (result.outcome !== 'allowed') throw new Error('unreachable');
    expect(result.appointments).toHaveLength(1);
  });
});
