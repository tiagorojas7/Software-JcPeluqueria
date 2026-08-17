/** DI tokens for this module's port dependencies — plain interfaces have no
 *  runtime representation, so Nest cannot resolve them by type alone. One
 *  token per module, not reused across modules — same pattern
 *  `AppointmentsModule`/`AgendaModule` already established. */
export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');
export const BARBER_REPOSITORY = Symbol('BARBER_REPOSITORY');
export const SCHEDULE_REPOSITORY = Symbol('SCHEDULE_REPOSITORY');
export const SERVICE_REPOSITORY = Symbol('SERVICE_REPOSITORY');
