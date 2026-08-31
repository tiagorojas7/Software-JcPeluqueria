import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiGet, apiPost } from '../shared/api-client';
import { RouterProvider } from '../shared/router';
import { PublicLayout } from './PublicLayout';

// `PublicLayout` now asks `GET /account/profile` on mount to know whether to
// show "Ingresar" or a logged-in client's state (client-session-nav slice).
// Mocked exactly like `BookingPage.spec.tsx`'s own `mockReferenceData`: every
// test gets a deterministic answer by path instead of a real network call.
vi.mock('../shared/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/api-client')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

const ACCOUNT_PROFILE = { name: 'Juana Pérez', phone: '+54 9 351 000 0000', email: null, age: null };

/** `profile` undefined (the default) mocks the ordinary "no session" 403 a
 *  first-time visitor gets; passing `ACCOUNT_PROFILE` mocks a returning,
 *  logged-in client. */
function mockSession(profile?: unknown) {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/account/profile') {
      return profile !== undefined
        ? Promise.resolve(profile)
        : Promise.reject(new ApiError(403, { message: 'not logged in' }));
    }
    return Promise.reject(new Error(`unexpected apiGet path in test: ${path}`));
  });
}

function renderPublic(pathname = '/') {
  window.history.pushState({}, '', pathname);
  return render(
    <RouterProvider>
      <PublicLayout>
        <p>contenido publico</p>
      </PublicLayout>
    </RouterProvider>,
  );
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  // Default: sin sesion (403), el caso mas comun de visitante — cada test
  // que necesite otra cosa la pisa llamando a `mockSession(...)` de nuevo.
  mockSession();
});

// D.4 RED — "sacar del sitio publico todo rastro del panel: enlaces, rutas
// y textos". A visitor of `/` must never be able to discover `/panel`
// exists from this layout: no link pointing there, no visible text
// mentioning it.

describe('PublicLayout (D.2/D.4)', () => {
  it('muestra el nombre de la barberia y navegacion publica', () => {
    renderPublic();

    expect(screen.getAllByText(/jc barber/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /inicio/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /reservar/i })).toHaveAttribute('href', '/reservar');
  });

  it('no expone ningun enlace hacia el panel', () => {
    renderPublic();

    const links = screen.getAllByRole('link');
    for (const link of links) {
      expect(link.getAttribute('href')).not.toMatch(/^\/panel/);
    }
  });

  it('no menciona la palabra "panel" en ningun texto visible', () => {
    const { container } = renderPublic();

    expect(container.textContent?.toLowerCase()).not.toContain('panel');
  });

  it('muestra el contenido de la pantalla actual', () => {
    renderPublic();

    expect(screen.getByText('contenido publico')).toBeInTheDocument();
  });

  it('marca la ruta activa con aria-current', () => {
    renderPublic('/reservar');

    expect(screen.getByRole('link', { name: /reservar/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /inicio/i })).not.toHaveAttribute('aria-current');
  });
});

// client-session-nav RED — un cliente que ya inicio sesion no debe seguir
// viendo "Ingresar" en la navegacion publica: no tiene nada que hacer ahi.
// En su lugar corresponde una forma de cerrar sesion.
describe('PublicLayout — navegacion segun sesion del cliente', () => {
  it('mientras todavia no se sabe si hay sesion, no muestra "Ingresar" ni "Cerrar sesion"', () => {
    // La promesa nunca se resuelve dentro de este test: congela el layout
    // exactamente en el instante "todavia no se sabe".
    vi.mocked(apiGet).mockImplementation(() => new Promise(() => {}));

    renderPublic();

    expect(screen.queryByRole('link', { name: /ingresar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cerrar sesión/i })).not.toBeInTheDocument();
  });

  it('sin sesion, muestra "Ingresar" y no un boton de cerrar sesion', async () => {
    renderPublic();

    expect(await screen.findByRole('link', { name: /ingresar/i })).toHaveAttribute('href', '/acceder');
    expect(screen.queryByRole('button', { name: /cerrar sesión/i })).not.toBeInTheDocument();
  });

  it('con sesion activa, oculta "Ingresar" y muestra un boton de cerrar sesion', async () => {
    mockSession(ACCOUNT_PROFILE);

    renderPublic();

    expect(await screen.findByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ingresar/i })).not.toBeInTheDocument();
  });

  it('cerrar sesion pide POST /auth/logout y vuelve a ofrecer "Ingresar"', async () => {
    mockSession(ACCOUNT_PROFILE);
    vi.mocked(apiPost).mockResolvedValue({ loggedOut: true });

    renderPublic();

    const logoutButton = await screen.findByRole('button', { name: /cerrar sesión/i });
    fireEvent.click(logoutButton);

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/auth/logout'));
    expect(await screen.findByRole('link', { name: /ingresar/i })).toHaveAttribute('href', '/acceder');
    expect(screen.queryByRole('button', { name: /cerrar sesión/i })).not.toBeInTheDocument();
  });

  // Cerrar sesión estando en "Mi cuenta" dejaba la pantalla mostrando los
  // turnos de la sesión que se acababa de cerrar: para la persona, parecía
  // que el botón no había hecho nada. Volver al inicio desmonta esa pantalla
  // y deja el sitio en el estado que corresponde.
  it('al cerrar sesion vuelve al inicio, para no dejar a la vista la pantalla privada', async () => {
    mockSession({ name: 'Tiago', phone: '3515069498', email: 'tiago@example.com', age: null });
    vi.mocked(apiPost).mockResolvedValue({});
    renderPublic('/mi-cuenta');
    const cerrar = await screen.findByRole('button', { name: /cerrar sesi.n/i });

    fireEvent.click(cerrar);

    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });
});
