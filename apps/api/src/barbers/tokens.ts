/** DI token for the `BarberPerformanceRepository` port — a plain interface
 *  has no runtime representation, so Nest cannot resolve it by type alone. */
export const BARBER_PERFORMANCE_REPOSITORY = Symbol('BARBER_PERFORMANCE_REPOSITORY');

/** DI token for this module's `Clock` — mirrors `AppointmentsModule`'s own
 *  token, kept module-scoped rather than shared (same convention as
 *  `AgendaModule`'s `DAY_BOARD_REPOSITORY`). */
export const CLOCK = Symbol('CLOCK');
