/**
 * What kind of message is being sent — determines which template the real
 * adapter renders (Phase 7). `staff_password_reset` is the only one this
 * slice exercises; `staff_activation` is declared now for the same reason
 * `AuthChallengePurpose` declares its full set upfront (see
 * `packages/domain/src/identity/auth-challenge.ts`) — a later phase wires
 * activation-link delivery through the same port without changing its shape.
 */
export type NotificationTemplate = 'staff_activation' | 'staff_password_reset';

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
