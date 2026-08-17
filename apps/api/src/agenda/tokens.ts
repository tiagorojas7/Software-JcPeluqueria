/** DI token for the `DayBoardRepository` port — a plain interface has no
 *  runtime representation, so Nest cannot resolve it by type alone (same
 *  reason access-control/tokens.ts has its own tokens). */
export const DAY_BOARD_REPOSITORY = Symbol('DAY_BOARD_REPOSITORY');
