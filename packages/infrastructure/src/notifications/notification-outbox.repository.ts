import type {
  NotificationOutboxRecord,
  NotificationOutboxRepository,
  NotificationTemplate,
} from '@jc-barberia/domain';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { notificationOutbox } from '../db/schema/notification-outbox';

/**
 * Past this many `markFailed` calls a row flips to `dead` (domain port:
 * "past the cap, flips to `dead`") instead of getting another backoff
 * window — surfaced for human inspection instead of retried forever. Not
 * specified by design.md (row 459 only says "intención, payload, estado,
 * intentos"), so this is the infra's own call, exported so the Testcontainers
 * suite asserts against the real value rather than a hardcoded duplicate.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * `pickPendingForDelivery`'s lease window, in minutes: how long a picked row
 * stays un-pickable even with no `markFailed` call yet — covers a consumer
 * that crashed mid-delivery. Short enough that a live consumer's next tanda
 * is never blocked on it in practice (deliveries settle in milliseconds),
 * long enough that a normal pass never races itself. This constant is NOT
 * interpolated into the query below — `interval` needs a trusted SQL
 * literal, so the number is written directly there too; keep both in sync.
 */
export const PICK_LEASE_MINUTES = 5;

type RawOutboxRow = {
  readonly id: string;
  readonly notificationType: string;
  readonly recipientEmail: string;
  readonly payload: Record<string, string>;
  readonly attempts: number;
  readonly status: string;
  readonly lastError: string | null;
};

function toRecord(row: RawOutboxRow): NotificationOutboxRecord {
  return {
    id: row.id,
    notificationType: row.notificationType as NotificationTemplate,
    recipientEmail: row.recipientEmail,
    payload: row.payload,
    attempts: row.attempts,
    status: row.status as NotificationOutboxRecord['status'],
    lastError: row.lastError,
  };
}

/**
 * The Drizzle half of the transactional-outbox contract (design.md line 426).
 * `enqueue` is a plain insert — writers call it inside their own transaction,
 * so a rollback discards the intention with the fact it accompanies, same as
 * every other "encolar" in this codebase (`CreateHold` + `hold.expire`).
 *
 * `pickPendingForDelivery` is the one method that needs to be genuinely
 * atomic: two worker processes racing this method must never hand the same
 * row to both. `FOR UPDATE SKIP LOCKED` inside the id subquery makes the
 * second racer skip a row the first already locked, rather than block on it
 * or double-pick it — the same "zero rows means somebody else already
 * resolved this" idiom `DrizzleDepositRepository` uses via
 * `WHERE ... RETURNING`, extended with row-level locking because this query
 * additionally has to CHOOSE which row (`ORDER BY created_at LIMIT 1`), not
 * just confirm one it was already told the id of.
 *
 * The single UPDATE also leases the row `PICK_LEASE_MINUTES` into the future
 * BEFORE the caller does anything with it: this is what makes "no la vuelve
 * a entregar en la misma tanda" (A.2) true without a separate `processing`
 * status — a picked row simply fails the `next_attempt_at <= now()` predicate
 * until either `markDelivered` (terminal) or `markFailed` (real backoff,
 * computed from `attempts`) resolves it.
 */
export class DrizzleNotificationOutboxRepository implements NotificationOutboxRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async enqueue(input: {
    readonly notificationType: NotificationTemplate;
    readonly recipientEmail: string;
    readonly payload: Readonly<Record<string, string>>;
  }): Promise<void> {
    await this.db.insert(notificationOutbox).values({
      notificationType: input.notificationType,
      recipientEmail: input.recipientEmail,
      payload: input.payload,
    });
  }

  async pickPendingForDelivery(): Promise<NotificationOutboxRecord | null> {
    const result = await this.db.execute<RawOutboxRow>(sql`
      UPDATE notification_outbox
      SET next_attempt_at = now() + interval '5 minutes'
      WHERE id = (
        SELECT id FROM notification_outbox
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        notification_type AS "notificationType",
        recipient_email AS "recipientEmail",
        payload,
        attempts,
        status,
        last_error AS "lastError"
    `);
    const row = Array.from(result)[0] as RawOutboxRow | undefined;
    return row ? toRecord(row) : null;
  }

  async markDelivered(id: string): Promise<void> {
    await this.db.update(notificationOutbox).set({ status: 'delivered' }).where(eq(notificationOutbox.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    // Both branches reference `attempts + 1` (the OLD row's value, plus one)
    // because a single UPDATE's SET expressions all see the pre-update row —
    // there is no sequential "attempts already incremented" to read within
    // the same statement. Exponential backoff (2^attempts minutes) is this
    // repository's own choice (see MAX_DELIVERY_ATTEMPTS' docstring); once
    // the incremented count reaches the cap, `next_attempt_at` is left
    // untouched because `status = 'dead'` makes it irrelevant forever.
    await this.db.execute(sql`
      UPDATE notification_outbox
      SET
        attempts = attempts + 1,
        last_error = ${error},
        status = CASE WHEN attempts + 1 >= ${MAX_DELIVERY_ATTEMPTS} THEN 'dead' ELSE 'pending' END,
        next_attempt_at = CASE
          WHEN attempts + 1 >= ${MAX_DELIVERY_ATTEMPTS} THEN next_attempt_at
          ELSE now() + (power(2, attempts + 1) * interval '1 minute')
        END
      WHERE id = ${id}
    `);
  }
}
