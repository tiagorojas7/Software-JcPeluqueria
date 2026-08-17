import {
  SlotUnavailableError,
  type Appointment,
  type AppointmentRepository,
  type AppointmentScheduleChange,
  type AppointmentStatus,
  type DepositState,
  type OccupancyChannel,
  type TimeWindow,
} from '@jc-barberia/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { freeRanges, isExclusionViolation, toRangeLiteral } from '../db/occupancy-sql';
import { deposits } from '../db/schema/payments';
import { slotOccupancies } from '../db/schema/slot-occupancy';

/**
 * Reconstructs `DepositState` from the LEFT JOIN row shape both `findById`
 * and `findReservedByBarberInRange` share — mirrors
 * `DrizzleDepositRepository.findDepositForAppointment`'s exact switch (Phase
 * 5) so this repository never re-derives its own, possibly-diverging
 * version of the same reconstruction rule. `depositId === null` is the
 * `not_applicable` case (phone/walk-in, or a web row still `held`/`liberado`)
 * — the LEFT JOIN found nothing to join, not an error.
 */
function toDepositState(row: {
  readonly depositId: string | null;
  readonly depositState: string | null;
  readonly paymentId: string | null;
  readonly amountCents: number | null;
}): DepositState {
  if (row.depositId === null) {
    return { kind: 'not_applicable' };
  }
  if (row.depositState === 'settled') {
    return { kind: 'settled', paymentId: row.paymentId!, amountCents: row.amountCents! };
  }
  if (row.depositState === 'refunded') {
    // `deposits` does not persist the gateway refund id (design.md row 457) —
    // same documented gap `DrizzleDepositRepository` already carries.
    return { kind: 'refunded', refundId: '', amountCents: row.amountCents! };
  }
  if (row.depositState === 'forfeited') {
    return { kind: 'forfeited', amountCents: row.amountCents! };
  }
  throw new Error(`DrizzleAppointmentRepository: deposit ${row.depositId} in unexpected state "${row.depositState}"`);
}

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
        start: sql`lower(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        end: sql`upper(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        depositId: deposits.id,
        depositState: deposits.state,
        paymentId: deposits.paymentId,
        amountCents: deposits.amountCents,
      })
      .from(slotOccupancies)
      .leftJoin(deposits, eq(slotOccupancies.depositId, deposits.id))
      .where(eq(slotOccupancies.id, id))
      .limit(1);
    const row = rows[0];
    if (!row || row.clientId === null) {
      return null;
    }
    return {
      id: row.id,
      barberId: row.barberId,
      serviceId: row.serviceId,
      clientId: row.clientId,
      channel: row.channel as OccupancyChannel,
      timeRange: { start: row.start, end: row.end },
      status: row.status as AppointmentStatus,
      deposit: toDepositState(row),
    };
  }

  /**
   * barber-absence-reassignment spec, "Detección de turnos afectados". The
   * `WHERE barber_id = :barberId` predicate is what makes "No interferencia
   * con otros turnos" structural rather than a filter applied after reading:
   * a turno belonging to a different barber is never selected, even one
   * sitting in the exact same `time_range`.
   */
  async findReservedByBarberInRange(barberId: string, range: TimeWindow): Promise<Appointment[]> {
    const rows = await this.db
      .select({
        id: slotOccupancies.id,
        barberId: slotOccupancies.barberId,
        serviceId: slotOccupancies.serviceId,
        clientId: slotOccupancies.clientId,
        channel: slotOccupancies.channel,
        status: slotOccupancies.status,
        start: sql`lower(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        end: sql`upper(${slotOccupancies.timeRange})`.mapWith(slotOccupancies.holdExpiresAt),
        depositId: deposits.id,
        depositState: deposits.state,
        paymentId: deposits.paymentId,
        amountCents: deposits.amountCents,
      })
      .from(slotOccupancies)
      .leftJoin(deposits, eq(slotOccupancies.depositId, deposits.id))
      .where(
        and(
          eq(slotOccupancies.barberId, barberId),
          eq(slotOccupancies.status, 'reservado'),
          sql`${slotOccupancies.timeRange} && ${toRangeLiteral(range)}::tstzrange`,
        ),
      );

    return rows
      .filter((row) => row.clientId !== null)
      .map((row) => ({
        id: row.id,
        barberId: row.barberId,
        serviceId: row.serviceId,
        clientId: row.clientId as string,
        channel: row.channel as OccupancyChannel,
        timeRange: { start: row.start, end: row.end },
        status: row.status as AppointmentStatus,
        deposit: toDepositState(row),
      }));
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
