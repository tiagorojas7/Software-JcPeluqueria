import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet } from './api-client';
import { useReferenceData } from './use-reference-data';

vi.mock('./api-client', () => ({
  apiGet: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

const BARBERS = { barbers: [{ id: 'b1', name: 'Cristian Gómez' }] };
const SERVICES = { services: [{ id: 's1', name: 'Corte clásico', durationMinutes: 30, priceCents: 800000 }] };

function mockOk() {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/barbers') return Promise.resolve(BARBERS);
    if (path === '/services') return Promise.resolve(SERVICES);
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

// Cinco pantallas repetian el mismo efecto (BookingPage, PhoneAppointmentPage,
// ManagementPage, AdminDayBoardPanel, HomePage): mismo Promise.all, misma
// bandera `cancelled`, mismo manejo de error. Un solo lugar donde arreglarlo.
describe('useReferenceData', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    mockOk();
  });

  it('arranca cargando y despues entrega barberos y servicios', async () => {
    const { result } = renderHook(() => useReferenceData());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.barbers).toEqual(BARBERS.barbers);
    expect(result.current.services).toEqual(SERVICES.services);
    expect(result.current.error).toBeNull();
    expect(result.current.ready).toBe(true);
  });

  it('pide cada recurso una sola vez', async () => {
    const { result } = renderHook(() => useReferenceData());

    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet).toHaveBeenCalledWith('/barbers');
    expect(apiGet).toHaveBeenCalledWith('/services');
  });

  it('reporta el error y nunca queda en ready', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('No se pudo conectar con el servidor'));

    const { result } = renderHook(() => useReferenceData());

    await waitFor(() => expect(result.current.error).toBe('No se pudo conectar con el servidor'));
    expect(result.current.ready).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('no pide nada cuando la pantalla declara que no lo necesita', async () => {
    const { result } = renderHook(() => useReferenceData({ enabled: false }));

    await act(async () => {});

    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.ready).toBe(false);
  });
});
