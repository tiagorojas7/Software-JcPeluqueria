import type { NotificationOutboxRepository, NotificationPort } from '@jc-barberia/domain';

/** What one `execute()` pass reported — an audit signal, not money. */
export interface NotificationOutboxRunSummary {
  readonly delivered: number;
  readonly failed: number;
}

/** Best-effort human-readable reason to store as `last_error`. */
const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The `notification_outbox` consumer, as an application-layer use case — the
 * half the outbox port does NOT cover (design.md "Outbox transaccional"):
 * drain `pending` rows by handing each to `NotificationPort.send()`, then
 * mark the row's outcome. The promise design.md makes — "entrega con
 * reintentos y backoff" — is split so the consumer is testable WITHOUT a
 * real clock or database:
 *
 * - the consumer owns the deliver-or-record loop and the counts, and signals
 *   each outcome to the port (`markDelivered` / `markFailed`).
 * - the backoff TIMING + the dead-letter cap live in the port's impl: a row
 *   the consumer marked failed is not surfaced by a later `pickPending` until
 *   its backoff window elapses, or never again once it crosses the cap; so
 *   within ONE pass the consumer counts the failure and moves on, never
 *   tight-looping it.
 *
 * Phase 7 swaps `FakeNotificationPort` for `GmailNotificationAdapter` — the
 * ONLY thing that changes here is the injected `NotificationPort`.
 */
export class NotificationOutboxConsumer {
  constructor(
    private readonly notifications: NotificationPort,
    private readonly outbox: NotificationOutboxRepository,
  ) {}

  async execute(): Promise<NotificationOutboxRunSummary> {
    let delivered = 0;
    let failed = 0;
    let row = await this.outbox.pickPendingForDelivery();
    while (row !== null) {
      try {
        await this.notifications.send({
          to: row.recipientEmail,
          template: row.notificationType,
          data: row.payload,
        });
        await this.outbox.markDelivered(row.id);
        delivered++;
      } catch (error) {
        // Not a tight loop: the next `pickPending` surfaces the row again only
        // after the port's backoff elapses, or never once it caps to `dead` —
        // so this pass counts the failure and advances to the next row.
        await this.outbox.markFailed(row.id, reason(error));
        failed++;
      }
      row = await this.outbox.pickPendingForDelivery();
    }
    return { delivered, failed };
  }
}
