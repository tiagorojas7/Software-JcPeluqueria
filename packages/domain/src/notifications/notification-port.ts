/**
 * What kind of message is being sent — determines which template the real
 * adapter renders (Phase 7). `staff_password_reset` is the only one its
 * slice exercises; `staff_activation` is declared for the same reason
 * `AuthChallengePurpose` declares its full set upfront (see
 * `packages/domain/src/identity/auth-challenge.ts`) — a later phase wires
 * activation-link delivery through the same port without changing its shape.
 *
 * `cancellation_with_refund` lands in Phase 6: the `hold.expire` handler
 * (`ExpireHold`) fires it when an absence-offer hold lapses and the origin
 * seña was refunded ("Hold vencido con cobro asociado"). Phase 7 owns the
 * rendered content (template) and the outbox-backed delivery; here only the
 * intent is expressed so the port is transport-agnostic.
 *
 * `reminder_with_deposit` / `reminder_without_deposit` land in Phase 6 too:
 * the `appointment.reminder` handler fires one of them 2 hours before the
 * turno (notification-port spec, "Eventos mínimos que deben notificarse"),
 * picking the variant by whether the turno carries a settled seña. The seña
 * branch exists so Phase 7's template can render the "última oportunidad"
 * deadline for the con-seña row and omit it for the sin-seña one; here the
 * handler only records the event in `notification_outbox`.
 *
 * `absence_reassignment_offer` lands in Phase 12: `GenerateAbsenceReassignmentOffers`
 * fires it once per affected turno right after it claims the same-day
 * replacement hold (barber-absence-reassignment spec, "Ofertas del mismo
 * día, de cualquier barbero" — "MUST notificar al cliente por el canal de
 * notificación configurado").
 *
 * `booking_confirmed` lands in cablear-el-mvp (item 1, "no booking-confirmation
 * notification at all"): `ProcessPaymentUseCase` fires it on the FIRST
 * `'confirmed'` outcome — the exact same branch, for the exact same reason,
 * that schedules the 2h reminder — never on a retried webhook's
 * `'already-processed'` outcome. It is the ONLY message a client who paid
 * online ever receives before the reminder, so it carries what a real person
 * needs: which barber, which service, the shop-local time, and that the rest
 * of the price is paid at the shop.
 */
export type NotificationTemplate =
  | 'staff_activation'
  | 'staff_password_reset'
  | 'cancellation_with_refund'
  | 'reminder_with_deposit'
  | 'reminder_without_deposit'
  | 'absence_reassignment_offer'
  // The client's own passwordless access code (client-booking: access happens
  // through a one-time code or link). Distinct from the two staff templates:
  // staff have passwords, clients never do.
  | 'client_access_code'
  | 'booking_confirmed';

/**
 * A dispatch intention — deliberately transport-agnostic. `data` carries
 * only whatever the template needs (e.g. a reset token and its expiry), never
 * a password or password hash: nothing that ever reaches this port can leak
 * a credential, because no credential is ever put into it in the first
 * place.
 */
export interface NotificationMessage {
  readonly to: string;
  readonly template: NotificationTemplate;
  readonly data: Readonly<Record<string, string>>;
}

/**
 * The only way domain/application code sends a notification. Phase 7 owns
 * the real adapter (`GmailNotificationAdapter`) and the outbox-backed
 * delivery pattern design.md describes; this slice only needs the port
 * itself and a fake, so `ResetPasswordUseCase` can dispatch without knowing
 * — or this codebase yet having — any transport.
 */
export interface NotificationPort {
  send(message: NotificationMessage): Promise<void>;
}
