import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet, apiPost } from '../shared/api-client';
import { PhoneAppointmentPage } from './PhoneAppointmentPage';

vi.mock('../shared/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

const SECRETARY = { userId: 'u1', role: 'secretary' as const, barberId: null };

const BARBERS_RESPONSE = {
  barbers: [
    { id: 'b1', name: 'Cristian Gómez' },
    { id: 'b2', name: 'Facundo Díaz' },
  ],
};
const SERVICES_RESPONSE = {
  services: [
    { id: 's1', name: 'Corte clásico', durationMinutes: 30, priceCents: 800_000 },
    { id: 's2', name: 'Corte + Barba', durationMinutes: 45, priceCents: 1_200_000 },
  ],
};

/** The turno the endpoint answers with — raw ids and a raw status, which is
 *  exactly the shape the screen has to translate. */
const CREATED = {
  id: '5f1b9c2e-1a2b-4c3d-8e4f-000000000001',
  barberId: 'b2',
  serviceId: 's2',
  clientId: 'c1',
  status: 'reservado',
  startsAt: '2026-05-15T14:00:00.000Z',
  endsAt: '2026-05-15T14:45:00.000Z',
};

/** `StartTimeField` fetches `GET /availability` itself and renders one
 *  button per free slot, so the time is CHOSEN by clicking, never typed. */
const AVAILABILITY_RESPONSE = {
  slots: [{ startsAt: '2026-05-15T14:00:00.000Z', endsAt: '2026-05-15T14:45:00.000Z' }],
};

function mockReferenceData() {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/barbers') return Promise.resolve(BARBERS_RESPONSE);
    if (path === '/services') return Promise.resolve(SERVICES_RESPONSE);
    if (path.startsWith('/availability')) return Promise.resolve(AVAILABILITY_RESPONSE);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

async function fillAndSubmit() {
  await screen.findByLabelText('Barbero');

  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Agustín Rivas' } });
  fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '3515550142' } });
  fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'b2' } });
  fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 's2' } });
  fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-05-15' } });

  // El boton muestra la hora LOCAL del local: 14:00Z con offset -03:00 es
  // "11:00", que es lo que ve y dice quien atiende el telefono.
  fireEvent.click(await screen.findByRole('button', { name: '11:00' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar turno' }));
}

/** The page's own confirmation, named so it is never confused with
 *  `StartTimeField`'s "Hora elegida" status, which is also on screen. */
function confirmation() {
  return screen.findByRole('status', { name: 'Turno creado' });
}

// admin-operations spec, "Creación de turnos telefónicos sin seña". The
// person using this screen is on the phone with the client RIGHT NOW: what
// they need back is the sentence they are about to read out loud, not the
// row's primary key.
describe('PhoneAppointmentPage', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    mockReferenceData();
    vi.mocked(apiPost).mockResolvedValue(CREATED);
  });

  it('confirma el turno con el servicio, el barbero, la fecha y la hora', async () => {
    render(<PhoneAppointmentPage actor={SECRETARY} />);
    await fillAndSubmit();

    const created = await confirmation();
    expect(created).toHaveTextContent('Corte + Barba');
    expect(created).toHaveTextContent('Facundo Díaz');
    expect(created).toHaveTextContent('15/05');
    expect(created).toHaveTextContent('11:00');
  });

  // El uuid no le sirve a nadie del otro lado del telefono, y el valor de la
  // base tampoco es una palabra que alguien diga.
  it('no le muestra el uuid ni el estado crudo a quien atiende', async () => {
    render(<PhoneAppointmentPage actor={SECRETARY} />);
    await fillAndSubmit();

    const created = await confirmation();
    expect(created).not.toHaveTextContent(CREATED.id);
    expect(created).not.toHaveTextContent('reservado');
    expect(created).toHaveTextContent('Reservado');
  });

  // Un turno telefonico no lleva senia (admin-operations). Quien atiende
  // tiene que poder decirlo en el momento, no descubrirlo despues.
  it('aclara que el turno queda sin seña', async () => {
    render(<PhoneAppointmentPage actor={SECRETARY} />);
    await fillAndSubmit();

    expect(await confirmation()).toHaveTextContent(/sin se/i);
  });

  it('deja cargar otro turno sin recargar la pantalla', async () => {
    render(<PhoneAppointmentPage actor={SECRETARY} />);
    await fillAndSubmit();

    await confirmation();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar otro turno' }));

    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Turno creado' })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Barbero')).toBeInTheDocument();
  });
});
