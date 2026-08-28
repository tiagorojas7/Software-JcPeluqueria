import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiDelete, apiGet, apiPost, apiPut } from '../shared/api-client';
import { ManagementPage } from './ManagementPage';

vi.mock('../shared/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));


/** `checked` sin nombrar `HTMLInputElement`: ese global no existe en el
 *  entorno de lint del repo, y el tipo no aporta nada al test. */
function isChecked(container: { querySelector(s: string): unknown }, selector: string): boolean {
  const input = container.querySelector(selector);
  return Boolean(input && (input as { checked?: boolean }).checked);
}

const OWNER = { userId: 'u1', role: 'owner' as const, barberId: null };
const SECRETARY = { userId: 'u2', role: 'secretary' as const, barberId: null };

const BARBERS_RESPONSE = { barbers: [{ id: 'b1', name: 'Cristian Gómez' }] };
// La tabla de gestión de barberos (GET /panel/barbers) es un fetch propio,
// independiente de useReferenceData — trae TODOS los barberos, activos e
// inactivos, a diferencia de GET /barbers (solo activos, para los pickers).
// Nombres deliberadamente DISTINTOS de los de BARBER_ACCOUNTS_RESPONSE y
// BARBERS_RESPONSE: "Cristian Gómez" aparece también como <option> del
// selector de Horarios y como fila de Cuentas de barberos, así que
// reutilizar ese nombre acá volvería ambiguo cualquier `getByText`.
const BARBERS_MANAGEMENT_RESPONSE = {
  barbers: [
    { id: 'b1', name: 'Marcos Aguirre', active: true, permanentLeave: false, canDelete: true },
    { id: 'b2', name: 'Lucia Fernandez', active: false, permanentLeave: false, canDelete: true },
    { id: 'b3', name: 'Pedro Diaz', active: false, permanentLeave: true, canDelete: false },
  ],
};
const SERVICES_RESPONSE = {
  services: [{ id: 's1', name: 'Corte clásico', durationMinutes: 30, priceCents: 800000 }],
};
// Cristian trabaja lunes, miercoles y viernes — NO los siete dias.
const BARBER_WEEK_RESPONSE = {
  days: [
    { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
    { dayOfWeek: 3, opensAt: '10:00', closesAt: '19:00' },
    { dayOfWeek: 5, opensAt: '09:00', closesAt: '18:00' },
  ],
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
    if (path === '/panel/barbers') {
      return Promise.resolve(BARBERS_MANAGEMENT_RESPONSE);
    }
    if (path === '/panel/barbers/b1/schedule') {
      return Promise.resolve(BARBER_WEEK_RESPONSE);
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
    // Exact string, not /barberos/i: "Cuentas de barberos" is now mounted
    // just as eagerly (its own independent fetch, same as this section),
    // and the loose regex would match both headings at once.
    expect(await screen.findByRole('heading', { name: 'Barberos' })).toBeInTheDocument();
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

  // 10s: five checkbox clicks re-render the whole four-section page under
  // jsdom — ~4.2s alone on this machine, over the 5s default once the rest
  // of the file shares the run.
  it('da de alta un barbero con nombre y una semana completa de horario base, en un solo pedido', { timeout: 10_000 }, async () => {
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

  // La seccion ahora abre con la semana REAL del barbero marcada, asi que
  // llegar a "ningun dia" es un acto deliberado: destildar los tres que
  // trabaja. La regla que se prueba sigue siendo la misma.
  it('no guarda un horario sin al menos un dia de trabajo elegido', async () => {
    const { container } = render(<ManagementPage actor={OWNER} />);

    await screen.findByRole('button', { name: /guardar horario/i });
    await waitFor(() =>
      expect(isChecked(container, '#mgmt-schedule-week-1-enabled')).toBe(true),
    );
    fireEvent.click(container.querySelector('#mgmt-schedule-week-1-enabled')!);
    fireEvent.click(container.querySelector('#mgmt-schedule-week-3-enabled')!);
    fireEvent.click(container.querySelector('#mgmt-schedule-week-5-enabled')!);
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

  // La propia app muestra los precios como "$8.000" (formatPriceArs), asi que
  // el duenio los tipea igual — y Number("8.000") es 8: el precio quedaba en
  // $8 sin ningun aviso. La notacion argentina tiene que guardarse bien.
  it('entiende "8.000" como ocho mil pesos, no como ocho', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({ configured: true });
    render(<ManagementPage actor={OWNER} />);

    fireEvent.change(await screen.findByLabelText(/precio \(ars\)/i), { target: { value: '8.000' } });
    fireEvent.click(screen.getByRole('button', { name: /actualizar precio/i }));

    expect(await screen.findByText(/precio actualizado/i)).toBeInTheDocument();
    expect(apiPut).toHaveBeenCalledWith('/panel/services/s1/price', { priceCents: 800000 });
  });

  it('muestra en vivo como se interpreta el precio antes de guardar', async () => {
    render(<ManagementPage actor={OWNER} />);

    fireEvent.change(await screen.findByLabelText(/precio \(ars\)/i), { target: { value: '8.000' } });

    expect(screen.getByText(/se guarda como/i)).toHaveTextContent('$8.000');
  });

  it('rechaza un precio ilegible sin llamar a la API', async () => {
    render(<ManagementPage actor={OWNER} />);

    fireEvent.change(await screen.findByLabelText(/precio \(ars\)/i), { target: { value: '8.50' } });
    fireEvent.click(screen.getByRole('button', { name: /actualizar precio/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se entendi/i);
    expect(apiPut).not.toHaveBeenCalledWith('/panel/services/s1/price', expect.anything());
  });

  it('si la carga de referencia falla, muestra el error en vez de secciones vacias', async () => {
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/panel/barber-accounts') {
        // Its own independent fetch — kept working so this test observes the
        // reference-data failure alone.
        return Promise.resolve({ accounts: [] });
      }
      if (path === '/panel/barbers') {
        // Also its own independent fetch (BarbersSection), same reason.
        return Promise.resolve({ barbers: [] });
      }
      return Promise.reject(new Error('No se pudo conectar con el servidor'));
    });
    render(<ManagementPage actor={OWNER} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo conectar/i);
    // "Barberos" (its own independent fetch, like "Cuentas de barberos")
    // stays usable regardless — only the sections that genuinely depend on
    // this reference data (Horarios, Precios) must stay empty.
    expect(screen.queryByLabelText(/precio \(ars\)/i)).toBeNull();
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

  // Las cuatro situaciones de una cuenta de barbero se distinguian solo por
  // el texto en una celda. Quien administra escanea esta tabla para saber a
  // quien le falta acceso: el estado tiene que verse antes de leerlo, y la
  // diferencia no puede quedar solo en el color.
  it('marca el estado de cada cuenta como dato, no solo como texto', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByRole('heading', { name: /cuentas de barberos/i });

    expect(screen.getByText(/sin cuenta/i)).toHaveAttribute('data-state', 'sin-cuenta');
    expect(screen.getByText('Activa')).toHaveAttribute('data-state', 'activa');
  });
});

// Horarios abria SIEMPRE con la semana en blanco: la secretaria tenia que
// acordarse de memoria que dias atendia cada barbero, y como guardar manda
// la semana entera, cualquier dia que no recordara se borraba en silencio.
describe('ManagementPage — Horarios precarga la semana del barbero', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPut).mockReset();
    mockReferenceData();
  });

  it('marca los dias que el barbero ya trabaja al abrir la seccion', async () => {
    const { container } = render(<ManagementPage actor={OWNER} />);

    await screen.findByRole('heading', { name: /horarios/i });
    await waitFor(() =>
      expect(isChecked(container, '#mgmt-schedule-week-1-enabled')).toBe(true),
    );

    expect(isChecked(container, '#mgmt-schedule-week-3-enabled')).toBe(true);
    expect(isChecked(container, '#mgmt-schedule-week-5-enabled')).toBe(true);
    // Los que NO trabaja siguen apagados.
    expect(isChecked(container, '#mgmt-schedule-week-2-enabled')).toBe(false);
    expect(isChecked(container, '#mgmt-schedule-week-6-enabled')).toBe(false);
    expect(apiGet).toHaveBeenCalledWith('/panel/barbers/b1/schedule');
  });

  it('trae tambien los horarios de apertura y cierre reales de cada dia', async () => {
    const { container } = render(<ManagementPage actor={OWNER} />);

    await screen.findByRole('heading', { name: /horarios/i });
    await waitFor(() =>
      expect(isChecked(container, '#mgmt-schedule-week-3-enabled')).toBe(true),
    );

    expect((container.querySelector('#mgmt-schedule-week-3-opens') as { value?: string }).value).toBe('10:00');
    expect((container.querySelector('#mgmt-schedule-week-3-closes') as { value?: string }).value).toBe('19:00');
  });

  it('si no puede leer la semana, deja la seccion usable en vez de romperla', async () => {
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/barbers') return Promise.resolve(BARBERS_RESPONSE);
      if (path === '/services') return Promise.resolve(SERVICES_RESPONSE);
      if (path === '/panel/barber-accounts') return Promise.resolve(BARBER_ACCOUNTS_RESPONSE);
      if (path === '/panel/barbers') return Promise.resolve(BARBERS_MANAGEMENT_RESPONSE);
      return Promise.reject(new Error('no se pudo leer el horario'));
    });

    const { container } = render(<ManagementPage actor={OWNER} />);

    await screen.findByRole('heading', { name: /horarios/i });
    expect(container.querySelector('#mgmt-schedule-week-1-enabled')).toBeInTheDocument();
  });
});

