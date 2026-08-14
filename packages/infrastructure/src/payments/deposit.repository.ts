import type {
  DepositRepository,
  LoadedDeposit,
  RecordSettledPaymentResult,
  ReleaseRejectedPaymentResult,
} from '@jc-barberia/domain';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { deposits } from '../db/schema/payments';
import { slotOccupancies } from '../db/schema/slot-occupancy';

/**
 * The idempotency guard lives entirely in `deposits.payment_id`'s `UNIQUE`
 * constraint: `onConflictDoNothing` makes a retried `payment_id` insert
 * zero rows, exactly the threat-matrix's "reintento del mismo payment_id →
 * cero filas afectadas". Only the winner of that insert ever reaches the
 * second statement — never a second `UPDATE` for a payment already settled.
 */
export class DrizzleDepositRepository implements DepositRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async recordSettledPayment(input: {
    holdId: string;
    paymentId: string;
    amountCents: number;
  }): Promise<RecordSettledPaymentResult> {
    const inserted = await this.db
      .insert(deposits)
      .values({ amountCents: input.amountCents, paymentId: input.paymentId, state: 'settled' })
      .onConflictDoNothing({ target: deposits.paymentId })
      .returning({ id: deposits.id });

    const insertedDeposit = inserted[0];
    if (!insertedDeposit) {
      return 'already-processed';
    }

    const updated = await this.db
      .update(slotOccupancies)
      .set({ status: 'reservado', depositId: insertedDeposit.id, paymentPending: false })
      .where(and(eq(slotOccupancies.id, input.holdId), eq(slotOccupancies.status, 'held')))
      .returning({ id: slotOccupancies.id });

    return updated.length > 0 ? 'confirmed' : 'hold-not-found';
  }

  // Terminal-failure release for the webhook worker
  // (design.md line 152): "Si MercadoPago responde `rejected` o
  // `cancelled`, se libera de inmediato sin esperar los 15 minutos."
  // Same atomic `UPDATE ... WHERE status='held' AND payment_pending =
  // true RETURNING` shape as `recordSettledPayment`'s confirmation —
  // zero rows means a retried webhook already released this hold (or the
  // row was never a `payment_pending` hold in the first place), both of
  // which are no-ops the caller treats as success, never an error.
  async releaseHoldOnRejectedPayment(holdId: string): Promise<ReleaseRejectedPaymentResult> {
    const released = await this.db
      .update(slotOccupancies)
      .set({ status: 'liberado', paymentPending: false })
      .where(
        and(
          eq(slotOccupancies.id, holdId),
          eq(slotOccupancies.status, 'held'),
          eq(slotOccupancies.paymentPending, true),
        ),
      )
      .returning({ id: slotOccupancies.id });
    return released.length > 0 ? 'released' : 'no-op';
  }

  // RED stubs for task 5.20 — real `findDepositForAppointment` (a join of
  // `slot_occupancies.deposit_id` → `deposits`) and `markRefunded` (atomic
  // `UPDATE deposits SET state='refunded' WHERE id AND state='settled'`)
  // land in 5.20 GREEN. Throwing keeps the unimplemented state loud so the
  // Testcontainers RED fails on "not implemented" while the package
  // continues to compile.
  async findDepositForAppointment(_appointmentId: string): Promise<LoadedDeposit | null> {
    throw new Error('DrizzleDepositRepository.findDepositForAppointment not implemented yet — task 5.20');
  }

  async markRefunded(_input: { depositId: string; refundId: string }): Promise<void> {
    throw new Error('DrizzleDepositRepository.markRefunded not implemented yet — task 5.20');
  }
}
