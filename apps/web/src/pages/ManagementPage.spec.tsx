import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet, apiPost, apiPut } from '../shared/api-client';
import { ManagementPage } from './ManagementPage';

vi.mock('../shared/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

const OWNER = { userId: 'u1', role: 'owner' as const, barberId: null };
const SECRETARY = { userId: 'u2', role: 'secretary' as const, barberId: null };

// D.3/D.6 — `client:manage`/`barber:manage`/`schedule:configure`/
// `pricing:configure` already have real, tested backend endpoints
// (`ManageClientsAndBarbersController`) with no screen at all before this
// slice. Built for real here, gated section-by-section by the SAME
// permission map the nav uses — never a page-level "if role === 'owner'"
// either.

describe('ManagementPage (D.3)', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset();
  });

  it('el dueno ve las cuatro secciones', () => {
    render(<ManagementPage actor={OWNER} />);

    expect(screen.getByRole('heading', { name: /clientes/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /barberos/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /horarios/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /precios/i })).toBeInTheDocument();
  });

  it('la secretaria solo ve la seccion de clientes', () => {
    render(<ManagementPage actor={SECRETARY} />);

    expect(screen.getByRole('heading', { name: /clientes/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /barberos/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /horarios/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /precios/i })).toBeNull();
  });

  it('carga y muestra la lista de clientes', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({
      clients: [{ id: 'c1', name: 'Juan Perez', phone: '3511234567', email: null, age: 30 }],
    });
    render(<ManagementPage actor={SECRETARY} />);

    fireEvent.click(screen.getByRole('button', { name: /cargar clientes/i }));

    expect(await screen.findByText('Juan Perez')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/panel/clients');
  });

  it('da de alta un barbero con nombre y un dia de horario base', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 'new-barber', name: 'Nuevo Barbero', active: true });
    render(<ManagementPage actor={OWNER} />);

    fireEvent.change(screen.getByLabelText(/nombre del barbero/i), { target: { value: 'Nuevo Barbero' } });
    fireEvent.change(screen.getByLabelText(/dia \(alta\)/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/abre \(alta\)/i), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText(/cierra \(alta\)/i), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }));

    expect(await screen.findByText(/nuevo barbero.*dado de alta/i)).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith('/panel/barbers', {
      name: 'Nuevo Barbero',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
    });
  });

  it('da de baja un barbero existente', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ deactivated: true });
    render(<ManagementPage actor={OWNER} />);

    fireEvent.click(screen.getByRole('button', { name: /dar de baja/i }));

    expect(await screen.findByText(/barbero dado de baja/i)).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith(
      expect.stringMatching(/^\/panel\/barbers\/.+\/deactivate$/),
    );
  });

  it('configura el horario base de un barbero existente', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ configured: true });
    render(<ManagementPage actor={OWNER} />);

    fireEvent.change(screen.getByLabelText(/dia \(horario\)/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/abre \(horario\)/i), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText(/cierra \(horario\)/i), { target: { value: '19:00' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar horario/i }));

    expect(await screen.findByText(/horario actualizado/i)).toBeInTheDocument();
    expect(apiPut).toHaveBeenCalledWith(
      expect.stringMatching(/^\/panel\/barbers\/.+\/schedule$/),
      { dayOfWeek: 2, opensAt: '10:00', closesAt: '19:00' },
    );
  });

  it('configura el precio de un servicio en centavos', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ configured: true });
    render(<ManagementPage actor={OWNER} />);

    fireEvent.change(screen.getByLabelText(/precio \(ars\)/i), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: /actualizar precio/i }));

    expect(await screen.findByText(/precio actualizado/i)).toBeInTheDocument();
    expect(apiPut).toHaveBeenCalledWith(
      expect.stringMatching(/^\/panel\/services\/.+\/price$/),
      { priceCents: 900000 },
    );
  });
});
