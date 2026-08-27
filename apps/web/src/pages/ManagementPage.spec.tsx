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
const BARBER_ACCOUNTS_RESPONSE = {
  accounts: [
    {
      userId: 'u-cristian',
      barberId: 'b1',
      barberName: 'Cristian Gómez',
      email: 'cristian@jc.test',
      active: true,
      activated: true,
    },
    {
      userId: 'u-nuevo',
      barberId: 'b2',
      barberName: 'Nuevo Barbero',
      email: 'nuevo@jc.test',
      active: true,
      activated: false,
    },
    {
      userId: null,
      barberId: 'b3',
      barberName: 'De Antes',
      email: null,
      active: false,
      activated: false,
    },
  ],
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
    if (path === '/panel/barber-accounts') {
      return Promise.resolve(BARBER_ACCOUNTS_RESPONSE);
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
    fireEvent.change(screen.getByLabelText(/email del barbero/i), { target: { value: 'nuevo@jc.test' } });
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
      email: 'nuevo@jc.test',
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
    fireEvent.change(screen.getByLabelText(/email del barbero/i), { target: { value: 'sindias@jc.test' } });
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
      confirm: false,
    });
  });

  // docs/HUECOS-BACKEND.md #6, segunda parte: el backend puede responder que
  // NO escribio nada porque un turno reservado quedaria huerfano. Mostrar
  // "Horario actualizado" igual seria la misma mentira que el hueco #6
  // original, un piso mas arriba.
  it('pide confirmacion y NO dice "actualizado" cuando quedarian turnos huerfanos', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ configured: false, affectedAppointmentIds: ['apt-1', 'apt-2'] });
    const { container } = render(<ManagementPage actor={OWNER} />);

    await screen.findByRole('heading', { name: /horarios/i });
    fireEvent.click(container.querySelector('#mgmt-schedule-week-2-enabled')!);
    fireEvent.click(screen.getByRole('button', { name: /guardar horario/i }));

    expect(await screen.findByText(/2 turnos reservados/i)).toBeInTheDocument();
    expect(screen.queryByText(/horario actualizado/i)).not.toBeInTheDocument();
  });

  it('reenvia con confirm:true cuando el dueno confirma, y ahi si muestra exito', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ configured: false, affectedAppointmentIds: ['apt-1'] });
    const { container } = render(<ManagementPage actor={OWNER} />);

    await screen.findByRole('heading', { name: /horarios/i });
    fireEvent.click(container.querySelector('#mgmt-schedule-week-2-enabled')!);
    fireEvent.click(screen.getByRole('button', { name: /guardar horario/i }));
    await screen.findByText(/1 turno reservado/i);

    vi.mocked(apiPut).mockResolvedValueOnce({ configured: true });
    fireEvent.click(screen.getByRole('button', { name: /guardar igual/i }));

    expect(await screen.findByText(/horario actualizado/i)).toBeInTheDocument();
    expect(apiPut).toHaveBeenLastCalledWith(
      '/panel/barbers/b1/schedule/week',
      expect.objectContaining({ confirm: true }),
    );
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
      if (path === '/panel/barber-accounts') {
        // Its own independent fetch — kept working so this test observes the
        // reference-data failure alone.
        return Promise.resolve({ accounts: [] });
      }
      return Promise.reject(new Error('No se pudo conectar con el servidor'));
    });
    render(<ManagementPage actor={OWNER} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo conectar/i);
    expect(screen.queryByLabelText(/nombre del barbero/i)).toBeNull();
  });
});

