import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouterProvider } from '../shared/router';
import { AccessCodeNotice } from './AccessCodeNotice';

// cuenta-cliente-persistente: the shop owner asked for a notice, shown once
// a booking finishes, inviting the client to request an access code and
// manage his turnos later — shared verbatim by `BookingPage` (right after
// the account is created) and `PaymentReturnPage` (the MercadoPago landing),
// so the copy never drifts between the two places a client can see it.
describe('AccessCodeNotice', () => {
  it('invita a pedir un codigo de acceso y enlaza a /acceder', () => {
    render(
      <RouterProvider>
        <AccessCodeNotice />
      </RouterProvider>,
    );

    expect(screen.getByText(/c.digo de acceso/i)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/acceder');
  });
});
