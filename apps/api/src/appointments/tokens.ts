/** DI tokens for this module's port dependencies — plain interfaces have no
 *  runtime representation, so Nest cannot resolve them by type alone (same
 *  reason agenda/tokens.ts and access-control/tokens.ts have their own). */
export const CLOCK = Symbol('CLOCK');
export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');
export const HOLD_REPOSITORY = Symbol('HOLD_REPOSITORY');
export const HOLD_EXPIRE_SCHEDULER = Symbol('HOLD_EXPIRE_SCHEDULER');
/** Slice B (cablear-el-mvp): bound to its own token here rather than reused
 *  across modules — same one-token-per-module pattern every other module in
 *  this app already follows (see e.g. absence-reassignment/tokens.ts). */
export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');
export const ABSENCE_RECORD_REPOSITORY = Symbol('ABSENCE_RECORD_REPOSITORY');
export const PAYMENT_PORT = Symbol('PAYMENT_PORT');
export const WALK_IN_REPOSITORY = Symbol('WALK_IN_REPOSITORY');
