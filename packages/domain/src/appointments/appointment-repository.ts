import type { TimeWindow } from '../availability';
import type { Appointment } from './appointment';
import type { AppointmentStatus } from './appointment-status';

export class AppointmentNotFoundError extends Error {
  constructor(readonly appointmentId: string) {
    super(`No appointment found with id "${appointmentId}"`);
    this.name = 'AppointmentNotFoundError';
  }
}

export interface AppointmentScheduleChange {
  readonly barberId: string;
  readonly serviceId: string;
  readonly timeRange: TimeWindow;
}

/**
 * Persistence for the booked side of `slot_occupancies` — first real
 * consumer is Phase 10 (admin-operations: editing and administrative
 * cancellation of "cualquier turno"). Reuses the same physical table
 * `HoldRepository` writes to (design.md, "una tabla, dos agregados"), but
 * these methods operate on rows already in `reservado`/`sin_registrado`,
 * never on the `held` transient state — that half stays `HoldRepository`'s.
 */
export interface AppointmentRepository {
  findById(id: string): Promise<Appointment | null>;

  /**
   * Moves the appointment to a different barber/service/time. Protected by
   * the same `no_overlap_per_barber` EXCLUDE constraint as `HoldRepository`
   * — a conflicting target range throws `SlotUnavailableError`, never
   * silently overwrites someone else's booking.
   */
  updateSchedule(id: string, change: AppointmentScheduleChange, searchWindow: TimeWindow): Promise<void>;

  /** Persists only the `status` column — the deposit's own persistence
   *  arrives with the `deposits` table (Phase 5); until then a refund/loss
   *  is proven through `PaymentPort` and the returned in-memory `Appointment`,
   *  not through this column. */
  updateStatus(id: string, status: AppointmentStatus): Promise<void>;
}
