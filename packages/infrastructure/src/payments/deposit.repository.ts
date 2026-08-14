import type {
  DepositRepository,
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

  // RED stub for task 5.16 — real atomic `UPDATE ... WHERE status='held'
  // AND payment_pending = true RETURNING id` lands in 5.16 GREEN. Throwing
  // (not silently returning) keeps the unimplemented state loud so the
  // Testcontainers RED fails for the right reason while the package still
  // compiles.
  async releaseHoldOnRejectedPayment(_holdId: string): Promise<ReleaseRejectedPaymentResult> {
    throw new Error('DrizzleDepositRepository.releaseHoldOnRejectedPayment not implemented yet — task 5.16');
  }
}
