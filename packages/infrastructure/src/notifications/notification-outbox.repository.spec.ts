import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleNotificationOutboxRepository, MAX_DELIVERY_ATTEMPTS } from './notification-outbox.repository';

/**
 * A.2 — RED (Testcontainers). Real proof, not the fake's: the tracker's own
 * lesson ("pasaron los tests porque los tests usan el fake") is exactly what
 * this suite refuses to repeat. `notification_outbox` has no FK to any other
 * table (design.md row 459: "intención, payload, estado, intentos" — a
 * standalone audit/delivery row), so this spec needs no barber/service/client
 * fixtures, unlike `deposit.repository.spec.ts`.
 */
describe('DrizzleNotificationOutboxRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

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
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('enqueue writes a pending row that pickPendingForDelivery returns exactly once per tanda', async () => {
    const repo = new DrizzleNotificationOutboxRepository(db);
    await repo.enqueue({
      notificationType: 'client_access_code',
      recipientEmail: 'cliente@jcbarberia.test',
      payload: { code: '123456' },
    });

    const picked = await repo.pickPendingForDelivery();
    const secondPick = await repo.pickPendingForDelivery();

    expect(picked).toMatchObject({
      notificationType: 'client_access_code',
      recipientEmail: 'cliente@jcbarberia.test',
      payload: { code: '123456' },
      attempts: 0,
      status: 'pending',
      lastError: null,
    });
    expect(typeof picked!.id).toBe('string');
    // The SAME tanda never hands out the row twice — a second pick right
    // after finds nothing else pending.
    expect(secondPick).toBeNull();
  });

  it('pickPendingForDelivery never re-delivers a row it already picked, even across separate calls', async () => {
    const repo = new DrizzleNotificationOutboxRepository(db);
    await repo.enqueue({
      notificationType: 'cancellation_with_refund',
      recipientEmail: 'otro@jcbarberia.test',
      payload: { refundId: 'mp-refund-1', amountCents: '250000' },
    });
    const first = await repo.pickPendingForDelivery();

    const second = await repo.pickPendingForDelivery();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('markDelivered flips the row to delivered and it is never picked again', async () => {
    const repo = new DrizzleNotificationOutboxRepository(db);
    await repo.enqueue({
      notificationType: 'staff_activation',
      recipientEmail: 'staff@jcbarberia.test',
      payload: { token: 'tok-1' },
    });
    const picked = await repo.pickPendingForDelivery();

    await repo.markDelivered(picked!.id);

    const [row] = await client`select status from notification_outbox where id = ${picked!.id}`;
    expect(row!.status).toBe('delivered');
    const rePick = await repo.pickPendingForDelivery();
    expect(rePick).toBeNull();
  });

  it('markFailed increments attempts, records last_error, and the row stays pending but not immediately re-pickable (backoff)', async () => {
    const repo = new DrizzleNotificationOutboxRepository(db);
    await repo.enqueue({
      notificationType: 'reminder_without_deposit',
      recipientEmail: 'falla@jcbarberia.test',
      payload: { appointmentId: 'apt-1', appointmentTime: '2026-09-01T12:00:00Z' },
    });
    const picked = await repo.pickPendingForDelivery();

    await repo.markFailed(picked!.id, 'SMTP timeout');

    const [row] = await client`
      select status, attempts, last_error, next_attempt_at > now() as backoff_in_future
      from notification_outbox where id = ${picked!.id}
    `;
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(1);
    expect(row!.last_error).toBe('SMTP timeout');
    // The backoff window respects `attempts` — it is NOT re-pickable this instant.
    expect(row!.backoff_in_future).toBe(true);
    const rePick = await repo.pickPendingForDelivery();
    expect(rePick).toBeNull();
  });

  it('picks a previously failed row again once its backoff window has elapsed', async () => {
    const repo = new DrizzleNotificationOutboxRepository(db);
    await repo.enqueue({
      notificationType: 'reminder_with_deposit',
      recipientEmail: 'retry@jcbarberia.test',
      payload: { appointmentId: 'apt-2', appointmentTime: '2026-09-01T12:00:00Z', cancelDeadline: '2026-09-01T11:00:00Z' },
    });
    const picked = await repo.pickPendingForDelivery();
    await repo.markFailed(picked!.id, 'SMTP timeout');
    // Simulate the backoff window elapsing — no `new Date()` in TS: the SQL
    // side moves the due time into the past, exactly how a real clock tick
    // would, without this spec needing to wait or fake wall time itself.
    await client`update notification_outbox set next_attempt_at = now() - interval '1 second' where id = ${picked!.id}`;

    const rePicked = await repo.pickPendingForDelivery();

    expect(rePicked).toMatchObject({ id: picked!.id, attempts: 1, status: 'pending' });
  });

  it(`flips to dead after ${MAX_DELIVERY_ATTEMPTS} failures and is never picked again, even past its backoff`, async () => {
    const repo = new DrizzleNotificationOutboxRepository(db);
    await repo.enqueue({
      notificationType: 'absence_reassignment_offer',
      recipientEmail: 'nuncasale@jcbarberia.test',
      payload: { offerId: 'offer-1' },
    });
    const firstPick = await repo.pickPendingForDelivery();
    const id = firstPick!.id;
    let row = firstPick;
    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
      await repo.markFailed(id, `failure-${attempt}`);
      await client`update notification_outbox set next_attempt_at = now() - interval '1 second' where id = ${id}`;
      row = await repo.pickPendingForDelivery();
      if (attempt < MAX_DELIVERY_ATTEMPTS - 1) {
        expect(row).not.toBeNull();
      }
    }

    const [finalRow] = await client`select status, attempts from notification_outbox where id = ${id}`;
    expect(finalRow!.status).toBe('dead');
    expect(finalRow!.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(row).toBeNull(); // the cap-crossing pick never hands the row back out
  });
});
