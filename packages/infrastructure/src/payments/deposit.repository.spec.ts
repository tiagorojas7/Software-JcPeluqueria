import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { DrizzleDepositRepository } from './deposit.repository';

/**
 * Threat matrix: "reintento del mismo payment_id → cero filas afectadas".
 * This is the real database-level proof — `process-payment.spec.ts` only
 * proves the application layer calls through correctly.
 */
describe('DrizzleDepositRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let serviceId: string;

  const range = '[2026-09-01T12:00:00Z,2026-09-01T12:30:00Z)';

  const newWebHold = async (): Promise<string> => {
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Barbero', active: true });
    await new DrizzleBarberRepository(db).create(barber);
    const [row] = await client`
      insert into slot_occupancies (barber_id, service_id, channel, status, time_range, hold_expires_at)
      values (${barber.id}, ${serviceId}, 'web', 'held', ${range}::tstzrange, now() + interval '15 minutes')
      returning id
    `;
    return row!.id;
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

    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte clasico',
      durationMinutes: 30,
      priceCents: 500000,
    });
    await new DrizzleServiceRepository(db).create(service);
    serviceId = service.id;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('confirms the hold and records the deposit on first settlement', async () => {
    const holdId = await newWebHold();
    const repo = new DrizzleDepositRepository(db);

    const outcome = await repo.recordSettledPayment({ holdId, paymentId: 'payment-1', amountCents: 250000 });

    expect(outcome).toBe('confirmed');
    const [row] = await client`select status, deposit_id from slot_occupancies where id = ${holdId}`;
    expect(row!.status).toBe('reservado');
    expect(row!.deposit_id).not.toBeNull();
    const deposits = await client`select amount_cents, state from deposits where payment_id = 'payment-1'`;
    expect([...deposits]).toEqual([{ amount_cents: 250000, state: 'settled' }]);
  });

  it('is idempotent: a retried payment_id inserts zero deposit rows and leaves the appointment untouched', async () => {
    const holdId = await newWebHold();
    const repo = new DrizzleDepositRepository(db);
    await repo.recordSettledPayment({ holdId, paymentId: 'payment-2', amountCents: 250000 });
    const [beforeRetry] = await client`select deposit_id from slot_occupancies where id = ${holdId}`;

    const retryOutcome = await repo.recordSettledPayment({ holdId, paymentId: 'payment-2', amountCents: 250000 });

    expect(retryOutcome).toBe('already-processed');
    const depositRows = await client`select count(*)::int as total from deposits where payment_id = 'payment-2'`;
    expect([...depositRows]).toEqual([{ total: 1 }]);
    const [afterRetry] = await client`select deposit_id from slot_occupancies where id = ${holdId}`;
    expect(afterRetry!.deposit_id).toBe(beforeRetry!.deposit_id);
  });

  it('reports hold-not-found when the referenced hold row does not exist', async () => {
    const repo = new DrizzleDepositRepository(db);

    const outcome = await repo.recordSettledPayment({
      holdId: crypto.randomUUID(),
      paymentId: 'payment-3',
      amountCents: 250000,
    });

    expect(outcome).toBe('hold-not-found');
  });
});
