import type { TimeWindow } from '../availability';
import { SlotUnavailableError } from './hold';

/**
 * The inputs to a walk-in occupancy: a barber, a service and a time range,
 * occupied directly as `realizado`. `clientId` is nullable because a walk-in
 * — unlike a phone or web booking — never passes through `reservado` and the
 * admin-operations spec only requires "servicio y barbero"; a walk-in may be
 * an unidentified walk-in customer (appointment-lifecycle spec, "Los walk-ins
 * ingresan directamente como realizado").
 */
export interface WalkInOccupancy {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string | null;
  readonly timeRange: TimeWindow;
}

/**
 * The third write path into `slot_occupancies`, alongside `HoldRepository`
 * (held) and `AppointmentRepository` (reservado/sin_registrado mutations). A
 * walk-in inserts a row straight into `realizado`, so it never goes through
 * `reservado` and is never touched by the nightly sweep. The same
 * `no_overlap_per_barber` EXCLUDE constraint protects this insert — `realizado`
 * is an `OCCUPYING_STATUSES` value — so a conflicting range throws
 * `SlotUnavailableError`, which is exactly how "el horario deja de figurar
 * disponible" is enforced for a would-be second booking on the same slot.
 */
export interface WalkInRepository {
  create(occupancy: WalkInOccupancy, searchWindow: TimeWindow): Promise<void>;
}

export { SlotUnavailableError };
