/** DI tokens for this module's port dependencies — plain interfaces have no
 *  runtime representation, so Nest cannot resolve them by type alone (same
 *  reason agenda/tokens.ts and access-control/tokens.ts have their own). */
export const CLOCK = Symbol('CLOCK');
export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');
export const HOLD_REPOSITORY = Symbol('HOLD_REPOSITORY');
export const HOLD_EXPIRE_SCHEDULER = Symbol('HOLD_EXPIRE_SCHEDULER');
/** E.2 (cablear-el-mvp Slice E): `CreatePhoneAppointmentUseCase`'s own
 *  `ScheduleAppointmentReminder` producer — same one-token-per-module pattern
 *  as `HOLD_EXPIRE_SCHEDULER` above. */
export const APPOINTMENT_REMINDER_SCHEDULER = Symbol('APPOINTMENT_REMINDER_SCHEDULER');
/** Slice B (cablear-el-mvp): bound to its own token here rather than reused
 *  across modules — same one-token-per-module pattern every other module in
 *  this app already follows (see e.g. absence-reassignment/tokens.ts). */
export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');
export const ABSENCE_RECORD_REPOSITORY = Symbol('ABSENCE_RECORD_REPOSITORY');
export const PAYMENT_PORT = Symbol('PAYMENT_PORT');
export const WALK_IN_REPOSITORY = Symbol('WALK_IN_REPOSITORY');
/** `CreatePhoneAppointmentUseCase`'s own read-only lookup to derive a
 *  turno's end time from the selected service's `durationMinutes` — bound
 *  to its own token here rather than reused across modules, same
 *  one-token-per-module pattern as every other repository above. */
export const SERVICE_REPOSITORY = Symbol('SERVICE_REPOSITORY');
/** panel-usable: `EditAppointmentUseCase`'s own read-only lookup for the
 *  notification it fires on a successful edit (barber name for the email
 *  body) — its own token instance, same one-token-per-module pattern. */
export const BARBER_REPOSITORY = Symbol('BARBER_REPOSITORY');
/** panel-usable: where `EditAppointmentUseCase` writes the `appointment_updated`
 *  notification intent — never `NotificationPort` directly, the same
 *  transactional-outbox pattern `ProcessPaymentUseCase` already uses. */
export const NOTIFICATION_OUTBOX_REPOSITORY = Symbol('NOTIFICATION_OUTBOX_REPOSITORY');
