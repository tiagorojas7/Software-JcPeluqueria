/** DI tokens for this module's port dependencies — plain interfaces have no
 *  runtime representation, so Nest cannot resolve them by type alone (same
 *  reason every other module's tokens.ts exists). */
export const CLOCK = Symbol('CLOCK');
export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');
