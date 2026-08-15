import type {
  NotificationOutboxRecord,
  NotificationOutboxRepository,
  NotificationOutboxStatus,
} from '../notification-outbox';
import type { NotificationTemplate } from '../notification-port';

export interface RecordedEnqueueCall {
  readonly notificationType: NotificationTemplate;
  readonly recipientEmail: string;
  readonly payload: Readonly<Record<string, string>>;
}

export interface RecordedFailure {
  readonly id: string;
  readonly error: string;
}

/**
 * In-memory `NotificationOutboxRepository` test double — the same role every
 * other `Fake*` in this codebase plays for its port. Two halves:
 *
 * - Writers assert on `enqueued` (the intent they recorded), and the no-email
 *   branch asserts `enqueued` is EMPTY.
 * - The consumer drains `pendingRows` via `pickPendingForDelivery`, which
 *   shifts the queue exactly once per row, so a failing row never tight-loops
 *   the backoff enforcement. `deliveredIds` / `failures` record the terminal
 *   status the consumer asked for; the real backoff timing + the `dead` cap
 *   live in the Drizzle impl (Phase 7's Testcontainers suite).
 */
export class FakeNotificationOutboxRepository implements NotificationOutboxRepository {
  readonly enqueued: RecordedEnqueueCall[] = [];
  readonly deliveredIds: string[] = [];
  readonly failures: RecordedFailure[] = [];
  /** Seed the queue with pending rows, in delivery order. */
  readonly pendingRows: NotificationOutboxRecord[] = [];

  async enqueue(input: {
    notificationType: NotificationTemplate;
    recipientEmail: string;
    payload: Readonly<Record<string, string>>;
  }): Promise<void> {
    this.enqueued.push({
      notificationType: input.notificationType,
      recipientEmail: input.recipientEmail,
      payload: input.payload,
    });
    this.pendingRows.push({
      id: this.nextId(),
      notificationType: input.notificationType,
      recipientEmail: input.recipientEmail,
      payload: input.payload,
      attempts: 0,
      status: 'pending' as NotificationOutboxStatus,
      lastError: null,
    });
  }

  async pickPendingForDelivery(): Promise<NotificationOutboxRecord | null> {
    return this.pendingRows.shift() ?? null;
  }

  async markDelivered(id: string): Promise<void> {
    this.deliveredIds.push(id);
  }

  async markFailed(id: string, error: string): Promise<void> {
    this.failures.push({ id, error });
  }

  private nextId(): string {
    // Deterministic ids keep assertions readable; the real impl hashes a UUID
    // server-side, this only needs to be unique within one test.
    return `outbox-${this.pendingRows.length + 1}-${this.enqueued.length}`;
  }
}