// Un barbero que ya no esta seguia apareciendo para siempre en "Cuentas de
// barberos": desactivar le quita el acceso pero la fila queda. El duenio
// pidio poder eliminarla — y que sea una decision suya, no automatica.
describe('ManagementPage — eliminar la cuenta de un barbero', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiDelete).mockReset();
    mockReferenceData();
  });

  it('ofrece eliminar solo en las filas que tienen cuenta', async () => {
    render(<ManagementPage actor={OWNER} />);

    await screen.findByText('cristian@jc.test');
    // Dos cuentas reales + una fila sin cuenta (De Antes), que no puede
    // eliminar lo que no existe.
    expect(screen.getAllByRole('button', { name: /^eliminar cuenta$/i })).toHaveLength(2);
  });

  it('pide confirmacion antes de borrar y explica que pasa con el historial', async () => {
    render(<ManagementPage actor={OWNER} />);

    await screen.findByText('cristian@jc.test');
    fireEvent.click(screen.getAllByRole('button', { name: /^eliminar cuenta$/i })[0]!);

    expect(await screen.findByText(/no vas a poder deshacerlo|sus turnos quedan/i)).toBeInTheDocument();
    // Nada se borro con solo apretar el boton.
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('elimina la cuenta al confirmar y recarga la lista', async () => {
    vi.mocked(apiDelete).mockResolvedValueOnce({ deleted: true });
    render(<ManagementPage actor={OWNER} />);

    await screen.findByText('cristian@jc.test');
    fireEvent.click(screen.getAllByRole('button', { name: /^eliminar cuenta$/i })[0]!);
    fireEvent.click(await screen.findByRole('button', { name: /s., eliminar/i }));

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/panel/barber-accounts/u-cristian'));
    expect(await screen.findByText(/cuenta.*eliminada/i)).toBeInTheDocument();
  });

  it('cancelar no borra nada', async () => {
    render(<ManagementPage actor={OWNER} />);

    await screen.findByText('cristian@jc.test');
    fireEvent.click(screen.getAllByRole('button', { name: /^eliminar cuenta$/i })[0]!);
    fireEvent.click(await screen.findByRole('button', { name: /^cancelar$/i }));

    expect(apiDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /s., eliminar/i })).toBeNull();
  });
});

