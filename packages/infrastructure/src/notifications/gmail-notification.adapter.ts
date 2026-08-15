import type { Transporter } from 'nodemailer';
import type { NotificationMessage, NotificationPort } from '@jc-barberia/domain';

import type { TemplateRegistry } from './templates/types';

/**
 * The MVP's only `NotificationPort` adapter (notification-port spec: "Adaptador
 * de Gmail como único canal implementado en el MVP"). It owns the ONE thing the
 * domain must never know: that the channel is SMTP over Gmail with an App
 * Password. The composition root passes `process.env.GMAIL_APP_PASSWORD` (and
 * the gmail `user`) into the constructor — the password is never a module-level
 * literal and never has a default, so a deployment that forgot the env var
 * fails loudly at wiring instead of silently sending through some other account.
 *
 * `createTransport` is injected (not `import nodemailer` at call time) so the
 * adapter is testable without a real SMTP endpoint and without monkey-patching
 * the nodemailer module: a fake factory returns a recording transporter. The
 * real root wires `(o) => nodemailer.createTransport(o)`.
 */
export interface GmailAdapterConfig {
  /** The Gmail address SMTP authenticates with; also the default `from`. */
  readonly user: string;
  /** Gmail App Password. MUST come from `process.env.GMAIL_APP_PASSWORD`. */
  readonly appPassword: string;
  /** Overrides the `from` address (defaults to `user`). */
  readonly from?: string;
}

export interface GmailAdapterDeps {
  /** Maps each `NotificationTemplate` to its renderer — the template slice
   *  (7.7/7.8) owns the contents; the adapter is agnostic to them. */
  readonly templates: TemplateRegistry;
  /** `nodemailer.createTransport`, injected so tests never touch SMTP. */
  readonly createTransport: (options: unknown) => Transporter;
}

export class GmailNotificationAdapter implements NotificationPort {
  private readonly from: string;
  private readonly transport: Transporter;
  private readonly templates: TemplateRegistry;

  constructor(config: GmailAdapterConfig, deps: GmailAdapterDeps) {
    if (!config.appPassword) {
      throw new Error('GmailNotificationAdapter: appPassword is required (set GMAIL_APP_PASSWORD)');
    }
    this.from = config.from ?? config.user;
    this.templates = deps.templates;
    this.transport = deps.createTransport({
      service: 'gmail',
      auth: { user: config.user, pass: config.appPassword },
    });
  }

  async send(message: NotificationMessage): Promise<void> {
    const rendered = this.templates[message.template](message.data);
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: rendered.subject,
      text: rendered.body,
    });
  }
}
