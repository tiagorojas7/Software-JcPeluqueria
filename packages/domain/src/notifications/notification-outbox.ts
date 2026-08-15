import type { NotificationTemplate } from './notification-port';

/**
 * Lifecycle of one outbox row (design.md "Outbox transaccional para
 * notificaciones"). `pending` rows are eligible for delivery; `delivered`
 * marks a row whose `NotificationPort.send()` resolved; `dead` is a row the
 * backoff exhausted (the impl's cap) so the consumer stops retrying it —
 * surfaced for human inspection, not retried in a tight loop.
 *
 * Phase 6 owns THIS contract + the application consumer (Fake-driven); the
 * Drizzle impl lives in Phase 7, together with the rendered templates and
 * the Gmail adapter, so the table columns are intentionally not modeled here.
 */
export type NotificationOutboxStatus = 'pending' | 'delivered' | 'dead';

/**
 * The shape a row takes once lifted out of the outbox for delivery. Maps
 * one-to-one to a `NotificationMessage` (`recipientEmail` → `to`,
 * `notificationType` → `template`, `payload` → `data`), so the consumer —
 * the only place that knows the transport — stays free of any mapping logic.
 */
export interface NotificationOutboxRecord {
  readonly id: string;
  readonly notificationType: NotificationTemplate;
  readonly recipientEmail: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly attempts: number;
  readonly status: NotificationOutboxStatus;
  readonly lastError: string | null;
}

/**
 * The transactional-outbox contract (design.md line 426: "El dominio no manda
 * mensajes: escribe una intención en `notification_outbox` dentro de la misma
 * transacción que produjo el hecho"). Two halves share this port:
 *
 * - **Writers** (the `hold.expire` / `appointment.reminder` handlers) call
 *   `enqueue` to record an intent, in the same transaction as the fact it
 *   accompanies — a rollback discards both, so no orphan notification.
 * - **The consumer** (the worker) calls `pickPendingForDelivery` /
 *   `markDelivered` / `markFailed` to deliver via `NotificationPort` with
 *   retries + exponential backoff, the backoff handled entirely HERE so the
 *   consumer never computes a due time: a row that failed is not re-picked
 *   until its backoff window elapses, and past the cap it becomes `dead`.
 */
export interface NotificationOutboxRepository {
  enqueue(input: {
    readonly notificationType: NotificationTemplate;
    readonly recipientEmail: string;
    readonly payload: Readonly<Record<string, string>>;
  }): Promise<void>;

  /** The next `pending` row whose backoff window has elapsed, or `null`. */
  pickPendingForDelivery(): Promise<NotificationOutboxRecord | null>;

  markDelivered(id: string): Promise<void>;

  /** Records the failure: increments `attempts`, stores `error` as
   *  `last_error`, and (in the impl) applies the next backoff due time so the
   *  row is not re-picked immediately; past the cap, flips to `dead`. Called
   *  ONLY when `send()` threw, so a row that never fails never lands here. */
  markFailed(id: string, error: string): Promise<void>;
}
