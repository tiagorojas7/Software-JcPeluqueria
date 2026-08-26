import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPost } from '../shared/api-client';
import { RouterProvider } from '../shared/router';
import { PaymentReturnPage } from './PaymentReturnPage';

vi.mock('../shared/api-client', () => ({
  apiPost: vi.fn().mockResolvedValue({ claimed: true }),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

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

  // Los tres desenlaces se anunciaban con el mismo `role="status"`, o sea
  // que un cobro rechazado llegaba al lector de pantalla con el mismo peso
  // que uno recibido. Un pago que no se completo es lo unico de esta pagina
  // sobre lo que el cliente tiene que hacer algo.
  it('anuncia un pago rechazado como alerta, no como un aviso mas', () => {
    renderReturn('?estado=failure');

    expect(screen.getByRole('alert')).toHaveTextContent(/no se acredit/i);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('anuncia los demas desenlaces como estado, porque no hay nada que resolver', () => {
    renderReturn('?estado=pending');

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

// RED — found in production, not deduced: an approved payment of ARS 6.000
// whose `notification_url` was correct produced no webhook at all, and the
// hold sat minutes from expiring with the money already taken. One delivery
// attempt to one URL is not something to hang a paid booking on. MercadoPago
// appends `payment_id` to this very URL, so the returning browser is carrying
// the second chance.
describe('PaymentReturnPage — el segundo aviso, cuando el webhook no llega', () => {
  beforeEach(() => {
    vi.mocked(apiPost).mockClear();
    vi.mocked(apiPost).mockResolvedValue({ claimed: true });
  });

  it('avisa del pago que MercadoPago dejó en la URL al volver', async () => {
    renderReturn('?estado=success&payment_id=175602375118');

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/payments/claim', { paymentId: '175602375118' });
    });
  });

  it('sigue sin afirmar que el turno está confirmado — avisar no es confirmar', async () => {
    renderReturn('?estado=success&payment_id=175602375118');

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(screen.queryByText(/turno.*confirmado/i)).not.toBeInTheDocument();
    expect(screen.getByText(/email con la confirmaci/i)).toBeInTheDocument();
  });

  it('no avisa nada cuando el pago falló — no hay pago del que preguntar', () => {
    renderReturn('?estado=failure&payment_id=175602375118');

    expect(apiPost).not.toHaveBeenCalled();
  });

  it('no avisa nada cuando MercadoPago no dejó payment_id', () => {
    renderReturn('?estado=success');

    expect(apiPost).not.toHaveBeenCalled();
  });

  it('un fallo del aviso no le muestra un error al cliente que sí pagó', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('sin red'));
    renderReturn('?estado=success&payment_id=175602375118');

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    // El webhook sigue en camino; asustar a alguien que pagó bien seria
    // ademas de alarmante, falso.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/recibimos tu pago/i)).toBeInTheDocument();
  });
});
