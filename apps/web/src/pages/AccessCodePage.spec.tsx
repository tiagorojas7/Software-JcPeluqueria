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

// fix/acceso-cliente-sin-id — the shop owner was explicit: "la idea es que
// el cliente solo ponga el codigo." `RequestClientAccessUseCase` never
// returns a `challengeId` (non-disclosure requirement, unchanged), and now
// neither does this screen ever ask a human to type one: the email typed on
// step one is carried forward automatically (persisted in `localStorage`),
// and `POST /auth/client-login` accepts `{ email, secret }`
// (`ClientLoginByEmailRequestSchema`) instead.

function renderPage() {
  return render(
    <RouterProvider>
      <AccessCodePage />
    </RouterProvider>,
  );
}

async function requestCode() {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sofia@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /pedir c.digo/i }));
  await screen.findByLabelText(/codigo/i);
}

describe('AccessCodePage (fix/acceso-cliente-sin-id)', () => {
  beforeEach(() => {
    vi.mocked(apiPost).mockReset();
    window.localStorage.clear();
    window.history.pushState({}, '', '/acceder');
  });

  it('pide el email, solicita el acceso y pasa al paso del codigo sin pedir ningun ID', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody);
    renderPage();

    await requestCode();

    expect(apiPost).toHaveBeenCalledWith('/auth/request-client-access', { email: 'sofia@example.com' });
    expect(screen.getByLabelText(/codigo/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/id de la solicitud/i)).toBeNull();
  });

  it('con email y codigo correctos, autentica y navega a Mi cuenta', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody)
      .mockResolvedValueOnce({ outcome: 'authenticated', clientId: 'client-1' } satisfies ClientLoginResponseBody);
    renderPage();
    await requestCode();

    fireEvent.change(screen.getByLabelText(/codigo/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'));
    expect(apiPost).toHaveBeenCalledWith('/auth/client-login', { email: 'sofia@example.com', secret: '123456' });
  });

  it('con codigo incorrecto, avisa, deja reintentar y siempre ofrece pedir uno nuevo', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody)
      .mockResolvedValueOnce({ outcome: 'rejected' } satisfies ClientLoginResponseBody);
    renderPage();
    await requestCode();

    fireEvent.change(screen.getByLabelText(/codigo/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    expect(await screen.findByText(/incorrecto/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ingresar/i })).toBeEnabled();
    // Decision 2: this endpoint never distinguishes "expired" from "wrong
    // code" (both collapse to `rejected`), so the one action that always
    // moves a legitimate client forward has to be visible unconditionally.
    expect(screen.getByRole('button', { name: /pedir un codigo nuevo/i })).toBeEnabled();
  });

  it('pedir un codigo nuevo reutiliza el email ya conocido, sin volver a pedirlo', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody)
      .mockResolvedValueOnce({ outcome: 'rejected' } satisfies ClientLoginResponseBody)
      .mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody);
    renderPage();
    await requestCode();
    fireEvent.change(screen.getByLabelText(/codigo/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    await screen.findByText(/incorrecto/i);

    fireEvent.click(screen.getByRole('button', { name: /pedir un codigo nuevo/i }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenLastCalledWith('/auth/request-client-access', { email: 'sofia@example.com' }),
    );
    // Still on the code step — never bounced back to asking for the email.
    expect(screen.getByLabelText(/codigo/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).toBeNull();
  });

  it('al volver de la casilla de mail (email ya persistido), sigue pidiendo solo el codigo', async () => {
    window.localStorage.setItem('jc-barberia:access-email', 'sofia@example.com');

    renderPage();

    expect(await screen.findByLabelText(/codigo/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).toBeNull();
    expect(screen.queryByLabelText(/id de la solicitud/i)).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('sin contexto persistido, pide el email de nuevo — nunca el ID de la solicitud', async () => {
    renderPage();

    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/id de la solicitud/i)).toBeNull();
  });

  it('con un enlace magico en la URL, autentica sin que el cliente escriba nada', async () => {
    window.history.pushState({}, '', '/acceder?challengeId=challenge-1&token=tok-abc');
    vi.mocked(apiPost).mockResolvedValueOnce({
      outcome: 'authenticated',
      clientId: 'client-1',
    } satisfies ClientLoginResponseBody);

    renderPage();

    await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'));
    expect(apiPost).toHaveBeenCalledWith('/auth/client-login', { challengeId: 'challenge-1', secret: 'tok-abc' });
  });

  it('con un enlace magico invalido, cae de nuevo al paso de email', async () => {
    window.history.pushState({}, '', '/acceder?challengeId=challenge-1&token=tok-abc');
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'rejected' } satisfies ClientLoginResponseBody);

    renderPage();

    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/id de la solicitud/i)).toBeNull();
  });

  it('nunca revela si el email esta registrado: siempre el mismo aviso', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody);
    renderPage();

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'nadie@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /pedir c.digo/i }));

    await screen.findByLabelText(/codigo/i);
    // The only thing this screen can ever show after requesting is the one
    // outcome-invariant message — never a branch on whether the email was found.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // Entrar sin contrasenia es lo raro de este flujo, y no estaba explicado en
  // ningun lado: quien llega busca un campo de password que no existe y
  // asume que la pantalla esta rota o que perdio la cuenta.
  it('explica que no hace falta contraseña', () => {
    const { container } = renderPage();

    expect(container.textContent).toMatch(/sin contrase|no (necesit|hace falta)/i);
  });

  // El paso del codigo mostraba el email pero no dejaba corregirlo: un email
  // mal tipeado quedaba persistido en localStorage y la unica salida era
  // borrar el storage a mano. "Usar otro email" tiene que volver al paso del
  // email Y limpiar lo persistido, o recargar la pagina te devuelve al mismo
  // callejon.
  it('permite corregir el email desde el paso del codigo', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ outcome: 'requested' } satisfies RequestClientAccessResponseBody);
    renderPage();
    await requestCode();

    fireEvent.click(screen.getByRole('button', { name: /usar otro email/i }));

    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('jc-barberia:access-email')).toBeNull();
  });

  // Una vez pedido el codigo, el email al que se mando tiene que quedar a la
  // vista: es el dato que la gente escribe mal, y sin verlo no puede saber
  // por que el correo no llega.
  it('muestra a qué email se mandó el código', async () => {
    vi.mocked(apiPost).mockResolvedValue({ outcome: 'requested' });
    renderPage();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'agustin@mail.com' } });
    fireEvent.click(screen.getByRole('button', { name: /pedir c.digo/i }));

    expect(await screen.findByText(/agustin@mail\.com/)).toBeInTheDocument();
  });
});
