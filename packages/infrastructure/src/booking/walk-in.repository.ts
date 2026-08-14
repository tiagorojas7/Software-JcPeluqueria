import { SlotUnavailableError, type WalkInOccupancy, type WalkInRepository, type TimeWindow } from '@jc-barberia/domain';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { freeRanges, isExclusionViolation, toRangeLiteral } from '../db/occupancy-sql';
import { slotOccupancies } from '../db/schema/slot-occupancy';

/**
 * The walk-in write primitive (admin-operations spec, "Carga de walk-ins"):
 * one `INSERT` into `slot_occupancies` straight into `realizado`, protected by
 * the same `no_overlap_per_barber` EXCLUDE constraint every other occupancy
 * uses — `realizado` is an `OCCUPYING_STATUSES` value, so a second booking on
 * the same slot is rejected with `23P01`, which becomes `SlotUnavailableError`
 * here. That rejection is exactly how "el horario deja de figurar disponible
 * para reserva online" is enforced: once the walk-in lands, a would-be
 * overlapping hold or appointment cannot be created against the same barber.
 *
 * No `holdExpiresAt`, no `paymentPending`, no `deposit_id` — a walk-in is
 * `not_applicable` forever and never had a hold.
 */
export class DrizzleWalkInRepository implements WalkInRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async create(occupancy: WalkInOccupancy, searchWindow: TimeWindow): Promise<void> {
    try {
      await this.db.insert(slotOccupancies).values({
        id: occupancy.id,
        barberId: occupancy.barberId,
        serviceId: occupancy.serviceId,
        clientId: occupancy.clientId,
        channel: 'walk_in',
        status: 'realizado',
        timeRange: toRangeLiteral(occupancy.timeRange),
      });
    } catch (error) {
      if (!isExclusionViolation(error)) {
        throw error;
      }
      throw new SlotUnavailableError(await freeRanges(this.db, occupancy.barberId, searchWindow));
    }
  }
}
