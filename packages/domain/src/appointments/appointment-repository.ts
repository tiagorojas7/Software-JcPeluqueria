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

  /**
   * Every `reservado` appointment belonging to `barberId` whose `timeRange`
   * overlaps `range` — the detection query barber-absence-reassignment spec
   * names "Detección de turnos afectados". Scoped to exactly ONE barber's own
   * rows by construction (`WHERE barber_id = :barberId`), so a turno
   * belonging to a DIFFERENT barber can never come back here, even one
   * sitting in the exact same time window — the same requirement's "No
   * interferencia con otros turnos" is a structural guarantee of this query's
   * shape, not a filter applied after the fact.
   */
  findReservedByBarberInRange(barberId: string, range: TimeWindow): Promise<Appointment[]>;

  /**
   * Every appointment — any status, not only `reservado` — belonging to
   * `clientId`. Backs "Mi cuenta" (client-booking spec is silent on status
   * filtering; a cancelled or completed turno is still part of the client's
   * own history) and `ListOwnAppointmentsUseCase`. Scoped to exactly one
   * client by construction (`WHERE client_id = :clientId`), the same
   * structural-narrowing shape `findReservedByBarberInRange` already uses for
   * a barber — never a filter applied after a wider read.
   */
  /**
   * Los turnos del cliente — nunca sus holds sin confirmar.
   *
   * `slot_occupancies` guarda holds y turnos en la misma tabla, pero un
   * `held` NO es un `Appointment`: ni siquiera es uno de los estados que
   * `Appointment['status']` admite. Devolverlos hacía que el tipo mintiera,
   * y "Mi cuenta" terminaba mostrando 22 reservas abandonadas de 44 filas
   * con el estado crudo "HELD" en inglés. La exclusión vive en la consulta,
   * que es donde el contrato se puede sostener de verdad.
   */
  findByClientId(clientId: string): Promise<Appointment[]>;

  /**
   * Every STILL-`reservado` appointment belonging to `barberId` whose start
   * is at or after `from` — no upper bound, unlike
   * `findReservedByBarberInRange`. docs/HUECOS-BACKEND.md #6, "Apagar un día
   * en Horarios no apaga el día": deciding whether removing a recurring
   * weekly working day would orphan any already-booked turno needs every
   * future one, not a bounded window, because a barber_schedules day has no
   * end date of its own. Scoped to exactly one barber by construction, the
   * same structural-narrowing shape every other finder here uses.
   */
  findReservedByBarberFrom(barberId: string, from: Date): Promise<Appointment[]>;
}
