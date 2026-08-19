import type {
  NotificationOutboxRecord,
  NotificationOutboxRepository,
  NotificationOutboxStatus,
  NotificationTemplate,
} from '@jc-barberia/domain';
import { randomUUID } from 'node:crypto';

/**
 * Interim `NotificationOutboxRepository` — Slice A's real
 * `DrizzleNotificationOutboxRepository` (migration 0011 + the `notification_outbox`
 * table) does not exist on this branch yet (tasks.md's own audit). Rather than
 * leave `RequestClientAccessUseCase` unwired until that lands (cablear-el-mvp
 * explicitly says not to wait for it), this logs every enqueued intent to
 * stdout — the same "console channel" design.md already names as a legitimate
 * `NotificationPort` choice (`ConsoleNotificationAdapter`), applied here one
 * layer down at the OUTBOX port instead. Not a test double: it is real,
 * observable production behaviour for local/demo runs, meant to be swapped for
 * the Drizzle adapter with a one-line DI change once migration 0011 lands —
 * same token-per-module swap every other port in this app already uses.
 *
 * Keeps an in-memory pending queue too (not just a log line) so a future
 * consumer wired against this exact binding would behave correctly, though
 * nothing in this slice registers one.
 */
export class ConsoleNotificationOutboxRepository implements NotificationOutboxRepository {
  readonly enqueued: Array<{
    readonly notificationType: NotificationTemplate;
    readonly recipientEmail: string;
    readonly payload: Readonly<Record<string, string>>;
  }> = [];
  readonly deliveredIds: string[] = [];
  readonly failures: Array<{ readonly id: string; readonly error: string }> = [];
  private readonly pending: NotificationOutboxRecord[] = [];

  async enqueue(input: {
    readonly notificationType: NotificationTemplate;
    readonly recipientEmail: string;
    readonly payload: Readonly<Record<string, string>>;
  }): Promise<void> {
    this.enqueued.push(input);
    this.pending.push({
      id: randomUUID(),
      notificationType: input.notificationType,
      recipientEmail: input.recipientEmail,
      payload: input.payload,
      attempts: 0,
      status: 'pending' as NotificationOutboxStatus,
      lastError: null,
    });
    console.log(
      `[notification_outbox] type=${input.notificationType} to=${input.recipientEmail} payload=${JSON.stringify(input.payload)}`,
    );
  }

  async pickPendingForDelivery(): Promise<NotificationOutboxRecord | null> {
    return this.pending.shift() ?? null;
  }

  async markDelivered(id: string): Promise<void> {
    this.deliveredIds.push(id);
  }

  async markFailed(id: string, error: string): Promise<void> {
    this.failures.push({ id, error });
  }
}
