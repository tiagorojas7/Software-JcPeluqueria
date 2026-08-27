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

  // The orphaned-charge hole: checkout has no per-hold lock, so a SECOND
  // payment can settle for a hold already reservado through the first one.
  // The insert-then-claim pair must be atomic — a deposit row that survives
  // a failed claim is captured money linked to nothing (`findDepositForAppointment`
  // only resolves through `slot_occupancies.deposit_id`), and its
  // `payment_id` UNIQUE hit would turn every webhook retry into
  // 'already-processed', permanently burying the refund the worker owes.
  it('rolls the deposit insert back when the hold cannot be claimed — no orphaned settled row survives', async () => {
    const holdId = await newWebHold();
    const repo = new DrizzleDepositRepository(db);
    await repo.recordSettledPayment({ holdId, paymentId: 'payment-first', amountCents: 250000 });

    const second = await repo.recordSettledPayment({ holdId, paymentId: 'payment-second', amountCents: 250000 });

    expect(second).toBe('hold-not-found');
    const rows = await client`select count(*)::int as total from deposits where payment_id = 'payment-second'`;
    expect([...rows]).toEqual([{ total: 0 }]);
    // And the retry is a FRESH attempt (fresh insert, fresh claim, fresh
    // hold-not-found for the caller to refund) — never 'already-processed'.
    const retry = await repo.recordSettledPayment({ holdId, paymentId: 'payment-second', amountCents: 250000 });
    expect(retry).toBe('hold-not-found');
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

  // Task 5.20 — `findDepositForAppointment` joins `slot_occupancies.deposit_id`
  // → `deposits` so `RefundUseCase` can decide (settled → refund |
  // refunded → idempotent no-op | not_applicable → no-deposit). The Testcontainers
  // proof matters because the join's "no deposit attached" case (phone /
  // walk-in) must surface as `{kind:'not_applicable'}` — never as null, which
  // would collide with "appointment row does not exist" (a caller bug).
  const reservadoWithDeposit = async (
    depositState: 'settled' | 'refunded',
  ): Promise<{ appointmentId: string; depositId: string; paymentId: string }> => {
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Barbero', active: true });
    await new DrizzleBarberRepository(db).create(barber);
    const paymentId = `mp-${crypto.randomUUID()}`;
    const [deposit] = await client`
      insert into deposits (amount_cents, payment_id, state) values (250000, ${paymentId}, ${depositState})
      returning id
    `;
    const [occ] = await client`
      insert into slot_occupancies (barber_id, service_id, channel, status, time_range, deposit_id)
      values (${barber.id}, ${serviceId}, 'web', 'reservado', ${range}::tstzrange, ${deposit!.id})
      returning id
    `;
    return { appointmentId: occ!.id, depositId: deposit!.id, paymentId };
  };

  it('findDepositForAppointment loads a settled deposit attached to a reservado appointment', async () => {
    const { appointmentId, depositId, paymentId } = await reservadoWithDeposit('settled');
    const repo = new DrizzleDepositRepository(db);

    const loaded = await repo.findDepositForAppointment(appointmentId);

    expect(loaded).toEqual({
      depositId,
      state: { kind: 'settled', paymentId, amountCents: 250000 },
    });
  });

  it('findDepositForAppointment loads a refunded deposit (loaded refundId is empty by design)', async () => {
    const { appointmentId, depositId } = await reservadoWithDeposit('refunded');
    const repo = new DrizzleDepositRepository(db);

    const loaded = await repo.findDepositForAppointment(appointmentId);

    // `deposits` does not persist the gateway refund id (design.md row 457:
    // state/amount_cents/payment_id only), so the loaded `refunded` state
    // carries `refundId: ''` — the use case only needs `.kind` to short-
    // circuit its idempotent retry branch anyway.
    expect(loaded).toEqual({
      depositId,
      state: { kind: 'refunded', refundId: '', amountCents: 250000 },
    });
  });

  it('findDepositForAppointment returns not_applicable for a phone appointment with no deposit attached', async () => {
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Barbero', active: true });
    await new DrizzleBarberRepository(db).create(barber);
    const [occ] = await client`
      insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
      values (${barber.id}, ${serviceId}, 'telefono', 'reservado', ${range}::tstzrange)
      returning id
    `;
    const repo = new DrizzleDepositRepository(db);

    const loaded = await repo.findDepositForAppointment(occ!.id);

    expect(loaded).toEqual({ depositId: null, state: { kind: 'not_applicable' } });
  });

  it('findDepositForAppointment returns null when the appointment id does not exist (caller bug, not no-op)', async () => {
    const repo = new DrizzleDepositRepository(db);

    const loaded = await repo.findDepositForAppointment(crypto.randomUUID());

    expect(loaded).toBeNull();
  });

  it('markRefunded flips a settled deposit to refunded', async () => {
    const { depositId } = await reservadoWithDeposit('settled');
    const repo = new DrizzleDepositRepository(db);

    await repo.markRefunded({ depositId, refundId: 'mp-refund-1' });

    const [row] = await client`select state from deposits where id = ${depositId}`;
    expect(row!.state).toBe('refunded');
  });

  it('markRefunded is idempotent at the SQL level — re-marking an already-refunded deposit is a no-op', async () => {
    const { depositId } = await reservadoWithDeposit('settled');
    const repo = new DrizzleDepositRepository(db);
    await repo.markRefunded({ depositId, refundId: 'mp-refund-1' });

    await expect(repo.markRefunded({ depositId, refundId: 'mp-refund-2' })).resolves.toBeUndefined();

    const rows = await client`select state, count(*)::int as total from deposits where id = ${depositId} group by state`;
    expect([...rows]).toEqual([{ state: 'refunded', total: 1 }]);
  });
});
