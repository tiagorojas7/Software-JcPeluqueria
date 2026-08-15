import type { NotificationOutboxRepository, NotificationPort } from '@jc-barberia/domain';

/** What one `execute()` pass reported — an audit signal, not money. */
export interface NotificationOutboxRunSummary {
  readonly delivered: number;
  readonly failed: number;
}

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
    const row = await this.outbox.pickPendingForDelivery();
    if (row) {
      await this.notifications.send({
        to: row.recipientEmail,
        template: row.notificationType,
        data: row.payload,
      });
    }
    throw new Error('NotificationOutboxConsumer: not implemented (6.12 RED)');
  }
}
