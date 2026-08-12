import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { ShopClock } from '../shared/clock/shop-clock';

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
});
