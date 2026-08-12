import type { NotificationMessage, NotificationPort } from '../notification-port';

/** In-memory `NotificationPort` test double — the same role every other
 *  `Fake*` in this codebase plays for its port: records exactly what was
 *  sent, so a test can assert on it without a real transport. */
export class FakeNotificationPort implements NotificationPort {
  readonly sentMessages: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.sentMessages.push(message);
  }
}
