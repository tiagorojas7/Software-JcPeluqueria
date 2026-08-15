import type { Transporter } from 'nodemailer';
import { createTransport as realCreateTransport, type TransportOptions } from 'nodemailer';
import type { NotificationPort } from '@jc-barberia/domain';

import { ConsoleNotificationAdapter } from './console-notification.adapter';
import { GmailNotificationAdapter } from './gmail-notification.adapter';
import type { TemplateRegistry } from './templates/types';

/**
 * The composition root that turns "which channel?" into a `NotificationPort`
 * (notification-port spec: "Intercambiar el canal no toca el dominio"). Use
 * cases receive the port TYPE (the token) — never the adapter — so the only
 * module that knows Gmail exists is THIS factory and `GmailNotificationAdapter`
 * itself. Adding a channel (WhatsApp tomorrow) means a new adapter class + a
 * new branch here; no use case, handler or domain file changes.
 *
 * `channel: 'console'` needs no credential — local runs and the swap test use
 * it. `channel: 'gmail'` reads the App Password from the passed config; the
 * real `nodemailer.createTransport` is only used when the caller does NOT
 * inject a fake (tests inject one; the worker root does not).
 */
export type NotificationChannel = 'gmail' | 'console';

export interface NotificationChannelConfig {
  readonly channel: NotificationChannel;
  readonly gmailUser?: string;
  readonly gmailAppPassword?: string;
  readonly gmailFrom?: string;
}

export interface NotificationChannelDeps {
  readonly templates: TemplateRegistry;
  readonly createTransport?: (options: unknown) => Transporter;
}

export function createNotificationPort(
  config: NotificationChannelConfig,
  deps: NotificationChannelDeps,
): NotificationPort {
  if (config.channel === 'console') {
    return new ConsoleNotificationAdapter();
  }
  if (config.channel === 'gmail') {
    const createTransport = deps.createTransport ?? ((o: unknown) => realCreateTransport(o as TransportOptions));
    return new GmailNotificationAdapter(
      { user: config.gmailUser ?? '', appPassword: config.gmailAppPassword ?? '', from: config.gmailFrom },
      { templates: deps.templates, createTransport },
    );
  }
  // Exhaustiveness guard: a new `NotificationChannel` must add a branch above,
  // never fall through to a default adapter that would silently misroute.
  const _exhaustive: never = config.channel;
  throw new Error(`Unknown notification channel: ${String(_exhaustive)}`);
}
