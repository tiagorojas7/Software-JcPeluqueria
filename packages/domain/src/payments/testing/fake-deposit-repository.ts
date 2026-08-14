import type { DepositState } from '../../appointments/deposit-state';
import type {
  DepositRepository,
  LoadedDeposit,
  RecordSettledPaymentResult,
  ReleaseRejectedPaymentResult,
} from '../deposit-repository';

export interface RecordedSettledPaymentCall {
  readonly holdId: string;
  readonly paymentId: string;
  readonly amountCents: number;
}

export interface RecordedReleaseCall {
  readonly holdId: string;
}

export interface RecordedMarkRefundedCall {
  readonly depositId: string;
  readonly refundId: string;
}

/**
 * In-memory `DepositRepository` test double. Simulates the real idempotency
 * guard with a `Set` of already-processed payment ids — good enough to prove
 * a use case's orchestration; the actual atomic guarantee only exists
 * against PostgreSQL (`DrizzleDepositRepository`'s Testcontainers suite).
 */
export class FakeDepositRepository implements DepositRepository {
  readonly calls: RecordedSettledPaymentCall[] = [];
  readonly releaseCalls: RecordedReleaseCall[] = [];
  readonly markRefundedCalls: RecordedMarkRefundedCall[] = [];
  readonly findCalls: string[] = [];
  private readonly processedPaymentIds = new Set<string>();
  private readonly releasedHoldIds = new Set<string>();
  /**
   * Test seed: appointment id → the deposit attached to it. Use
   * `seedNotApplicableAppointment` for a phone/walk-in row (no deposit
   * attached). Cleared between tests by instantiation, never mutated mid-test
   * unless a use case calls `markRefunded`.
   */
  private readonly appointmentDeposits = new Map<
    string,
    { depositId: string; paymentId: string; amountCents: number; state: 'settled' | 'refunded' }
  >();
  private readonly notApplicableAppointments = new Set<string>();

  async recordSettledPayment(input: RecordedSettledPaymentCall): Promise<RecordSettledPaymentResult> {
    this.calls.push(input);
    if (this.processedPaymentIds.has(input.paymentId)) {
      return 'already-processed';
    }
    this.processedPaymentIds.add(input.paymentId);
    return 'confirmed';
  }

  /** Mirrors `recordSettledPayment`'s idempotency shape: records every call
   *  (so a test can assert the use case retried), returns `'released'` on
   *  the first call for a hold and `'no-op'` on every retry. Real
   *  PostgreSQL-level atomicity lives only in `DrizzleDepositRepository`'s
   *  Testcontainers proof. */
  async releaseHoldOnRejectedPayment(holdId: string): Promise<ReleaseRejectedPaymentResult> {
    this.releaseCalls.push({ holdId });
    if (this.releasedHoldIds.has(holdId)) {
      return 'no-op';
    }
    this.releasedHoldIds.add(holdId);
    return 'released';
  }

  async findDepositForAppointment(appointmentId: string): Promise<LoadedDeposit | null> {
    this.findCalls.push(appointmentId);
    if (this.appointmentDeposits.has(appointmentId)) {
      const d = this.appointmentDeposits.get(appointmentId)!;
      const state: DepositState =
        d.state === 'settled'
          ? { kind: 'settled', paymentId: d.paymentId, amountCents: d.amountCents }
          : { kind: 'refunded', refundId: '', amountCents: d.amountCents };
      return { depositId: d.depositId, state };
    }
    if (this.notApplicableAppointments.has(appointmentId)) {
      return { depositId: null, state: { kind: 'not_applicable' } };
    }
    return null;
  }

  async markRefunded(input: { depositId: string; refundId: string }): Promise<void> {
    this.markRefundedCalls.push({ depositId: input.depositId, refundId: input.refundId });
    for (const d of this.appointmentDeposits.values()) {
      if (d.depositId === input.depositId) {
        d.state = 'refunded';
      }
    }
  }

  /** Seeding helpers for refund tests — not in the domain interface; exist
   *  only so a test can stand up a known deposit without touching SQL. */
  seedSettledAppointment(appointmentId: string, deposit: {
    depositId: string;
    paymentId: string;
    amountCents: number;
  }): void {
    this.appointmentDeposits.set(appointmentId, {
      depositId: deposit.depositId,
      paymentId: deposit.paymentId,
      amountCents: deposit.amountCents,
      state: 'settled',
    });
  }

  seedRefundedAppointment(appointmentId: string, deposit: {
    depositId: string;
    paymentId: string;
    amountCents: number;
  }): void {
    this.appointmentDeposits.set(appointmentId, {
      depositId: deposit.depositId,
      paymentId: deposit.paymentId,
      amountCents: deposit.amountCents,
      state: 'refunded',
    });
  }

  seedNotApplicableAppointment(appointmentId: string): void {
    this.notApplicableAppointments.add(appointmentId);
  }
}
