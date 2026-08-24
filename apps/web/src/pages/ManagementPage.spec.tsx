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

const BARBERS_RESPONSE = { barbers: [{ id: 'b1', name: 'Cristian Gómez' }] };
const SERVICES_RESPONSE = {
  services: [{ id: 's1', name: 'Corte clásico', durationMinutes: 30, priceCents: 800000 }],
};
const CLIENTS_RESPONSE = {
  clients: [{ id: 'c1', name: 'Juan Perez', phone: '3511234567', email: null, age: 30 }],
};

/**
 * datos-reales-en-ui — the barber/schedule/pricing sections used to default
 * their selects from `shared/demo-data.ts`; now they fetch `GET /barbers`/
 * `GET /services` up front (mount effect, owner only — the secretary has
 * none of those three permissions). Every test mocks `apiGet` by path so
 * that fetch resolves the same real-looking way in every scenario.
 */
function mockReferenceData() {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/barbers') {
      return Promise.resolve(BARBERS_RESPONSE);
    }
    if (path === '/services') {
      return Promise.resolve(SERVICES_RESPONSE);
    }
    if (path === '/panel/clients') {
      return Promise.resolve(CLIENTS_RESPONSE);
    }
    return Promise.reject(new Error(`unexpected apiGet path in test: ${path}`));
  });
}

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
    mockReferenceData();
  });

  it('el dueno ve las cuatro secciones', async () => {
    render(<ManagementPage actor={OWNER} />);

    expect(screen.getByRole('heading', { name: /clientes/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /barberos/i })).toBeInTheDocument();
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
    render(<ManagementPage actor={SECRETARY} />);

    fireEvent.click(screen.getByRole('button', { name: /cargar clientes/i }));

    expect(await screen.findByText('Juan Perez')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/panel/clients');
  });

  it('da de alta un barbero con nombre y una semana completa de horario base, en un solo pedido', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 'new-barber', name: 'Nuevo Barbero', active: true });
    const { container } = render(<ManagementPage actor={OWNER} />);

    // Scoped by id (mgmt-barber-week-*, WeekScheduleFields' own idPrefix for
    // this section) rather than by label text: SchedulesSection renders its
    // OWN "Lunes"/"Martes"/... checkboxes on the same page, so plain label
    // text would be ambiguous between the two sections.
    fireEvent.change(await screen.findByLabelText(/nombre del barbero/i), { target: { value: 'Nuevo Barbero' } });
    fireEvent.click(container.querySelector('#mgmt-barber-week-1-enabled')!);
    fireEvent.click(container.querySelector('#mgmt-barber-week-2-enabled')!);
    fireEvent.click(container.querySelector('#mgmt-barber-week-3-enabled')!);
    fireEvent.click(container.querySelector('#mgmt-barber-week-4-enabled')!);
    fireEvent.click(container.querySelector('#mgmt-barber-week-5-enabled')!);
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }));

    expect(await screen.findByText(/nuevo barbero.*dado de alta/i)).toBeInTheDocument();
    // Un solo POST con las cinco filas — no cinco llamadas separadas. Los
    // horarios quedan en el default (09:00-18:00) porque el test nunca los
    // toca, y eso es exactamente lo que se manda.
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith('/panel/barbers', {
      name: 'Nuevo Barbero',
      schedule: [
        { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
        { dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' },
        { dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' },
        { dayOfWeek: 4, opensAt: '09:00', closesAt: '18:00' },
        { dayOfWeek: 5, opensAt: '09:00', closesAt: '18:00' },
      ],
    });
  });

  it('no da de alta un barbero sin al menos un dia de trabajo elegido', async () => {
    render(<ManagementPage actor={OWNER} />);

    fireEvent.change(await screen.findByLabelText(/nombre del barbero/i), { target: { value: 'Sin Dias' } });
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }));

    expect(await screen.findByText(/eleg.\s*al menos un d.a de trabajo/i)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('da de baja un barbero existente', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ deactivated: true });
    render(<ManagementPage actor={OWNER} />);

    fireEvent.click(await screen.findByRole('button', { name: /dar de baja/i }));

    expect(await screen.findByText(/barbero dado de baja/i)).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith('/panel/barbers/b1/deactivate');
  });

  it('configura la semana completa de un barbero existente en un solo pedido — el bug que reporto el dueno', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ configured: true });
    const { container } = render(<ManagementPage actor={OWNER} />);

    // Two "Horarios" sections would collide on plain label text ("Lunes",
    // "Abre", "Cierra" repeat per day) — scoped to this section's own ids,
    // same idPrefix WeekScheduleFields uses (mgmt-schedule-week-*).
    await screen.findByRole('heading', { name: /horarios/i });
    fireEvent.click(container.querySelector('#mgmt-schedule-week-2-enabled')!);
    fireEvent.change(container.querySelector('#mgmt-schedule-week-2-opens')!, { target: { value: '10:00' } });
    fireEvent.change(container.querySelector('#mgmt-schedule-week-2-closes')!, { target: { value: '19:00' } });
    fireEvent.click(container.querySelector('#mgmt-schedule-week-4-enabled')!);
    fireEvent.click(screen.getByRole('button', { name: /guardar horario/i }));

    expect(await screen.findByText(/horario actualizado/i)).toBeInTheDocument();
    // Antes: una llamada PUT por dia (hasta cinco). Ahora: una sola, con
    // todos los dias elegidos adentro — la causa exacta del bug reportado
    // ("al dar de alta un barbero... no se estan cargando correctamente los
    // horarios").
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(apiPut).toHaveBeenCalledWith('/panel/barbers/b1/schedule/week', {
      schedule: [
        { dayOfWeek: 2, opensAt: '10:00', closesAt: '19:00' },
        { dayOfWeek: 4, opensAt: '09:00', closesAt: '18:00' },
      ],
    });
  });

  it('no guarda un horario sin al menos un dia de trabajo elegido', async () => {
    render(<ManagementPage actor={OWNER} />);

    await screen.findByRole('button', { name: /guardar horario/i });
    fireEvent.click(screen.getByRole('button', { name: /guardar horario/i }));

    expect(await screen.findByText(/eleg.\s*al menos un d.a de trabajo/i)).toBeInTheDocument();
    expect(apiPut).not.toHaveBeenCalledWith('/panel/barbers/b1/schedule/week', expect.anything());
  });

  it('configura el precio de un servicio en centavos', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ configured: true });
    render(<ManagementPage actor={OWNER} />);

    fireEvent.change(await screen.findByLabelText(/precio \(ars\)/i), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: /actualizar precio/i }));

    expect(await screen.findByText(/precio actualizado/i)).toBeInTheDocument();
    expect(apiPut).toHaveBeenCalledWith('/panel/services/s1/price', { priceCents: 900000 });
  });

  it('si la carga de referencia falla, muestra el error en vez de secciones vacias', async () => {
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/barbers' || path === '/services') {
        return Promise.reject(new Error('No se pudo conectar con el servidor'));
      }
      return Promise.reject(new Error(`unexpected apiGet path in test: ${path}`));
    });
    render(<ManagementPage actor={OWNER} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo conectar/i);
    expect(screen.queryByLabelText(/nombre del barbero/i)).toBeNull();
  });
});
