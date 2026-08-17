import type { Appointment } from '../appointment';
import type {
  AppointmentRepository,
  AppointmentScheduleChange,
} from '../appointment-repository';
import type { AppointmentStatus } from '../appointment-status';

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

  async findByBarberId(barberId: string, status?: 'reservado' | 'realizado' | 'cancelado'): Promise<Appointment[]> {
    return Array.from(this.byId.values()).filter(
      (a) => a.barberId === barberId && (!status || a.status === status),
    );
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
}
