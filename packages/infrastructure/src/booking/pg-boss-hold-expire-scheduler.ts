import type { HoldExpireScheduler } from '@jc-barberia/domain';

/**
 * The queue name shared by the producer (this adapter) and the consumer
 * (`apps/worker`). Exported as a constant so the two sides cannot drift apart
 * through a typo in a string literal — a mismatch would silently never fire.
 */
export const HOLD_EXPIRE_QUEUE = 'hold.expire';

/** Payload the `hold.expire` handler receives. Deliberately just the id: the
 *  handler re-reads the row, so a stale snapshot can never drive a refund. */
export interface HoldExpireJob {
  readonly holdId: string;
}

/**
 * pg-boss's transaction adapter contract (`docs/api/adapters.md`). Any object
 * that can run SQL on an open transaction satisfies it, which is how the job
 * insert joins the caller's transaction instead of opening its own.
 */
export interface TransactionalDb {
  executeSql(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

/** The slice of pg-boss this adapter uses. Narrowed to one method so the unit
 *  test needs a four-line fake instead of a running Postgres. */
export interface JobSender {
  send(
    name: string,
    data: object,
    options?: { startAfter?: Date; db?: TransactionalDb },
  ): Promise<string | null>;
}

/**
 * Production `HoldExpireScheduler`. Turns the domain's "expire this hold no
 * earlier than `startAfter`" into a deferred pg-boss job.
 *
 * `startAfter` is forwarded untouched: it is the `holdExpiresAt` the same
 * `Clock` that built the hold already computed. Reading a wall clock here
 * would let the job drift away from the row it exists to expire — which is
 * exactly the coupling the `Clock` port exists to prevent.
 *
 * `currentTransaction` is optional and resolved per call rather than injected
 * as a value: whether a transaction is open is a property of the moment, not
 * of the adapter. When it returns a connection, pg-boss inserts the job inside
 * that transaction, so a rollback discards the hold and its expiry job
 * together (design.md, "Encolado transaccional") — never an orphan job whose
 * refund and notification fire for a hold that never committed.
 */
export class PgBossHoldExpireScheduler implements HoldExpireScheduler {
  constructor(
    private readonly boss: JobSender,
    private readonly currentTransaction?: () => TransactionalDb | undefined,
  ) {}

  async scheduleExpire(input: { readonly holdId: string; readonly startAfter: Date }): Promise<void> {
    const db = this.currentTransaction?.();
    const payload: HoldExpireJob = { holdId: input.holdId };

    await this.boss.send(
      HOLD_EXPIRE_QUEUE,
      payload,
      // `db` is spread in only when there is a transaction: pg-boss branches on
      // the key's presence, so an explicit `db: undefined` is not the same as
      // omitting it.
      { startAfter: input.startAfter, ...(db ? { db } : {}) },
    );
  }
}
