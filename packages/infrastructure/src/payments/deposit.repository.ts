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

  // The refund side of the slot-hold / client-booking flow
  // (slot-booking: "Hold vencido con cobro asociado"; client-booking:
  // "Cancelación del cliente con reembolso automático"). `RefundUseCase`
  // uses this load to decide settled→refund | refunded→idempotent no-op |
  // not_applicable→no-deposit. The join matters: for a phone/walk-in row
  // `deposit_id` is NULL, so the LEFT JOIN yields nulls — which is the
  // `{ kind: 'not_applicable' }` case, NOT the same as the appointment row
  // not existing at all (that surfaces as `null`, a caller bug). The loaded
  // `refunded` state carries `refundId: ''` because `deposits` does not
  // persist the gateway refund id (design.md row 457).
  async findDepositForAppointment(appointmentId: string): Promise<LoadedDeposit | null> {
    const rows = await this.db
      .select({
        depositId: deposits.id,
        state: deposits.state,
        paymentId: deposits.paymentId,
        amountCents: deposits.amountCents,
      })
      .from(slotOccupancies)
      .leftJoin(deposits, eq(slotOccupancies.depositId, deposits.id))
      .where(eq(slotOccupancies.id, appointmentId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }
    if (row.depositId === null) {
      return { depositId: null, state: { kind: 'not_applicable' } };
    }
    if (row.state === 'settled') {
      return {
        depositId: row.depositId,
        state: { kind: 'settled', paymentId: row.paymentId, amountCents: row.amountCents },
      };
    }
    if (row.state === 'refunded') {
      return {
        depositId: row.depositId,
        state: { kind: 'refunded', refundId: '', amountCents: row.amountCents },
      };
    }
    // Defensive: deposits.state should only ever be 'settled' or 'refunded'
    // for a reservado appointment — a forfeited row from a future absence
    // flow lands here and the caller (RefundUseCase) throws
    // UnexpectedDepositStateError, which is the loud signal we want, NOT a
    // silent treatment-as-settled. `pending` is logical-only and never
    // persisted, so it surfaces as a real data bug, loudly.
    if (row.state === 'forfeited') {
      return {
        depositId: row.depositId,
        state: { kind: 'forfeited', amountCents: row.amountCents },
      };
    }
    throw new Error(
      `DrizzleDepositRepository: deposit ${row.depositId} in unexpected state "${row.state}"`,
    );
  }

  // Idempotent by `WHERE state = 'settled'`: a retried refund against a
  // deposit already marked `refunded` affects zero rows and resolves
  // without re-writing or erroring — exactly the "mark-as-no-op-on-retry"
  // shape. `refundId` is accepted for the audit trail; the current
  // `deposits` schema (design.md row 457) only has the `state` flip to
  // persist, so the row carries no refund_id column yet.
  async markRefunded(input: { depositId: string; refundId: string }): Promise<void> {
    await this.db
      .update(deposits)
      .set({ state: 'refunded' })
      .where(and(eq(deposits.id, input.depositId), eq(deposits.state, 'settled')));
  }
}
