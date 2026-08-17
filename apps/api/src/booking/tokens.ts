/** DI tokens for this module's port dependencies — plain interfaces have no
 *  runtime representation, so Nest cannot resolve them by type alone (same
 *  reason every other module's tokens.ts exists). */
export const CLOCK = Symbol('CLOCK');
export const BARBER_REPOSITORY = Symbol('BARBER_REPOSITORY');
export const SERVICE_REPOSITORY = Symbol('SERVICE_REPOSITORY');
export const SCHEDULE_REPOSITORY = Symbol('SCHEDULE_REPOSITORY');
export const FREE_RANGES_QUERY = Symbol('FREE_RANGES_QUERY');
export const HOLD_REPOSITORY = Symbol('HOLD_REPOSITORY');
export const HOLD_EXPIRE_SCHEDULER = Symbol('HOLD_EXPIRE_SCHEDULER');
export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');
export const CLIENT_ACCOUNT_REPOSITORY = Symbol('CLIENT_ACCOUNT_REPOSITORY');
export const PAYMENT_PORT = Symbol('PAYMENT_PORT');
