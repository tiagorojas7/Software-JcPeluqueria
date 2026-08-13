import { describe, expect, it } from 'vitest';

import type { DepositState } from './deposit-state';
import {
  UnexpectedDepositStateError,
  resolveDepositForAbsence,
  resolveDepositForCancellation,
  resolveDepositForCompletion,
} from './deposit-transitions';
import { FakePaymentPort } from './testing/fake-payment-port';

// design.md, "La seña la decide el canal — invariante estructural": a
// discriminated union, never `Deposit | null`, so a switch over `.kind` can
// never silently skip a case. These five constructions prove every kind is
// representable and narrows correctly on `.kind`.
const NOT_APPLICABLE: DepositState = { kind: 'not_applicable' };
const PENDING: DepositState = { kind: 'pending', paymentIntentId: 'intent-1' };
const SETTLED: DepositState = { kind: 'settled', paymentId: 'payment-1', amountCents: 250_000 };
const REFUNDED: DepositState = { kind: 'refunded', refundId: 'refund-1', amountCents: 250_000 };
const FORFEITED: DepositState = { kind: 'forfeited', amountCents: 250_000 };

describe('DepositState', () => {
  it('is exhaustive over all five kinds', () => {
    for (const deposit of [NOT_APPLICABLE, PENDING, SETTLED, REFUNDED, FORFEITED]) {
      expect(['not_applicable', 'pending', 'settled', 'refunded', 'forfeited']).toContain(
        deposit.kind,
      );
    }
  });
});

describe('resolveDepositForCompletion (realizado)', () => {
  it('never moves money — a settled deposit is left exactly as it is', () => {
    // Spec: "Si existía seña, se considera aplicada al servicio" — applied
    // means untouched, not a new DepositState kind.
    expect(resolveDepositForCompletion(SETTLED)).toBe(SETTLED);
  });

  it('leaves a non-applicable deposit untouched too', () => {
    // appointment-lifecycle spec, "Turno realizado sin seña previa".
    expect(resolveDepositForCompletion(NOT_APPLICABLE)).toBe(NOT_APPLICABLE);
  });
});

describe('resolveDepositForAbsence (ausente)', () => {
  it('forfeits a settled deposit without calling PaymentPort', () => {
    const result = resolveDepositForAbsence(SETTLED);
    expect(result).toEqual({ kind: 'forfeited', amountCents: 250_000 });
  });

  it('leaves a non-applicable deposit untouched — nothing to forfeit', () => {
    expect(resolveDepositForAbsence(NOT_APPLICABLE)).toBe(NOT_APPLICABLE);
  });

  it('rejects a deposit kind that can never legitimately reach an absence confirmation', () => {
    expect(() => resolveDepositForAbsence(PENDING)).toThrow(UnexpectedDepositStateError);
  });
});

describe('resolveDepositForCancellation', () => {
  it('refunds a settled deposit through PaymentPort exactly once', async () => {
    const paymentPort = new FakePaymentPort();
    const result = await resolveDepositForCancellation(SETTLED, paymentPort);
    expect(paymentPort.refundCalls).toEqual([{ paymentId: 'payment-1', amountCents: 250_000 }]);
    expect(result.kind).toBe('refunded');
  });

  it('never calls PaymentPort for a non-applicable deposit', async () => {
    const paymentPort = new FakePaymentPort();
    const result = await resolveDepositForCancellation(NOT_APPLICABLE, paymentPort);
    expect(paymentPort.refundCalls).toEqual([]);
    expect(result).toBe(NOT_APPLICABLE);
  });

  it('rejects a deposit kind that can never legitimately reach a cancellation', () => {
    const paymentPort = new FakePaymentPort();
    return expect(resolveDepositForCancellation(REFUNDED, paymentPort)).rejects.toThrow(
      UnexpectedDepositStateError,
    );
  });
});
