import type { TimeWindow } from '../availability';
import type { OccupancyChannel } from '../booking';
import type { AppointmentStatus } from './appointment-status';
import type { DepositState } from './deposit-state';

/**
 * The booked side of `slot_occupancies` — the same physical row `Hold`
 * describes before confirmation (design.md, "Una tabla slot_occupancies,
 * dos agregados de dominio"), now carrying its own five-state lifecycle and
 * deposit. Both channels that ever reach `reservado` (web, telefónico)
 * require an identified client before the turno exists — but a walk-in
 * (admin-operations spec, "Carga de walk-ins") may be an unidentified
 * customer, and it enters straight into `realizado` without ever passing
 * through `reservado` (appointment-lifecycle spec, "Los walk-ins ingresan
 * directamente como realizado"). `clientId` is nullable, matching
 * `WalkInOccupancy.clientId`, so that turno is a representable `Appointment`
 * instead of something `AppointmentRepository.findById` has to disguise as
 * "not found" (bug real de producción, turno a38c86ae: un walk-in sin
 * cliente identificado era visible en la mesa del día pero invisible para
 * marcarlo realizado o cancelarlo).
 */
export interface Appointment {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string | null;
  readonly channel: OccupancyChannel;
  readonly timeRange: TimeWindow;
  readonly status: AppointmentStatus;
  readonly deposit: DepositState;
}
