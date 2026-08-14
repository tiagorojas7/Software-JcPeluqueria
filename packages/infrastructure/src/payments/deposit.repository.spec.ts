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

  // Task 5.15/5.16 — `releaseHoldOnRejectedPayment` is the symmetric,
  // idempotent DB counterpart of `recordSettledPayment` for the terminal-
  // failure side of the webhook (design.md line 152). Same atomic
  // `UPDATE ... WHERE status='held' AND payment_pending = true RETURNING`
  // shape — zero rows means "already released by a retry or never a pending
  // hold", both of which are no-ops.
  const newPendingWebHold = async (): Promise<string> => {
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Barbero', active: true });
    await new DrizzleBarberRepository(db).create(barber);
    const [row] = await client`
      insert into slot_occupancies (barber_id, service_id, channel, status, time_range, hold_expires_at, payment_pending)
      values (${barber.id}, ${serviceId}, 'web', 'held', ${range}::tstzrange, now() + interval '15 minutes', true)
      returning id
    `;
    return row!.id;
  };

  it('releases a payment_pending held hold immediately on rejection, clearing payment_pending', async () => {
    const holdId = await newPendingWebHold();
    const repo = new DrizzleDepositRepository(db);

    const outcome = await repo.releaseHoldOnRejectedPayment(holdId);

    expect(outcome).toBe('released');
    const [row] = await client`select status, payment_pending from slot_occupancies where id = ${holdId}`;
    expect(row!.status).toBe('liberado');
    expect(row!.payment_pending).toBe(false);
  });

  it('is idempotent at the database level — a retry of the same rejection affects zero rows', async () => {
    const holdId = await newPendingWebHold();
    const repo = new DrizzleDepositRepository(db);
    await repo.releaseHoldOnRejectedPayment(holdId);

    const retry = await repo.releaseHoldOnRejectedPayment(holdId);

    expect(retry).toBe('no-op');
    const [row] = await client`select status from slot_occupancies where id = ${holdId}`;
    expect(row!.status).toBe('liberado');
  });

  // Triangulates the WHERE clause: a `held` row that is NOT payment_pending
  // (the pre-checkout stage) must NOT be released by the rejection path —
  // only a hold whose payment actually moved through MercadoPago can be
  // rejection-released. Zero rows → no-op, and the row keeps its `held`.
  it('leaves a held hold without payment_pending untouched (pre-checkout)', async () => {
    const holdId = await newWebHold(); // payment_pending defaults to false
    const repo = new DrizzleDepositRepository(db);

    const outcome = await repo.releaseHoldOnRejectedPayment(holdId);

    expect(outcome).toBe('no-op');
    const [row] = await client`select status, payment_pending from slot_occupancies where id = ${holdId}`;
    expect(row!.status).toBe('held');
    expect(row!.payment_pending).toBe(false);
  });
});
