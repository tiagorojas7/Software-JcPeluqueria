import {
  SlotUnavailableError,
  type Appointment,
  type AppointmentRepository,
  type AppointmentScheduleChange,
  type AppointmentStatus,
  type OccupancyChannel,
  type TimeWindow,
} from '@jc-barberia/domain';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { freeRanges, isExclusionViolation, toRangeLiteral } from '../db/occupancy-sql';
import { slotOccupancies } from '../db/schema/slot-occupancy';

/**
 * The booked half of `slot_occupancies` (`HoldRepository` owns the `held`
 * half — design.md, "una tabla, dos agregados"). First real consumer is
 * Phase 10 (admin-operations: editing/cancelling "cualquier turno").
 */
export class DrizzleAppointmentRepository implements AppointmentRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findById(id: string): Promise<Appointment | null> {
    const rows = await this.db
      .select({
        id: slotOccupancies.id,
        barberId: slotOccupancies.barberId,
        serviceId: slotOccupancies.serviceId,
        clientId: slotOccupancies.clientId,
        channel: slotOccupancies.channel,
        status: slotOccupancies.status,
        depositId: slotOccupancies.depositId,
        start: sql`lower(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        end: sql`upper(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
      })
      .from(slotOccupancies)
      .where(eq(slotOccupancies.id, id))
      .limit(1);
    const row = rows[0];
    if (!row || row.clientId === null) {
      return null;
    }
    if (row.depositId !== null) {
      // The `deposits` table (Phase 5) is what would let this branch
      // reconstruct `settled`/`refunded`/etc — until it merges, a non-null
      // `deposit_id` here is unreachable data, not a case to guess at.
      throw new Error(
        `Appointment "${id}" carries a deposit_id but the deposits table is not wired yet`,
      );
    }
    return {
      id: row.id,
      barberId: row.barberId,
      serviceId: row.serviceId,
      clientId: row.clientId,
      channel: row.channel as OccupancyChannel,
      timeRange: { start: row.start, end: row.end },
      status: row.status as AppointmentStatus,
      deposit: { kind: 'not_applicable' },
    };
  }

  async updateSchedule(
    id: string,
    change: AppointmentScheduleChange,
    searchWindow: TimeWindow,
  ): Promise<void> {
    try {
      await this.db
        .update(slotOccupancies)
        .set({
          barberId: change.barberId,
          serviceId: change.serviceId,
          timeRange: toRangeLiteral(change.timeRange),
        })
        .where(eq(slotOccupancies.id, id));
    } catch (error) {
      if (!isExclusionViolation(error)) {
        throw error;
      }
      throw new SlotUnavailableError(await freeRanges(this.db, change.barberId, searchWindow));
    }
  }

  async updateStatus(id: string, status: AppointmentStatus): Promise<void> {
    await this.db.update(slotOccupancies).set({ status }).where(eq(slotOccupancies.id, id));
  }
}
