import type { TimeWindow } from '../availability';
import type { OccupancyChannel } from '../booking';
import type { AppointmentStatus } from './appointment-status';
import type { DepositState } from './deposit-state';

/**
 * The booked side of `slot_occupancies` — the same physical row `Hold`
 * describes before confirmation (design.md, "Una tabla slot_occupancies,
 * dos agregados de dominio"), now carrying its own five-state lifecycle and
 * deposit. Unlike `Hold.clientId`, `clientId` here is never null: both
 * channels that ever reach `reservado` (web, telefónico) require an
 * identified client before the turno exists. Only a walk-in skips that, and
 * a walk-in never passes through `reservado` at all (appointment-lifecycle
 * spec, "Los walk-ins ingresan directamente como realizado" — out of this
 * phase's scope, see tasks.md Phase 10).
 */
export interface Appointment {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string;
  readonly channel: OccupancyChannel;
  readonly timeRange: TimeWindow;
  readonly status: AppointmentStatus;
  readonly deposit: DepositState;
}
