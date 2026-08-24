import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet, apiPost } from '../shared/api-client';
import { RouterProvider } from '../shared/router';
import { BookingPage } from './BookingPage';

vi.mock('../shared/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

const BARBERS_RESPONSE = { barbers: [{ id: 'barber-1', name: 'Cristian Gómez' }] };
const SERVICES_RESPONSE = {
  services: [{ id: 'service-1', name: 'Corte clásico', durationMinutes: 30, priceCents: 800000 }],
};

/**
 * Every test here mocks `apiGet` by path: `/barbers`/`/services` resolve on
 * mount (datos-reales-en-ui — the page fetches real reference data instead
 * of importing `shared/demo-data.ts` now), `/availability` resolves however
 * that specific test needs after the visitor searches.
 */
function mockReferenceData(availabilityResult?: unknown) {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/barbers') {
      return Promise.resolve(BARBERS_RESPONSE);
    }
    if (path === '/services') {
      return Promise.resolve(SERVICES_RESPONSE);
    }
    if (path.startsWith('/availability') && availabilityResult !== undefined) {
      return Promise.resolve(availabilityResult);
    }
    return Promise.reject(new Error(`unexpected apiGet path in test: ${path}`));
  });
}

// D.5 RED — `AvailabilityPicker` (apps/web/src/booking/, not owned by this
// slice) says "No hay horarios disponibles para esta selección" for ANY
// empty `slots` array, including before the visitor ever searched — making
// the shop look permanently full. Cannot edit that component, so the fix
// lives entirely here, at the page this slice DOES own: `AvailabilityPicker`
// (via `BookingFlowContainer`) is only mounted once a search has actually
// happened. Before that, this page shows its own "todavia no buscaste" hint
// instead — so the ambiguous "no hay horarios" text is structurally
// impossible to reach before a search, not merely reworded.

describe('BookingPage (D.5)', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
  });

  it('antes de la primera busqueda invita a buscar, y no dice que no hay horarios', async () => {
    mockReferenceData();
    render(<BookingPage />);

    expect(await screen.findByText(/todav.a no buscaste/i)).toBeInTheDocument();
    expect(screen.queryByText(/no hay horarios disponibles/i)).toBeNull();
  });

  it('mientras carga barberos y servicios, no muestra el formulario de busqueda todavia', () => {
    vi.mocked(apiGet).mockImplementation(() => new Promise(() => {}));
    render(<BookingPage />);

    expect(screen.getByText(/cargando barberos y servicios/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^barbero$/i)).toBeNull();
  });

  it('si la carga de barberos o servicios falla, muestra el error en vez de un formulario vacio', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('No se pudo conectar con el servidor'));
    render(<BookingPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo conectar/i);
    expect(screen.queryByLabelText(/^barbero$/i)).toBeNull();
  });

  it('despues de buscar y no encontrar nada, ahora si distingue que no hay horarios', async () => {
    mockReferenceData({ slots: [] });
    render(<BookingPage />);

    fireEvent.change(await screen.findByLabelText(/fecha/i), { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByRole('button', { name: /ver horarios disponibles/i }));

    expect(await screen.findByText(/no hay horarios disponibles para esta selecci/i)).toBeInTheDocument();
    expect(screen.queryByText(/todav.a no buscaste/i)).toBeNull();
  });

  it('despues de buscar y encontrar horarios, los muestra en vez del aviso', async () => {
    mockReferenceData({
      slots: [{ startsAt: '2026-08-20T12:00:00.000Z', endsAt: '2026-08-20T12:30:00.000Z' }],
    });
    render(<BookingPage />);

    fireEvent.change(await screen.findByLabelText(/fecha/i), { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByRole('button', { name: /ver horarios disponibles/i }));

    // 12:00Z es 09:00 en el local (UTC-3): el visitante lee la hora a la que
    // realmente lo atienden, nunca UTC.
    expect(await screen.findByRole('button', { name: /^09:00$/i })).toBeInTheDocument();
    expect(screen.queryByText(/todav.a no buscaste/i)).toBeNull();
    expect(screen.queryByText(/no hay horarios disponibles/i)).toBeNull();
  });

  // cuenta-cliente-persistente: once the account exists the client is about
  // to be sent to MercadoPago (CheckoutStep's link navigates the browser
  // away) — this may be his only chance to see this exact page again, so the
  // access-code invitation must already be visible at this point, before he
  // ever clicks "pagar".
  it('apenas se crea la cuenta muestra el aviso para pedir un codigo de acceso, antes de pagar', async () => {
    mockReferenceData({
      slots: [{ startsAt: '2026-08-20T12:00:00.000Z', endsAt: '2026-08-20T12:30:00.000Z' }],
    });
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ holdId: 'hold-1', expiresAt: '2026-08-20T12:15:00.000Z' })
      .mockResolvedValueOnce({ clientId: 'client-1' });
    render(
      <RouterProvider>
        <BookingPage />
      </RouterProvider>,
    );

    fireEvent.change(await screen.findByLabelText(/fecha/i), { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByRole('button', { name: /ver horarios disponibles/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^09:00$/i }));

    fireEvent.change(await screen.findByLabelText(/nombre/i), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/tel.fono/i), { target: { value: '3511111111' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar reserva/i }));

    expect(await screen.findByText(/c.digo de acceso/i)).toBeInTheDocument();
    // The invitation appears alongside the "pagar" button, never instead of it.
    expect(screen.getByRole('button', { name: /pagar la se.a/i })).toBeInTheDocument();
  });
});
