import type { CheckoutResponseBody } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutStep } from './CheckoutStep';

// 9.12 RED (frontend half) — derived from specs/client-booking/spec.md:
//
//   "Reserva web con seña obligatoria del 50%" (Scenario "Reserva confirmada
//   con seña cobrada"):
//     WHEN el cliente completa el pago del 50% por la pasarela de pago
//     THEN el turno pasa a estado `reservado`
//
//   Scenario "Falla el cobro de la seña":
//     THEN el sistema MUST NOT crear el turno en estado `reservado`
//     AND el horario permanece sujeto a las reglas de expiración de slot-hold
//
// `CheckoutUseCase` (5.6, wired to HTTP in 9.11/9.12) never tells the browser
// "reservado" synchronously — that transition only ever happens inside
// `ProcessPaymentUseCase`, driven by MercadoPago's webhook (design.md: "el
// redirect del navegador no es fuente de verdad"). This component's whole
// job is to stay honest about that: it starts checkout, hands the visitor
// the gateway link on success, and on `hold-expired` it must NOT offer any
// path that pretends the reservation can still complete — same "no fake
// retry" shape `AccessCodeForm` (9.10) already established.
describe('CheckoutStep (9.12)', () => {
  it('antes de pedir el cobro, solo ofrece iniciarlo — nunca afirma que el turno esta reservado', () => {
    const onStartCheckout = vi.fn();
    render(<CheckoutStep checkout={null} onStartCheckout={onStartCheckout} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pagar la seña (50%)' }));

    expect(onStartCheckout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/reservado/i)).not.toBeInTheDocument();
  });

  it('con la preferencia creada, ofrece el link a la pasarela y nunca afirma que el turno ya quedo reservado', () => {
    const checkout: CheckoutResponseBody = {
      outcome: 'created',
      initPoint: 'https://mercadopago.example/pref-1',
    };
    render(<CheckoutStep checkout={checkout} onStartCheckout={vi.fn()} />);

    expect(screen.getByRole('link', { name: /pagar la seña/i })).toHaveAttribute(
      'href',
      'https://mercadopago.example/pref-1',
    );
    // "El turno pasa a reservado UNICAMENTE si el cobro fue exitoso" (spec) —
    // the checkout response is not that confirmation, so this component must
    // never claim it either.
    expect(screen.queryByText(/turno.*reservado|reservado.*turno/i)).not.toBeInTheDocument();
  });

  it('cuando el hold ya no esta vivo, no ofrece ningun camino que finja que la reserva puede seguir', () => {
    const checkout: CheckoutResponseBody = { outcome: 'hold-expired' };
    render(<CheckoutStep checkout={checkout} onStartCheckout={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/venci/i);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar la seña (50%)' })).not.toBeInTheDocument();
  });
});
