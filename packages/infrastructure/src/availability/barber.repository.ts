import type { Barber, BarberRepository } from '@jc-barberia/domain';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { barberSchedules, barbers, barberTimeOff } from '../db/schema/availability';
import { users } from '../db/schema/identity';
import { slotOccupancies } from '../db/schema/slot-occupancy';
import { deleteStaffAccountRows } from '../identity/staff-account.repository';

export class DrizzleBarberRepository implements BarberRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async create(barber: Barber): Promise<void> {
    await this.db.insert(barbers).values(barber);
  }

  async findById(id: string): Promise<Barber | null> {
    const rows = await this.db.select().from(barbers).where(eq(barbers.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async list(): Promise<Barber[]> {
    return this.db.select().from(barbers);
  }

  async deactivate(id: string): Promise<boolean> {
    const updated = await this.db
      .update(barbers)
      .set({ active: false })
      .where(eq(barbers.id, id))
      .returning({ id: barbers.id });
    return updated.length > 0;
  }

  async reactivate(id: string): Promise<boolean> {
    const updated = await this.db
      .update(barbers)
      .set({ active: true, permanentLeave: false })
      .where(eq(barbers.id, id))
      .returning({ id: barbers.id });
    return updated.length > 0;
  }

  async setPermanentLeave(id: string, permanentLeave: boolean): Promise<boolean> {
    const updated = await this.db
      .update(barbers)
      // `active: false` alongside `permanentLeave` in the SAME write: the
      // `barbers_active_permanent_leave_check` CHECK constraint (migration
      // 0013) forbids `active=true, permanentLeave=true`, so this is the
      // only combination that can ever be written once `permanentLeave` is
      // `true`.
      .set({ active: false, permanentLeave })
      .where(eq(barbers.id, id))
      .returning({ id: barbers.id });
    return updated.length > 0;
  }

  async hasAppointments(id: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: slotOccupancies.id })
      .from(slotOccupancies)
      .where(eq(slotOccupancies.barberId, id))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * ONE transaction, statements in the exact order the port promises: the
   * staff account first (reusing `deleteStaffAccountRows`, the same logic
   * `DrizzleStaffAccountRepository.deleteAccount` runs — never duplicated),
   * then `barber_time_off`, then `barber_schedules`, then the `barbers` row
   * itself. The appointments check runs INSIDE this same transaction,
   * immediately before any of those deletes, so a turno booked between the
   * panel showing "Eliminar" and the owner clicking it can never slip a
   * barber with real history through — the refusal and the deletes share
   * one atomic read-then-write, not two separate round trips.
   */
  async delete(id: string): Promise<'deleted' | 'not-found' | 'has-appointments'> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.select({ id: barbers.id }).from(barbers).where(eq(barbers.id, id)).limit(1);
      if (existing.length === 0) {
        return 'not-found';
      }

      const appointments = await tx
        .select({ id: slotOccupancies.id })
        .from(slotOccupancies)
        .where(eq(slotOccupancies.barberId, id))
        .limit(1);
      if (appointments.length > 0) {
        return 'has-appointments';
      }

      const account = await tx.select({ id: users.id }).from(users).where(eq(users.barberId, id)).limit(1);
      const accountRow = account[0];
      if (accountRow) {
        await deleteStaffAccountRows(tx, accountRow.id);
      }

      await tx.delete(barberTimeOff).where(eq(barberTimeOff.barberId, id));
      await tx.delete(barberSchedules).where(eq(barberSchedules.barberId, id));
      await tx.delete(barbers).where(eq(barbers.id, id));
      return 'deleted';
    });
  }
}
