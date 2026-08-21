import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouterProvider } from '../shared/router';
import { PaymentReturnPage } from './PaymentReturnPage';

function renderReturn(search: string) {
  return render(
    <RouterProvider>
      <PaymentReturnPage search={search} />
    </RouterProvider>,
  );
}

// cablear-el-mvp item 3 — the public route MercadoPago's `back_urls` point
// at (`mercadopago-payment.adapter.ts`, `RETURN_PATH`). The client has no
// session here. `estado=success` is honest ON PURPOSE: the redirect can
// beat the webhook that actually flips the turno to `reservado`
// (design.md: "el redirect del navegador no es fuente de verdad"), so this
// page never claims the booking is confirmed — only the booking_confirmed
// email (or a fresh login) is that source of truth.
describe('PaymentReturnPage (cablear-el-mvp item 3)', () => {
  it('con estado=success, dice que el pago se recibio pero no que el turno ya esta confirmado', () => {
    renderReturn('?estado=success');

    expect(screen.getByText(/recibimos tu pago/i)).toBeInTheDocument();
    expect(screen.queryByText(/turno.*confirmado/i)).not.toBeInTheDocument();
    expect(screen.getByText(/email con la confirmaci/i)).toBeInTheDocument();
  });

  it('con estado=pending, dice que el pago esta pendiente', () => {
    renderReturn('?estado=pending');

    expect(screen.getByText(/pendiente/i)).toBeInTheDocument();
  });

  it('con estado=failure, dice que el pago no se completo y que el turno no quedo reservado', () => {
    renderReturn('?estado=failure');

    expect(screen.getByText(/no se pudo completar/i)).toBeInTheDocument();
  });

  it('sin un estado reconocible, no inventa un resultado', () => {
    renderReturn('');

    expect(screen.getByText(/no pudimos identificar/i)).toBeInTheDocument();
  });

  // cuenta-cliente-persistente: the client may never see this exact page
  // again once he leaves — this is where he needs to learn HOW he gets back
  // in later (a code, not a password), not just that a link exists.
  it('invita a pedir un codigo de acceso, con un enlace real a /acceder', () => {
    renderReturn('?estado=success');

    expect(screen.getByText(/c.digo de acceso/i)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/acceder');
  });
});
