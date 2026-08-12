import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService, SlotUnavailableError, type Hold } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleHoldRepository } from './hold.repository';

// Slot exclusivity is a database guarantee, not an application one, so it can
// only be proven against a real PostgreSQL engine. The pool is sized above the
// 20 competitors of the concurrency test on purpose: with a smaller pool the
// losers would queue instead of racing, and the test would prove nothing.
const POOL_SIZE = 25;
const DAY = '2026-09-01';

describe('slot occupancy exclusivity (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let barberId: string;
  let serviceId: string;

  const clock = new ShopClock();
  const at = (wallClock: string): Date => clock.localTimeToUtc(DAY, wallClock);
  const range = (from: string, to: string) =>
    `[${at(from).toISOString()},${at(to).toISOString()})`;
  const rawHold = (from: string, to: string) =>
    client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
           values (${barberId}, ${serviceId}, 'web', 'held', ${range(from, to)}::tstzrange)`;

  // The barber's working window for the day, as Phase 1's
  // AvailabilityService.workingWindows() would return it. Alternatives are
  // only ever searched inside it.
  const workingWindow = { start: at('09:00'), end: at('18:00') };
  const holdFor = (barber: string, from: string, to: string): Hold => ({
    id: crypto.randomUUID(),
    barberId: barber,
    serviceId,
    clientId: null,
    channel: 'web',
    timeRange: { start: at(from), end: at(to) },
    holdExpiresAt: at('23:00'),
  });
  // Each competing scenario gets its own barber: the constraint is scoped per
  // barber, so this keeps the tests from occupying each other's ranges.
  const newBarber = async (): Promise<string> => {
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Barbero', active: true });
    await new DrizzleBarberRepository(db).create(barber);
    return barber.id;
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
      // Same contention allowance as the availability suite: pg_isready's own
      // wait strategy has a 120s default that is not enough on this machine.
      .withStartupTimeout(240_000)
      .start();

    client = postgres(container.getConnectionUri(), { max: POOL_SIZE });
    db = drizzle(client);
    await migrate(db, { migrationsFolder: './src/db/migrations' });

    const barber = createBarber({ id: crypto.randomUUID(), name: 'Juan', active: true });
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte clasico',
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

  it('rejects the loser of two concurrent inserts on the same barber and range with 23P01', async () => {
    const results = await Promise.allSettled([rawHold('10:00', '10:30'), rawHold('10:00', '10:30')]);

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('23P01');
  });

  it('stores a hold over a free range', async () => {
    const hold = holdFor(await newBarber(), '11:00', '11:30');

    await new DrizzleHoldRepository(db).create(hold, workingWindow);

    const rows = await client`select status, time_range = ${range('11:00', '11:30')}::tstzrange as exact
                                from slot_occupancies where id = ${hold.id}`;
    expect([...rows]).toEqual([{ status: 'held', exact: true }]);
  });

  it('translates 23P01 into a domain rejection carrying the free ranges left in the day', async () => {
    const repo = new DrizzleHoldRepository(db);
    const barber = await newBarber();
    await repo.create(holdFor(barber, '10:00', '10:30'), workingWindow);

    const error = await repo.create(holdFor(barber, '10:00', '10:30'), workingWindow).catch((e) => e);

    expect(error).toBeInstanceOf(SlotUnavailableError);
    expect(error.alternatives).toEqual([
      { start: at('09:00'), end: at('10:00') },
      { start: at('10:30'), end: at('18:00') },
    ]);
  });

  it('offers no gap between two occupancies that touch', async () => {
    const repo = new DrizzleHoldRepository(db);
    const barber = await newBarber();
    await repo.create(holdFor(barber, '09:00', '12:00'), workingWindow);
    await repo.create(holdFor(barber, '12:00', '17:00'), workingWindow);

    const error = await repo.create(holdFor(barber, '10:00', '10:30'), workingWindow).catch((e) => e);

    expect(error.alternatives).toEqual([{ start: at('17:00'), end: at('18:00') }]);
  });
});
