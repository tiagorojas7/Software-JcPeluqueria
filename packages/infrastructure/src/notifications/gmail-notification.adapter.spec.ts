import type { Transporter } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import type { EmailTemplateRenderer } from './templates/types';
import { GmailNotificationAdapter } from './gmail-notification.adapter';

// 7.3 RED — the Gmail adapter is the ONLY notification channel implemented in
// the MVP (notification-port spec: "Adaptador de Gmail como único canal
// implementado en el MVP"). It owns the transport the domain never sees:
// `nodemailer` with `service: 'gmail'` and App-Password auth, rendering each
// intent via the injected `TemplateRegistry`. nodemailer is never hit in
// tests — a fake `createTransport` returns a recording transporter, and a fake
// registry returns fixed `{ subject, body }` so the adapter's only job
// (transport options + mapping onto `sendMail`) is what's asserted.

/** A `TemplateRegistry` stub with one fixed renderer per event type — the
 *  adapter is agnostic to the content; the templates slice (7.7/7.8) owns it. */
const stubRenderer =
  (subject: string, body: string): EmailTemplateRenderer =>
  () => ({ subject, body });
const stubRegistry = {
  staff_activation: stubRenderer('Activa tu cuenta', 'body-activation'),
  staff_password_reset: stubRenderer('Restablece tu clave', 'body-reset'),
  cancellation_with_refund: () => ({ subject: 'Se devolvio tu sena', body: 'body-cancel' }),
  reminder_with_deposit: () => ({ subject: 'Recordatorio', body: 'body-reminder-deposit' }),
  reminder_without_deposit: () => ({ subject: 'Recordatorio', body: 'body-reminder' }),
  absence_reassignment_offer: () => ({ subject: 'Horario alternativo', body: 'body-offer' }),
  client_access_code: () => ({ subject: 'Tu codigo de acceso', body: 'body-access-code' }),
} as const;

describe('GmailNotificationAdapter (7.3)', () => {
  it('crea el transporte con service gmail y App Password, nunca hardcodea la password', () => {
    const sendMail = vi.fn().mockResolvedValue('message-id-1');
    const createTransport = vi.fn<(options: unknown) => Transporter>().mockReturnValue({
      sendMail,
    } as unknown as Transporter);

    const adapter = new GmailNotificationAdapter(
      { user: 'jc@jcbarberia.com', appPassword: 'wafr-rble-1234' },
      { templates: stubRegistry, createTransport },
    );

    // The constructor wires gmail SMTP. The App Password is read from the
    // constructor (the composition root passes `process.env.GMAIL_APP_PASSWORD`),
    // never a module-level literal — and never a default.
    expect(adapter).toBeInstanceOf(GmailNotificationAdapter);
    expect(createTransport).toHaveBeenCalledOnce();
    const options = createTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.service).toBe('gmail');
    expect(options.auth).toEqual({ user: 'jc@jcbarberia.com', pass: 'wafr-rble-1234' });
  });

  it('mapea NotificationMessage -> sendMail { from, to, subject, text } via la plantilla', async () => {
    const sendMail = vi.fn().mockResolvedValue('message-id-1');
    const createTransport = vi.fn<(options: unknown) => Transporter>().mockReturnValue({
      sendMail,
    } as unknown as Transporter);
    const adapter = new GmailNotificationAdapter(
      { user: 'jc@jcbarberia.com', appPassword: 'pw' },
      { templates: stubRegistry, createTransport },
    );

    await adapter.send({
      to: 'cliente@jcbarberia.com',
      template: 'cancellation_with_refund',
      data: { refundId: 'rf-1', amountCents: '250000' },
    });

    expect(sendMail).toHaveBeenCalledOnce();
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.to).toBe('cliente@jcbarberia.com');
    // `from` defaults to the configured gmail user — the only sender the MVP uses.
    expect(mail.from).toBe('jc@jcbarberia.com');
    expect(mail.subject).toBe('Se devolvio tu sena');
    expect(mail.text).toBe('body-cancel');
  });

  it('rechaza la construccion sin App Password — no se inventa un canal sin credencial', () => {
    const createTransport = vi.fn<(options: unknown) => Transporter>();

    expect(() =>
      new GmailNotificationAdapter(
        { user: 'jc@jcbarberia.com', appPassword: '' },
        { templates: stubRegistry, createTransport },
      ),
    ).toThrow(/app.?password/i);
    // No SMTP transport is opened before the credential check fails.
    expect(createTransport).not.toHaveBeenCalled();
  });
});
