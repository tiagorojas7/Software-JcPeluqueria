import {
  FakeNotificationOutboxRepository,
  FakeNotificationPort,
  type NotificationMessage,
  type NotificationPort,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { NotificationOutboxConsumer } from './outbox-consumer';

// 6.12 RED — the consumer's deliver-or-record contract. Behavior pulled from
// design.md "Outbox transaccional para notificaciones":
//   - a pending row whose send() resolves → mark the row delivered
//   - a pending row whose send() rejects  → mark the row failed (attempts +1,
//     backoff) and MOVE ON — never tight-loop one failure, because the port
//     holds the backoff; within one pass each row is picked once
//   - empty outbox → a clean {0,0} pass
// Phase 7 swaps the fake transports for the Gmail adapter + the fake outbox
// repo for the Drizzle one; here the contract is pure app layer.

/** A `NotificationPort` that throws on its first N `send()` calls then
 *  succeeds — the one transport quirk the consumer genuinely cares about. */
class FlakyNotificationPort implements NotificationPort {
  readonly sentMessages: NotificationMessage[] = [];
  private calls = 0;
  constructor(private readonly failTimes: number) {}
  async send(message: NotificationMessage): Promise<void> {
    this.sentMessages.push(message);
    if (this.calls++ < this.failTimes) {
      throw new Error('SMTP transient failure');
    }
  }
}

describe('NotificationOutboxConsumer', () => {
  const enqueuePending = async (
    outbox: FakeNotificationOutboxRepository,
    notificationType: NotificationMessage['template'] = 'reminder_without_deposit',
    recipient = 'cliente@jcbarberia.com',
  ): Promise<void> => {
    await outbox.enqueue({ notificationType, recipientEmail: recipient, payload: { appointmentId: 'apt-1' } });
  };

  it('delivers a pending row: calls NotificationPort.send and marks the row delivered', async () => {
    const outbox = new FakeNotificationOutboxRepository();
    const notifications = new FakeNotificationPort();
    await enqueuePending(outbox);

    const result = await new NotificationOutboxConsumer(notifications, outbox).execute();

    expect(result).toEqual({ delivered: 1, failed: 0 });
    expect(notifications.sentMessages).toHaveLength(1);
    expect(notifications.sentMessages[0]).toMatchObject({
      to: 'cliente@jcbarberia.com',
      template: 'reminder_without_deposit',
      data: { appointmentId: 'apt-1' },
    });
    expect(outbox.deliveredIds).toHaveLength(1);
    expect(outbox.failures).toEqual([]);
  });

  it('records a retry/backoff signal — not delivery — when send() rejects', async () => {
    const outbox = new FakeNotificationOutboxRepository();
    const notifications = new FlakyNotificationPort(1); // 1st send throws
    await enqueuePending(outbox, 'reminder_with_deposit');

    const result = await new NotificationOutboxConsumer(notifications, outbox).execute();

    expect(result).toEqual({ delivered: 0, failed: 1 });
    // send was still attempted (the port records it); the row is NOT delivered.
    expect(notifications.sentMessages).toHaveLength(1);
    expect(outbox.failures).toHaveLength(1);
    expect(outbox.failures[0]?.error).toBe('SMTP transient failure');
    expect(outbox.deliveredIds).toEqual([]);
  });

  it('moves past a failing row to deliver the next, never tight-looping the failure', async () => {
    const outbox = new FakeNotificationOutboxRepository();
    const notifications = new FlakyNotificationPort(1); // fails the 1st, succeeds the 2nd
    await enqueuePending(outbox, 'reminder_without_deposit', 'a@jcbarberia.com');
    await enqueuePending(outbox, 'reminder_with_deposit', 'b@jcbarberia.com');

    const result = await new NotificationOutboxConsumer(notifications, outbox).execute();

    // Both rows were picked once; the loop continued past the failure.
    expect(result).toEqual({ delivered: 1, failed: 1 });
    expect(notifications.sentMessages).toHaveLength(2);
    expect(outbox.deliveredIds).toHaveLength(1);
    expect(outbox.failures).toHaveLength(1);
  });

  it('returns a clean summary when the outbox has nothing to deliver', async () => {
    const outbox = new FakeNotificationOutboxRepository();
    const notifications = new FakeNotificationPort();

    const result = await new NotificationOutboxConsumer(notifications, outbox).execute();

    expect(result).toEqual({ delivered: 0, failed: 0 });
    expect(notifications.sentMessages).toEqual([]);
    expect(outbox.deliveredIds).toEqual([]);
    expect(outbox.failures).toEqual([]);
  });
});
