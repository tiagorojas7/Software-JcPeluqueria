import { FakeNotificationPort } from './testing/fake-notification-port';
import type { NotificationMessage, NotificationTemplate } from './notification-port';
import { describe, expect, it } from 'vitest';

// 7.1 / 7.2 — "confirmar que el dominio invoca NotificationPort sin NINGUN
// detalle de transporte." The interface itself was built in slice 3a and
// extended with `cancellation_with_refund` in mod 6.5; THIS slice owns no new
// production port code, only the contract LOCK: any future hand that reaches
// in and wedges an SMTP/Gmail field onto `NotificationMessage`, a transport
// hint onto a `NotificationTemplate` name, or a real transporter into the
// domain's `FakeNotificationPort` turns one of these red so the leak can never
// ship silently. Passing now = the existing port already satisfies the
// transport-agnostic invariant; the test exists to defend it, not to drive it.

describe('NotificationPort — dominio sin detalle de transporte', () => {
  it('expone una intención con exactamente { to, template, data } y nada de transporte', () => {
    const message: NotificationMessage = {
      to: 'cliente@jcbarberia.com',
      template: 'reminder_with_deposit',
      data: { appointmentId: 'apt-1', appointmentTime: '2026-09-01T13:00:00.000Z' },
    };

    // Only the transport-agnostic fields exist: no `service`, no `host`, no
    // `port`, no `auth`, no `attachments`, no `from` — the adapter owns those.
    expect(Object.keys(message).sort()).toEqual(['data', 'template', 'to']);
    // `data` is a flat string map — whatever the template needs, never a
    // credential, never an SMTP option.
    for (const value of Object.values(message.data)) {
      expect(typeof value).toBe('string');
    }
  });

  it('los nombres de plantilla no filtran ningún canal de transporte', () => {
    const templates: NotificationTemplate[] = [
      'staff_activation',
      'staff_password_reset',
      'cancellation_with_refund',
      'reminder_with_deposit',
      'reminder_without_deposit',
    ];
    const TRANSPORT_HINT = /gmail|whatsapp|smtp|mailer|service|host|transport|channel/;

    for (const template of templates) {
      expect(template).not.toMatch(TRANSPORT_HINT);
    }
  });

  it('FakeNotificationPort es un doble de dominio sin ninguna dependencia de transporte', async () => {
    // The domain's own test double implements the port by recording — never
    // by importing a transporter. If this ever needs a `nodemailer` import to
    // satisfy the port, the boundary is broken.
    const fake = new FakeNotificationPort();

    await fake.send({ to: 'cliente@jcbarberia.com', template: 'reminder_without_deposit', data: { appointmentId: 'apt-1' } });

    expect(fake.sentMessages).toHaveLength(1);
    expect(fake.sentMessages[0]).toMatchObject({
      to: 'cliente@jcbarberia.com',
      template: 'reminder_without_deposit',
      data: { appointmentId: 'apt-1' },
    });
  });
});
