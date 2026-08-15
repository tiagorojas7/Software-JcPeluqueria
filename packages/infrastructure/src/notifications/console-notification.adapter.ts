import type { NotificationMessage, NotificationPort } from '@jc-barberia/domain';

/**
 * The MVP's alternative `NotificationPort` — not the production channel, but a
 * real adapter so the composition root (see `createNotificationPort`) can prove
 * swapping the channel is a configuration change, not a domain edit, and so a
 * local run never needs a Gmail App Password. It logs every send to stdout and
 * records what was sent — the records make the swap test observable without a
 * real transporter, the log makes local runs useful.
 *
 * notification-port spec: "Intercambiar el canal no toca el dominio" — this is
 * the second adapter that requirement asks the system to tolerate; WhatsApp is
 * the future one, this stands in for it now.
 */
export class ConsoleNotificationAdapter implements NotificationPort {
  readonly sentMessages: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.sentMessages.push(message);
    console.log(
      `[notifications] to=${message.to} template=${message.template} data=${JSON.stringify(message.data)}`,
    );
  }
}
