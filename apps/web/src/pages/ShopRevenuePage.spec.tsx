import type { ShopRevenueResponse } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet } from '../shared/api-client';
import { ShopRevenuePage } from './ShopRevenuePage';

vi.mock('../shared/api-client', () => ({
  apiGet: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

const OWNER = { userId: 'u1', role: 'owner' as const, barberId: null };

const DISCLAIMER =
  'Facturación teórica según precio de lista: no es la ganancia del local ni la plata efectivamente cobrada. El sistema no registra el 50% restante que se cobra en efectivo en el mostrador.';

const REVENUE: ShopRevenueResponse = {
  totalListPriceCents: 131_200_000,
  count: 128,
  disclaimer: DISCLAIMER,
  byBarber: [
    { barberId: 'b1', barberName: 'Cristian Gómez', count: 47, totalListPriceCents: 48_600_000 },
    { barberId: 'b2', barberName: 'Facundo Díaz', count: 44, totalListPriceCents: 45_800_000 },
    { barberId: 'b3', barberName: 'Nahuel Torres', count: 37, totalListPriceCents: 36_800_000 },
  ],
  byService: [
    { serviceId: 's1', serviceName: 'Corte + Barba', count: 58, totalListPriceCents: 69_600_000 },
    { serviceId: 's2', serviceName: 'Corte clásico', count: 51, totalListPriceCents: 40_800_000 },
  ],
};

async function loadPeriod() {
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-05-01' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-05-31' } });
  fireEvent.click(screen.getByRole('button', { name: /ver facturaci/i }));
}

// docs/HUECOS-BACKEND.md #5: esta pantalla era un cartel de "en
// construcción" detrás de un ítem de menú real y un permiso real. Ahora
// `GET /shop/revenue` existe.
describe('ShopRevenuePage', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockResolvedValue(REVENUE);
  });

  it('pide la facturación del período elegido', async () => {
    render(<ShopRevenuePage actor={OWNER} />);
    await loadPeriod();

    await screen.findByText(/1\.312\.000/);
    expect(apiGet).toHaveBeenCalledWith('/shop/revenue?from=2026-05-01&to=2026-05-31');
  });

  it('muestra el total, la cantidad de cortes y el ticket promedio', async () => {
    render(<ShopRevenuePage actor={OWNER} />);
    await loadPeriod();

    expect(await screen.findByText(/1\.312\.000/)).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    // 131.200.000 centavos / 128 cortes = 10.250 pesos.
    expect(screen.getByText(/10\.250/)).toBeInTheDocument();
  });

  // El README es explícito: un número ambiguo genera discusiones. La
  // aclaración se renderiza VERBATIM, nunca parafraseada por el cliente.
  it('repite la aclaración del servidor palabra por palabra', async () => {
    render(<ShopRevenuePage actor={OWNER} />);
    await loadPeriod();

    expect(await screen.findByText(DISCLAIMER)).toBeInTheDocument();
  });

  it('desglosa por barbero y por servicio', async () => {
    render(<ShopRevenuePage actor={OWNER} />);
    await loadPeriod();

    expect(await screen.findByText('Cristian Gómez')).toBeInTheDocument();
    expect(screen.getByText('Nahuel Torres')).toBeInTheDocument();
    expect(screen.getByText('Corte + Barba')).toBeInTheDocument();
  });

  // Facturación no es ganancia: el modelo de comisiones no existe todavía en
  // el sistema (README, "Trabajo futuro"), asi que la pantalla no puede
  // dejar que se lea como lo que se lleva cada uno.
  it('aclara que lo que muestra por barbero no es lo que ese barbero gana', async () => {
    render(<ShopRevenuePage actor={OWNER} />);
    await loadPeriod();

    await screen.findByText('Cristian Gómez');
    expect(screen.getByText(/no es (lo que gana|ganancia)/i)).toBeInTheDocument();
  });

  it('no muestra números hasta que se elige un período', () => {
    render(<ShopRevenuePage actor={OWNER} />);

    expect(screen.getByText(/elegí un período/i)).toBeInTheDocument();
    expect(screen.queryByText(/1\.312\.000/)).not.toBeInTheDocument();
  });

  it('muestra el error si la consulta falla, en vez de un cero enganioso', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('No se pudo conectar con el servidor'));
    render(<ShopRevenuePage actor={OWNER} />);
    await loadPeriod();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo conectar/i);
  });

  it('pide iniciar sesión cuando no hay actor', () => {
    render(<ShopRevenuePage actor={null} />);

    expect(screen.getByText(/iniciá sesión/i)).toBeInTheDocument();
  });
});
