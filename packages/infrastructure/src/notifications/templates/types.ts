import type { NotificationMessage, NotificationTemplate } from '@jc-barberia/domain';

/**
 * The only shape a rendered notification takes BEFORE a transport carries it:
 * a `subject` and a `body`. Phase 7's Gmail adapter puts both onto a single
 * `sendMail` (`text` = `body`); a future WhatsApp adapter would collapse them
 * into one message, and a future SMS adapter would keep only `body`. The
 * registry never knows — every renderer returns the same two strings.
 */
export interface RenderedEmail {
  readonly subject: string;
  readonly body: string;
}

/**
 * One template's contract: the outbox `payload` (the same `Record<string,
 * string>` the `notification_outbox` writer stored, design.md "Outbox
 * transaccional") in, a `RenderedEmail` out. No clock, no transport, no
 * credential — whatever a template needs beyond the payload is closed over by
 * its factory (see `reminder-with-deposit.template.ts`, which takes a `Clock`
 * to compute the "última oportunidad" cutoff).
 */
export type EmailTemplateRenderer = (payload: Readonly<Record<string, string>>) => RenderedEmail;

/**
 * A complete, exhaustive map of every `NotificationTemplate` to its renderer.
 * The Gmail adapter indexes this by `NotificationMessage.template` and calls
 * the matching renderer with `data`; `Record` over the union is exhaustive, so
 * adding a template type forces adding a renderer here (the compiler won't let
 * a new event type ship without a template).
 */
export type TemplateRegistry = Readonly<Record<NotificationTemplate, EmailTemplateRenderer>>;

export type { NotificationMessage, NotificationTemplate };
