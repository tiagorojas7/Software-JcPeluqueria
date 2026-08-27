import { z } from 'zod';

import type { AccountAppointmentEchoResponse } from './account';

/**
 * barber-absence-reassignment spec, "Detección de turnos afectados": the
 * franja the barber is unavailable for. Time travels as `calendarDate` +
 * local `HH:mm`, same shape every other wire contract in this codebase
 * uses, so `Clock.localTimeToUtc` stays the only place a concrete instant
 * is built.
 */
export const MarkBarberAbsentRequestSchema = z.object({
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
});

export type MarkBarberAbsentRequest = z.infer<typeof MarkBarberAbsentRequestSchema>;

export interface MarkBarberAbsentResponse {
  /** Every `reservado` turno of this barber the marked franja affected —
   *  staff's immediate, actionable list even before any offer resolves. */
  readonly affectedAppointmentIds: readonly string[];
}

/**
 * C.6 (cablear-el-mvp Slice C): the client's own accept/reject routes,
 * reached from the offer notification — never a request body, same
 * "identity from the session, nothing else" idiom `account.ts` already
 * established for `SelfCancelAppointmentResponseBody`. Both routes take no
 * body at all: `:holdId` plus the session are everything either handler
 * needs.
 *
 * Mirrors `AcceptOfferResult`/`RejectOfferResult`
 * (`packages/application/src/absence-reassignment/`) exactly, adding only
 * the wire-safe representation of what does not survive JSON as-is:
 * `TimeWindow` travels as ISO `start`/`end` strings.
 */
export interface OfferAlternativeWindow {
  readonly start: string;
  readonly end: string;
}

export type AcceptOfferResponseBody =
  | { readonly outcome: 'reassigned' }
  | { readonly outcome: 'offer-expired' }
  | { readonly outcome: 'slot-taken'; readonly alternatives: readonly OfferAlternativeWindow[] };

export type RejectOfferResponseBody =
  | { readonly outcome: 'cancelled'; readonly appointment: AccountAppointmentEchoResponse }
  | { readonly outcome: 'not-cancellable' };
