import { describe, expect, it, vi } from 'vitest';

import { ConsoleNotificationOutboxRepository } from './console-notification-outbox.repository';

// cablear-el-mvp C.1 RED — Slice A's `DrizzleNotificationOutboxRepository`
// (migration 0011) does not exist on this branch yet (tasks.md's own audit:
// "Infraestructura que no existe: tabla notification_outbox · su adaptador
// Drizzle"), and this slice was told explicitly not to wait for it.
// `RequestClientAccessUseCase` still needs SOME `NotificationOutboxRepository`
// to enqueue into, or its endpoint 500s the moment a real client requests
// access — this is that interim, real (not a test double) adapter: it logs
// every enqueued intent to stdout, satisfying "leer el código del log"
// literally, the same role `ConsoleNotificationAdapter` already plays for
// `NotificationPort`.
describe('ConsoleNotificationOutboxRepository (C.1)', () => {
  it('logs every enqueued notification to stdout, payload included', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const repo = new ConsoleNotificationOutboxRepository();

    await repo.enqueue({
      notificationType: 'client_access_code',
      recipientEmail: 'cliente@example.com',
      payload: { challengeId: 'chal-1', code: '123456' },
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0] as [string];
    expect(line).toContain('client_access_code');
    expect(line).toContain('cliente@example.com');
    expect(line).toContain('chal-1');
    expect(line).toContain('123456');
    logSpy.mockRestore();
  });

  it('keeps an in-memory record of what it enqueued, for tests/inspection', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const repo = new ConsoleNotificationOutboxRepository();

    await repo.enqueue({
      notificationType: 'client_access_code',
      recipientEmail: 'a@example.com',
      payload: { code: '1' },
    });
    await repo.enqueue({
      notificationType: 'absence_reassignment_offer',
      recipientEmail: 'b@example.com',
      payload: { code: '2' },
    });

    expect(repo.enqueued).toHaveLength(2);
    expect(repo.enqueued[0]).toMatchObject({ notificationType: 'client_access_code', recipientEmail: 'a@example.com' });
    logSpy.mockRestore();
  });

  it('pickPendingForDelivery drains in FIFO order, and markDelivered/markFailed record the outcome', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const repo = new ConsoleNotificationOutboxRepository();
    await repo.enqueue({ notificationType: 'client_access_code', recipientEmail: 'a@example.com', payload: {} });
    await repo.enqueue({ notificationType: 'client_access_code', recipientEmail: 'b@example.com', payload: {} });

    const first = await repo.pickPendingForDelivery();
    const second = await repo.pickPendingForDelivery();
    const third = await repo.pickPendingForDelivery();

    expect(first?.recipientEmail).toBe('a@example.com');
    expect(second?.recipientEmail).toBe('b@example.com');
    expect(third).toBeNull();

    await repo.markDelivered(first!.id);
    await repo.markFailed(second!.id, 'boom');

    expect(repo.deliveredIds).toEqual([first!.id]);
    expect(repo.failures).toEqual([{ id: second!.id, error: 'boom' }]);
    logSpy.mockRestore();
  });
});
