/** DI tokens for this module's port dependencies — plain interfaces have no
 *  runtime representation, so Nest cannot resolve them by type alone. One
 *  token per module, not reused across modules — same pattern
 *  `AppointmentsModule`/`AgendaModule` already established. */
export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');
export const BARBER_REPOSITORY = Symbol('BARBER_REPOSITORY');
export const SCHEDULE_REPOSITORY = Symbol('SCHEDULE_REPOSITORY');
export const SERVICE_REPOSITORY = Symbol('SERVICE_REPOSITORY');

/** DI token for the `StaffAccountRepository` port — the `users` rows behind
 *  the owner's "Cuentas de barberos" screen. Its own instance, never shared
 *  with `IdentityModule`'s tokens, per the one-token-per-module rule. */
export const STAFF_ACCOUNT_REPOSITORY = Symbol('STAFF_ACCOUNT_REPOSITORY');

/** DI token for the `AuthChallengeRepository` port. The invite this module
 *  sends is the same single-use challenge primitive client login uses; only
 *  the `purpose` differs (`staff_activation`). */
export const AUTH_CHALLENGE_REPOSITORY = Symbol('PANEL_AUTH_CHALLENGE_REPOSITORY');

/** DI token for the `NotificationOutboxRepository` port — where the
 *  activation invite is enqueued, never delivered inline. */
export const NOTIFICATION_OUTBOX_REPOSITORY = Symbol('PANEL_NOTIFICATION_OUTBOX_REPOSITORY');

/** DI token for the `Clock` port (`ChallengeService` computes the invite's
 *  expiry through it, and `configureBarberWeek` uses it to decide which
 *  future turnos an about-to-be-removed day would orphan). */
export const CLOCK = Symbol('PANEL_CLOCK');

/** DI token for the `AppointmentRepository` port — `configureBarberWeek`'s
 *  orphan-turno check (docs/HUECOS-BACKEND.md #6). Its own instance, never
 *  shared with `AppointmentsModule`'s token, per the one-token-per-module
 *  rule. */
export const APPOINTMENT_REPOSITORY = Symbol('PANEL_APPOINTMENT_REPOSITORY');
