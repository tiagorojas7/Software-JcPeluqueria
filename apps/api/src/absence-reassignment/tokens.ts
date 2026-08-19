/** DI tokens for this module's port dependencies — plain interfaces have no
 *  runtime representation, so Nest cannot resolve them by type alone (same
 *  reason every other module's tokens.ts exists). */
export const CLOCK = Symbol('CLOCK');
export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');
/**
 * E.1 (cablear-el-mvp Slice E): `GenerateAbsenceReassignmentOffers`'s own
 * ports, bound to their own token instances here rather than reused across
 * modules — same one-token-per-module pattern `BookingModule`/`AppointmentsModule`
 * already follow. `CreateHold` (reused unmodified) needs `HOLD_REPOSITORY` +
 * `HOLD_EXPIRE_SCHEDULER` too, and `AcceptOfferUseCase`/`RejectOfferUseCase`
 * (C.6) share `HOLD_REPOSITORY`/`PAYMENT_PORT` with it.
 */
export const BARBER_REPOSITORY = Symbol('BARBER_REPOSITORY');
export const SERVICE_REPOSITORY = Symbol('SERVICE_REPOSITORY');
export const SCHEDULE_REPOSITORY = Symbol('SCHEDULE_REPOSITORY');
export const FREE_RANGES_QUERY = Symbol('FREE_RANGES_QUERY');
export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');
export const HOLD_REPOSITORY = Symbol('HOLD_REPOSITORY');
export const HOLD_EXPIRE_SCHEDULER = Symbol('HOLD_EXPIRE_SCHEDULER');
export const NOTIFICATION_OUTBOX_REPOSITORY = Symbol('NOTIFICATION_OUTBOX_REPOSITORY');
export const PAYMENT_PORT = Symbol('PAYMENT_PORT');
