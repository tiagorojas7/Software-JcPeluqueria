import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet } from '../shared/api-client';
import { RouterProvider } from '../shared/router';
import { HomePage } from './HomePage';

vi.mock('../shared/api-client', () => ({
  apiGet: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

function renderHome() {
  return render(
    <RouterProvider>
      <HomePage />
    </RouterProvider>,
  );
}

// D.2 — the landing page a visitor actually sees at `/`: a clear call to
// action into the booking flow, and enough real shop content (services,
// team, hours) that it reads as an actual business, not a debug page.
//
// datos-reales-en-ui — used to read from `shared/demo-data.ts`; now fetches
// `GET /services`/`GET /barbers` on mount, so every test here mocks those
// two calls instead of relying on fixed demo content.

describe('HomePage (D.2)', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  it('tiene un titulo principal y una llamada a la accion hacia reservar', () => {
    vi.mocked(apiGet).mockResolvedValue({ services: [], barbers: [] });
    renderHome();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/jc barber/i);
    expect(screen.getByRole('link', { name: /reservar/i })).toHaveAttribute('href', '/reservar');
  });

  it('muestra los servicios del local con su precio real', async () => {
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/services') {
        return Promise.resolve({
          services: [
            { id: 's1', name: 'Corte clásico', durationMinutes: 30, priceCents: 800000 },
            { id: 's2', name: 'Corte + Barba', durationMinutes: 45, priceCents: 1200000 },
          ],
        });
      }
      return Promise.resolve({ barbers: [] });
    });
    renderHome();

    expect(await screen.findByText(/corte cl.sico \(\$8\.000\)/i)).toBeInTheDocument();
    expect(screen.getByText(/corte \+ barba \(\$12\.000\)/i)).toBeInTheDocument();
  });

  it('muestra el equipo de barberos activos', async () => {
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/barbers') {
        return Promise.resolve({ barbers: [{ id: 'b1', name: 'Cristian Gómez' }] });
      }
      return Promise.resolve({ services: [] });
    });
    renderHome();

    expect(await screen.findByText(/cristian g.mez/i)).toBeInTheDocument();
  });

  it('no menciona la palabra "panel" en ningun texto visible', () => {
    vi.mocked(apiGet).mockResolvedValue({ services: [], barbers: [] });
    const { container } = renderHome();

    expect(container.textContent?.toLowerCase()).not.toContain('panel');
  });

  it('un barbero desactivado nunca llega a esta pantalla, porque GET /barbers ya lo excluye', async () => {
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/barbers') {
        return Promise.resolve({ barbers: [{ id: 'b1', name: 'Cristian Gómez' }] });
      }
      return Promise.resolve({ services: [] });
    });
    renderHome();

    await screen.findByText(/cristian g.mez/i);
    expect(screen.queryByText(/facundo/i)).toBeNull();
  });

  it('muestra un error si la carga falla, en vez de una lista vacia silenciosa', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('No se pudo conectar con el servidor'));
    renderHome();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo conectar/i);
  });
});
