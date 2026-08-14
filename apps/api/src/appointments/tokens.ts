/** DI tokens for this module's port dependencies — plain interfaces have no
 *  runtime representation, so Nest cannot resolve them by type alone (same
 *  reason agenda/tokens.ts and access-control/tokens.ts have their own). */
export const CLOCK = Symbol('CLOCK');
export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');
export const HOLD_REPOSITORY = Symbol('HOLD_REPOSITORY');
