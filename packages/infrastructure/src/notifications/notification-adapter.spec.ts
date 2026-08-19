import type { Transporter } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import type { EmailTemplateRenderer } from './templates/types';
import { ConsoleNotificationAdapter } from './console-notification.adapter';
import { GmailNotificationAdapter } from './gmail-notification.adapter';
import { createNotificationPort } from './notification-adapter';

// 7.5 RED — "sustituir el adaptador por uno alternativo no requiere cambios
// en el dominio." The composition root (THIS factory) is the ONLY module that
// knows which concrete adapter to wire: switching the channel is a config
// change to `NotificationChannelConfig.channel`, never a domain/use-case edit.
// The use cases keep depending on the `NotificationPort` TYPE (the token) and
// receive whatever this hands them.

const stubRenderer =
  (subject: string, body: string): EmailTemplateRenderer =>
  () => ({ subject, body });
const stubRegistry = {
  staff_activation: stubRenderer('Activa tu cuenta', 'body-activation'),
  staff_password_reset: stubRenderer('Restablece tu clave', 'body-reset'),
  cancellation_with_refund: () => ({ subject: 'Se devolvio tu sena', body: 'body-cancel' }),
  reminder_with_deposit: () => ({ subject: 'Recordatorio', body: 'body-deposit' }),
  reminder_without_deposit: () => ({ subject: 'Recordatorio', body: 'body-no-deposit' }),
  // Phase 12 added this template to the registry's type. The stub has to keep
  // covering EVERY member: the adapter is agnostic to content, but a registry
  // missing a case would let an unrenderable notification reach production.
  absence_reassignment_offer: () => ({ subject: 'Tu barbero no esta disponible', body: 'body-offer' }),
  client_access_code: () => ({ subject: 'Tu codigo de acceso', body: 'body-access-code' }),
  booking_confirmed: () => ({ subject: 'Turno confirmado', body: 'body-booking-confirmed' }),
} as const;

describe('createNotificationPort (7.5/7.6 — intercambio de canal)', () => {
  it('channel console devuelve ConsoleNotificationAdapter y despacha por ahi', async () => {
    // An alternative adapter — the "WhatsApp tomorrow" stand-in. No Gmail
    // transport is constructed; nothing in the domain knew this channel existed.
    const port = createNotificationPort({ channel: 'console' }, { templates: stubRegistry });

    expect(port).toBeInstanceOf(ConsoleNotificationAdapter);
    await port.send({ to: 'cliente@jcbarberia.com', template: 'reminder_without_deposit', data: { appointmentId: 'apt-1' } });
    expect(port).toBeInstanceOf(ConsoleNotificationAdapter);
    const sent = (port as ConsoleNotificationAdapter).sentMessages;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'cliente@jcbarberia.com', template: 'reminder_without_deposit' });
  });

  it('channel gmail devuelve GmailNotificationAdapter con service gmail y el createTransport inyectado', () => {
    const createTransport = vi.fn<(o: unknown) => Transporter>().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue('id'),
    } as unknown as Transporter);

    const port = createNotificationPort(
      { channel: 'gmail', gmailUser: 'jc@jcbarberia.com', gmailAppPassword: 'pw-app' },
      { templates: stubRegistry, createTransport },
    );

    expect(port).toBeInstanceOf(GmailNotificationAdapter);
    expect(createTransport).toHaveBeenCalledOnce();
    const options = createTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.service).toBe('gmail');
    expect(options.auth).toEqual({ user: 'jc@jcbarberia.com', pass: 'pw-app' });
  });
});
