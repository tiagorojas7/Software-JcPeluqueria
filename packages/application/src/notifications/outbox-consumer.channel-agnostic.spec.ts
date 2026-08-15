import {
  FakeNotificationOutboxRepository,
  FakeNotificationPort,
  type NotificationMessage,
  type NotificationPort,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { NotificationOutboxConsumer } from './outbox-consumer';

// 7.5 / 7.6 — "sustituir el adaptador por uno alternativo no requiere cambios
// en el dominio. Confirmar via inyeccion de dependencias (token de puerto, no
// import directo en use cases)." The consumer depends on the `NotificationPort`
// TYPE (the token) only — handing it a DIFFERENT adapter than the one it was
// built against must still dispatch, with zero edits to the consumer itself.
// `FakeNotificationPort` here stands in for "the alternate channel" (the role
// `ConsoleNotificationAdapter` / a future `WhatsAppBusinessAdapter` plays):
// if the consumer had hardcoded Gmail, this alternative would never receive.

/** A second `NotificationPort` impl the consumer was NOT built against — proves
 *  the swap. Distinct from `FakeNotificationPort` so the assertion can't pass
 *  by accident through the same class the 6.13 tests wired. */
class AlternateChannelPort implements NotificationPort {
  readonly dispatched: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> {
    this.dispatched.push(message);
  }
}

describe('NotificationOutboxConsumer — intercambio de canal (7.5/7.6)', () => {
  it('despacha por el adaptador alternativo sin tocar el consumidor ni el dominio', async () => {
    const outbox = new FakeNotificationOutboxRepository();
    const alternate = new AlternateChannelPort();
    await outbox.enqueue({
      notificationType: 'reminder_without_deposit',
      recipientEmail: 'cliente@jcbarberia.com',
      payload: { appointmentId: 'apt-1' },
    });

    const result = await new NotificationOutboxConsumer(alternate, outbox).execute();

    // The consumer delivered through the ALTERNATIVE, not any Gmail/SMTP path —
    // and the consumer's code did not change to know this channel exists.
    expect(result).toEqual({ delivered: 1, failed: 0 });
    expect(alternate.dispatched).toHaveLength(1);
    expect(alternate.dispatched[0]).toMatchObject({
      to: 'cliente@jcbarberia.com',
      template: 'reminder_without_deposit',
      data: { appointmentId: 'apt-1' },
    });
  });

  it('acepta FakeNotificationPort igual que el alternativo — ambas son el mismo token', async () => {
    // The same consumer wiring with the domain's own fake: same behavior, same
    // port. The point is it does not matter WHICH adapter — the consumer only
    // sees `NotificationPort`.
    const outbox = new FakeNotificationOutboxRepository();
    const fake = new FakeNotificationPort();
    await outbox.enqueue({
      notificationType: 'cancellation_with_refund',
      recipientEmail: 'c@jcbarberia.com',
      payload: { refundId: 'rf-1', amountCents: '250000' },
    });

    await new NotificationOutboxConsumer(fake, outbox).execute();

    expect(fake.sentMessages).toHaveLength(1);
    expect(outbox.deliveredIds).toHaveLength(1);
  });
});
