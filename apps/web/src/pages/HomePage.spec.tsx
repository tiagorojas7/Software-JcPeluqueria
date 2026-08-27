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

  // El h1 pasa a ser la promesa, no el nombre del local: es lo que decide a
  // alguien que llega sin conocer la barberia. El nombre sigue en pantalla
  // (cabecera y hero), asi que no se pierde — cambia de lugar, no desaparece.
  it('encabeza con la promesa y deja el nombre del local visible igual', () => {
    vi.mocked(apiGet).mockResolvedValue({ services: [], barbers: [] });
    const { container } = renderHome();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/tu mejor versi.n/i);
    expect(container.textContent).toMatch(/jc barber/i);
  });

  it('lleva a reservar desde el hero', () => {
    vi.mocked(apiGet).mockResolvedValue({ services: [], barbers: [] });
    renderHome();

    expect(screen.getAllByRole('link', { name: /reservar turno/i })[0]).toHaveAttribute(
      'href',
      '/reservar',
    );
  });

  // El local es oscuro, con madera y cuero, y eso no se transmite con texto.
  // Las fotos reales del lugar son la unica prueba de como se ve.
  it('muestra fotos reales del local, con texto alternativo', () => {
    vi.mocked(apiGet).mockResolvedValue({ services: [], barbers: [] });
    renderHome();

    const fotos = screen.getAllByRole('img');
    expect(fotos.length).toBeGreaterThan(0);
    for (const foto of fotos) {
      expect(foto).toHaveAccessibleName();
    }
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

    // Nombre, duracion y precio son tres datos distintos y se leen como
    // tres: apretados en un solo string ("Corte clasico ($8.000)") nadie
    // compara dos servicios de un vistazo.
    expect(await screen.findByText('Corte clásico')).toBeInTheDocument();
    expect(screen.getByText('$8.000')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();

    expect(screen.getByText('Corte + Barba')).toBeInTheDocument();
    expect(screen.getByText('$12.000')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
  });

  // La senia del 50% es la parte que mas dudas genera al reservar, asi que
  // se dice en la pagina publica y no recien en el checkout.
  it('avisa que la reserva se asegura con una seña del 50%', () => {
    vi.mocked(apiGet).mockResolvedValue({ services: [], barbers: [] });
    const { container } = renderHome();

    expect(container.textContent).toMatch(/50%/);
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
