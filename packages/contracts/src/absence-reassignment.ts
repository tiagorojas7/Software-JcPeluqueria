import { z } from 'zod';

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
