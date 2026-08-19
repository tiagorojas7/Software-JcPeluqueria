import type { ClientLoginResponseBody, RequestClientAccessResponseBody } from '@jc-barberia/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiPost } from '../shared/api-client';
import { RouterProvider } from '../shared/router';
import { AccessCodePage } from './AccessCodePage';

vi.mock('../shared/api-client', () => ({
  apiPost: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

// C.7 RED — the real wiring `AccessCodePage`'s own doc comment used to admit
// did not exist: C.1/C.2 (`POST /auth/request-client-access` and
// `POST /auth/client-login`) are real endpoints now, so this page must call
// them instead of `notAvailable()`. `request-client-access` never returns a
// `challengeId` (client-booking spec's own non-disclosure requirement — see
// `RequestClientAccessUseCase`'s doc comment), so the second step asks the
// client for it directly rather than pretending the browser already knows
// it.

function renderPage() {
  return render(
    <RouterProvider>
      <AccessCodePage />
    </RouterProvider>,
  );
}

async function requestCode() {
  fireEvent.change(screen.getByLabelText(/tel.fono/i), { target: { value: '+5493511111111' } });
  fireEvent.click(screen.getByRole('button', { name: /pedir c.digo/i }));
  await screen.findByLabelText(/id de la solicitud/i);
}

describe('AccessCodePage (C.7)', () => {
  beforeEach(() => {
    vi.mocked(apiPost).mockReset();
    window.history.pushState({}, '', '/acceder');
  });

  it('pide el telefono y solicita el acceso contra el endpoint real', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody);
    renderPage();

    await requestCode();

    expect(apiPost).toHaveBeenCalledWith('/auth/request-client-access', { phone: '+5493511111111' });
    expect(screen.getByLabelText(/id de la solicitud/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/codigo/i)).toBeInTheDocument();
  });

  it('con un codigo y challenge correctos, autentica y navega a Mi cuenta', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody)
      .mockResolvedValueOnce({ outcome: 'authenticated', clientId: 'client-1' } satisfies ClientLoginResponseBody);
    renderPage();
    await requestCode();

    fireEvent.change(screen.getByLabelText(/id de la solicitud/i), { target: { value: 'challenge-1' } });
    fireEvent.change(screen.getByLabelText(/codigo/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'));
    expect(apiPost).toHaveBeenCalledWith('/auth/client-login', { challengeId: 'challenge-1', secret: '123456' });
  });

  it('con codigo incorrecto pero challenge vivo, avisa y deja reintentar', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody)
      .mockResolvedValueOnce({ outcome: 'rejected' } satisfies ClientLoginResponseBody);
    renderPage();
    await requestCode();

    fireEvent.change(screen.getByLabelText(/id de la solicitud/i), { target: { value: 'challenge-1' } });
    fireEvent.change(screen.getByLabelText(/codigo/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    expect(await screen.findByText(/incorrecto/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ingresar/i })).toBeEnabled();
  });

  it('con un codigo vencido exige pedir uno nuevo y vuelve al paso de telefono', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody)
      .mockResolvedValueOnce({
        outcome: 'must-request-new-code',
        reason: 'expired',
      } satisfies ClientLoginResponseBody);
    renderPage();
    await requestCode();

    fireEvent.change(screen.getByLabelText(/id de la solicitud/i), { target: { value: 'challenge-1' } });
    fireEvent.change(screen.getByLabelText(/codigo/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/venc/i);

    fireEvent.click(screen.getByRole('button', { name: /pedir un codigo nuevo/i }));

    expect(screen.getByLabelText(/tel.fono/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/id de la solicitud/i)).toBeNull();
  });

  it('nunca revela si el telefono esta registrado: siempre el mismo aviso', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody);
    renderPage();

    fireEvent.change(screen.getByLabelText(/tel.fono/i), { target: { value: '+5493519999999' } });
    fireEvent.click(screen.getByRole('button', { name: /pedir c.digo/i }));

    await screen.findByLabelText(/id de la solicitud/i);
    // The only thing this screen can ever show after requesting is the one
    // outcome-invariant message — never a branch on whether the phone was found.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
