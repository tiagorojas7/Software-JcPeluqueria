import type { TimeWindow } from '../../availability';
import type { Appointment } from '../appointment';
import type {
  AppointmentRepository,
  AppointmentScheduleChange,
} from '../appointment-repository';
import type { AppointmentStatus } from '../appointment-status';

/** `[a, b)` overlaps `[c, d)` iff `a < d && c < b` — the same half-open
 *  interval semantics `no_overlap_per_barber` (migration 0003) enforces in
 *  PostgreSQL, mirrored here so this fake's scoping matches the real EXCLUDE
 *  constraint's without needing a database. */
function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * In-memory `AppointmentRepository` test double. Real conflict detection
 * only exists against PostgreSQL's `EXCLUDE` constraint (see
 * `DrizzleAppointmentRepository`'s Testcontainers suite); this fake never
 * rejects a schedule change, it only records/applies what it was asked so a
 * use case's orchestration can be asserted on without a database.
 */
export class FakeAppointmentRepository implements AppointmentRepository {
  private readonly byId = new Map<string, Appointment>();
  readonly updateScheduleCalls: Array<{ id: string; change: AppointmentScheduleChange }> = [];
  readonly updateStatusCalls: Array<{ id: string; status: AppointmentStatus }> = [];

  seed(appointment: Appointment): void {
    this.byId.set(appointment.id, appointment);
  }

  async findById(id: string): Promise<Appointment | null> {
    return this.byId.get(id) ?? null;
  }

  async updateSchedule(id: string, change: AppointmentScheduleChange): Promise<void> {
    this.updateScheduleCalls.push({ id, change });
    const existing = this.byId.get(id);
    if (existing) {
      this.byId.set(id, { ...existing, ...change });
    }
  }

  async updateStatus(id: string, status: AppointmentStatus): Promise<void> {
    this.updateStatusCalls.push({ id, status });
    const existing = this.byId.get(id);
    if (existing) {
      this.byId.set(id, { ...existing, status });
    }
  }

  async findReservedByBarberInRange(barberId: string, range: TimeWindow): Promise<Appointment[]> {
    return [...this.byId.values()].filter(
      (appointment) =>
        appointment.barberId === barberId &&
        appointment.status === 'reservado' &&
        overlaps(appointment.timeRange, range),
    );
  }

  async findByClientId(clientId: string): Promise<Appointment[]> {
    return [...this.byId.values()].filter((appointment) => appointment.clientId === clientId);
  }
}