// Migración 0013: "active=false" ya no alcanza para distinguir una baja
// temporal (vuelve con un click, mismo horario) de una definitiva (se fue
// para siempre, se le borra la cuenta). La sección de Barberos pasa de un
// <select> de baja a una tabla con TODOS los barberos y las acciones que
// cada estado permite.
describe('ManagementPage — tabla de barberos: baja temporal, baja definitiva, eliminar', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiDelete).mockReset();
    mockReferenceData();
  });

  /** Scopes a query to the `<tr>` that contains this barber's name — the
   *  same name repeats as a `data-state` badge AND as button labels across
   *  different rows ("Baja definitiva" is both a state and a button), so
   *  most assertions here need to be per-row, not page-wide. */
  function rowFor(barberName: string) {
    const cell = screen.getByText(barberName);
    return within(cell.closest('tr')!);
  }

  it('lista todos los barberos, activos e inactivos, no solo los activos', async () => {
    render(<ManagementPage actor={OWNER} />);

    expect(await screen.findByText('Marcos Aguirre')).toBeInTheDocument();
    expect(screen.getByText('Lucia Fernandez')).toBeInTheDocument();
    expect(screen.getByText('Pedro Diaz')).toBeInTheDocument();
  });

  it('marca el estado de cada barbero como dato, no solo como texto', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Marcos Aguirre');

    expect(rowFor('Marcos Aguirre').getByText('Activo')).toHaveAttribute('data-state', 'activo');
    expect(rowFor('Lucia Fernandez').getByText('De baja temporal')).toHaveAttribute('data-state', 'baja-temporal');
    expect(rowFor('Pedro Diaz').getByText('Baja definitiva')).toHaveAttribute(
      'data-state',
      'baja-definitiva',
    );
  });

  it('un barbero activo solo puede pasar a baja temporal o baja definitiva', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Marcos Aguirre');

    const row = rowFor('Marcos Aguirre');
    expect(row.getByRole('button', { name: 'Dar de baja temporal' })).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Baja definitiva' })).toBeInTheDocument();
    expect(row.queryByRole('button', { name: 'Reactivar' })).toBeNull();
    expect(row.queryByRole('button', { name: 'Eliminar' })).toBeNull();
  });

  it('un barbero de baja temporal puede reactivarse, pasar a baja definitiva o eliminarse', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Lucia Fernandez');

    const row = rowFor('Lucia Fernandez');
    expect(row.getByRole('button', { name: 'Reactivar' })).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Baja definitiva' })).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    expect(row.queryByRole('button', { name: 'Dar de baja temporal' })).toBeNull();
  });

  it('un barbero de baja definitiva solo puede reactivarse — y eliminarse solo si no tiene turnos', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Pedro Diaz');

    const row = rowFor('Pedro Diaz');
    expect(row.getByRole('button', { name: 'Reactivar' })).toBeInTheDocument();
    // canDelete: false en la fixture — tiene turnos en el historial.
    expect(row.queryByRole('button', { name: 'Eliminar' })).toBeNull();
    expect(row.queryByRole('button', { name: 'Dar de baja temporal' })).toBeNull();
    expect(row.queryByRole('button', { name: 'Baja definitiva' })).toBeNull();
  });

  it('da de baja temporal a un barbero activo sin pedir confirmacion', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ deactivated: true });
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Marcos Aguirre');

    fireEvent.click(rowFor('Marcos Aguirre').getByRole('button', { name: 'Dar de baja temporal' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/panel/barbers/b1/deactivate'));
    expect(await screen.findByText(/queda de baja temporal/i)).toBeInTheDocument();
  });

  it('reactiva a un barbero sin pedir confirmacion — es reversible con un click', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ reactivated: true });
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Lucia Fernandez');

    fireEvent.click(rowFor('Lucia Fernandez').getByRole('button', { name: 'Reactivar' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/panel/barbers/b2/reactivate'));
    expect(await screen.findByText(/vuelve a estar activo/i)).toBeInTheDocument();
  });

  it('pide confirmacion antes de la baja definitiva y explica que sobrevive', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Marcos Aguirre');

    fireEvent.click(rowFor('Marcos Aguirre').getByRole('button', { name: 'Baja definitiva' }));

    const confirmation = await screen.findByText(/dar de baja definitiva a marcos aguirre/i);
    expect(confirmation).toHaveTextContent(/historial/i);
    expect(confirmation).toHaveTextContent(/cuenta del panel se elimina/i);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('confirma la baja definitiva y avisa que la cuenta se elimino', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ terminated: true });
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Marcos Aguirre');

    fireEvent.click(rowFor('Marcos Aguirre').getByRole('button', { name: 'Baja definitiva' }));
    fireEvent.click(await screen.findByRole('button', { name: /s., baja definitiva/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/panel/barbers/b1/terminate'));
    expect(await screen.findByText(/queda de baja definitiva/i)).toBeInTheDocument();
  });

  it('cancelar la baja definitiva no manda nada', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Marcos Aguirre');

    fireEvent.click(rowFor('Marcos Aguirre').getByRole('button', { name: 'Baja definitiva' }));
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /s., baja definitiva/i })).toBeNull();
  });

  it('pide confirmacion antes de eliminar y avisa que desaparece por completo', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Lucia Fernandez');

    fireEvent.click(rowFor('Lucia Fernandez').getByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText(/desaparece|nunca tuvo un turno/i)).toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('confirma eliminar y recarga la tabla', async () => {
    vi.mocked(apiDelete).mockResolvedValueOnce({ deleted: true });
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Lucia Fernandez');

    fireEvent.click(rowFor('Lucia Fernandez').getByRole('button', { name: 'Eliminar' }));
    fireEvent.click(await screen.findByRole('button', { name: /^s., eliminar$/i }));

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/panel/barbers/b2'));
    expect(await screen.findByText(/eliminad/i)).toBeInTheDocument();
  });

  it('cancelar eliminar no manda nada', async () => {
    render(<ManagementPage actor={OWNER} />);
    await screen.findByText('Lucia Fernandez');

    fireEvent.click(rowFor('Lucia Fernandez').getByRole('button', { name: 'Eliminar' }));
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('un error al pedir la tabla se muestra sin romper el resto del panel', async () => {
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path === '/panel/barbers') {
        return Promise.reject(new Error('no se pudo cargar la tabla de barberos'));
      }
      if (path === '/barbers') return Promise.resolve(BARBERS_RESPONSE);
      if (path === '/services') return Promise.resolve(SERVICES_RESPONSE);
      if (path === '/panel/barber-accounts') return Promise.resolve(BARBER_ACCOUNTS_RESPONSE);
      if (path === '/panel/clients') return Promise.resolve(CLIENTS_RESPONSE);
      return Promise.reject(new Error(`unexpected apiGet path in test: ${path}`));
    });
    render(<ManagementPage actor={OWNER} />);

    expect(await screen.findByText(/no se pudo cargar la tabla de barberos/i)).toBeInTheDocument();
    // El resto del panel sigue de pie — cuentas de barberos, por ejemplo.
    expect(await screen.findByText('cristian@jc.test')).toBeInTheDocument();
  });
});