// README section 3.9 + the owner's own words: "la cuenta de cada barbero y
// tener todo el control sobre las cuentas para que ingresen". The alta used
// to create a barber who showed up in the agenda with no way to log in; these
// cases pin BOTH halves of the owner's control — and its limit.
describe('ManagementPage — cuentas de barberos', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset();
    mockReferenceData();
  });

  it('lists every barber account and singles out the one that never activated', async () => {
    render(<ManagementPage actor={OWNER} />);

    expect(await screen.findByRole('heading', { name: /cuentas de barberos/i })).toBeInTheDocument();
    expect(screen.getByText('cristian@jc.test')).toBeInTheDocument();
    // The state worth chasing: invited, never used. Invisible everywhere
    // else — the barber shows up in the agenda regardless.
    expect(screen.getByText(/sin activar/i)).toBeInTheDocument();
  });

  it('never shows a password field, in either direction — the owner controls the account, not the credential', async () => {
    const { container } = render(<ManagementPage actor={OWNER} />);
    await screen.findByRole('heading', { name: /cuentas de barberos/i });

    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByLabelText(/contrase/i)).toBeNull();
  });

  it('hides the whole section from the secretary — barber:manage is owner-only', () => {
    render(<ManagementPage actor={SECRETARY} />);

    expect(screen.queryByRole('heading', { name: /cuentas de barberos/i })).toBeNull();
    expect(apiGet).not.toHaveBeenCalledWith('/panel/barber-accounts');
  });

  it('resends the invite to a barber who never activated', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ sent: true });
    render(<ManagementPage actor={OWNER} />);
    await screen.findByRole('heading', { name: /cuentas de barberos/i });

    fireEvent.click(screen.getByRole('button', { name: /reenviar invitaci/i }));

    expect(await screen.findByText(/reenviamos la invitaci/i)).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith('/panel/barber-accounts/u-nuevo/resend-invite');
  });

  it('resets an activated barber password through the SAME endpoint — one write, not two', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ sent: true });
    render(<ManagementPage actor={OWNER} />);
    await screen.findByRole('heading', { name: /cuentas de barberos/i });

    fireEvent.click(screen.getByRole('button', { name: /resetear contrase/i }));

    expect(apiPost).toHaveBeenCalledWith('/panel/barber-accounts/u-cristian/resend-invite');
    // What the owner is told is that the barber picks the new one, never
    // what it is: there is nothing here for the owner to read out loud.
    expect(await screen.findByText(/elegir una contrase.a nueva/i)).toBeInTheDocument();
  });

  it('revokes access without touching the barber turnos', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ active: false });
    render(<ManagementPage actor={OWNER} />);
    await screen.findByRole('heading', { name: /cuentas de barberos/i });

    fireEvent.click(screen.getAllByRole('button', { name: /quitar acceso/i })[0]!);

    expect(apiPost).toHaveBeenCalledWith('/panel/barber-accounts/u-cristian/active', { active: false });
    expect(await screen.findByText(/sus turnos no cambian/i)).toBeInTheDocument();
  });
});

// The gap the real shop exposed: six barbers were already on file from before
// the alta created accounts. The screen listed ACCOUNTS, so those six were
// invisible on the only page that can give them access.
describe('ManagementPage — barberos que todavia no tienen cuenta', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset();
    mockReferenceData();
  });

  it('shows the barber with no account at all, and says plainly that they cannot get in', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByRole('heading', { name: /cuentas de barberos/i });

    expect(screen.getByText('De Antes')).toBeInTheDocument();
    expect(screen.getByText(/sin cuenta — no puede entrar/i)).toBeInTheDocument();
  });

  it('creates the account for that barber with the email the owner types', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ userId: 'u-de-antes' });
    render(<ManagementPage actor={OWNER} />);
    await screen.findByRole('heading', { name: /cuentas de barberos/i });

    fireEvent.change(screen.getByLabelText(/email de de antes/i), { target: { value: 'deantes@jc.test' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cuenta e invitar/i }));

    expect(apiPost).toHaveBeenCalledWith('/panel/barber-accounts', {
      barberId: 'b3',
      email: 'deantes@jc.test',
    });
    expect(await screen.findByText(/le mandamos a deantes@jc.test/i)).toBeInTheDocument();
  });

  it('refuses to invite with an empty email instead of sending a broken request', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByRole('heading', { name: /cuentas de barberos/i });

    fireEvent.click(screen.getByRole('button', { name: /crear cuenta e invitar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/escrib. el email de de antes/i);
    expect(apiPost).not.toHaveBeenCalled();
  });
});
