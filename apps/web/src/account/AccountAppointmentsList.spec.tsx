import type { AccountAppointmentResponse } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountAppointmentsList } from './AccountAppointmentsList';
import { nowMs } from '../shared/now';

// cablear-el-mvp Slice C (C.3/C.5): "Mi cuenta" shows every one of the
// client's own turnos (any status — client-booking spec is silent on status
// filtering, see `AppointmentRepository.findByClientId`'s own doc comment)
// and offers "Cancelar" only on a `reservado` one: showing it on an
// already-`cancelado`/`realizado` row would just produce a guaranteed
// `not-cancellable` round trip for no reason. Purely presentational — never
// calls the API itself, same container/presentational split `DayBoard`
// already established.
//
// panel-usable: "Cancelar" no longer calls `onCancel` straight away — it
// opens a confirmation step first, telling the client whether they are still
// inside SelfCancelAppointmentUseCase's 1-hour self-cancel window (and, if
// so, that a settled deposit refunds automatically) BEFORE they commit,
// instead of only finding out after the request comes back.
vi.mock('../shared/now', () => ({ nowMs: vi.fn() }));

function buildAppointment(overrides: Partial<AccountAppointmentResponse> = {}): AccountAppointmentResponse {
  return {
    id: 'appt-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    serviceName: 'Corte + Barba',
    barberName: 'Cristian Gómez',
    status: 'reservado',
    startsAt: '2026-09-01T17:00:00.000Z',
    endsAt: '2026-09-01T17:30:00.000Z',
    ...overrides,
  };
}

describe('AccountAppointmentsList', () => {
  beforeEach(() => {
    // 2h before a 17:00Z turno — comfortably inside the 1-hour window
    // (cutoff is 16:00Z) unless a test overrides it.
    vi.mocked(nowMs).mockReturnValue(Date.parse('2026-09-01T15:00:00.000Z'));
  });

  it('muestra un mensaje cuando el cliente todavia no tiene turnos', () => {
    render(<AccountAppointmentsList appointments={[]} onCancel={() => {}} />);

    expect(screen.getByText(/todavía no tenés turnos/i)).toBeInTheDocument();
  });

  it('lista cada turno con su estado y hora local de la tienda (-03:00)', () => {
    render(
      <AccountAppointmentsList
        appointments={[buildAppointment({ status: 'realizado', startsAt: '2026-09-01T17:00:00.000Z' })]}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('Realizado')).toBeInTheDocument();
    expect(screen.getByText('14:00')).toBeInTheDocument();
  });

  // A list that showed only `HH:mm` gave two turnos on different days the
  // same label. The client cannot tell which one they are about to cancel.
  it('shows the date next to the time, so two turnos are never the same row twice', () => {
    render(
      <AccountAppointmentsList
        appointments={[
          buildAppointment({ id: 'a-1', startsAt: '2026-05-15T12:00:00.000Z' }),
          buildAppointment({ id: 'a-2', startsAt: '2026-05-16T12:00:00.000Z' }),
        ]}
        onCancel={() => {}}
      />,
    );

    // La fecha ahora se escribe como la diría una persona ("viernes 15 de
    // mayo"), no en DD/MM: el punto del test sigue siendo el mismo, que la
    // fecha distinga dos turnos de la misma hora.
    expect(screen.getByText(/viernes 15 de mayo/i)).toBeInTheDocument();
    expect(screen.getByText(/s.bado 16 de mayo/i)).toBeInTheDocument();
    // Both turnos are at the same hour: the date is the only thing telling
    // them apart, which is the whole point.
    expect(screen.getAllByText('09:00')).toHaveLength(2);
  });

  it('muestra el boton Cancelar unicamente para un turno reservado', () => {
    render(
      <AccountAppointmentsList
        appointments={[
          buildAppointment({ id: 'reservado-1', status: 'reservado' }),
          buildAppointment({ id: 'cancelado-1', status: 'cancelado' }),
          buildAppointment({ id: 'realizado-1', status: 'realizado' }),
        ]}
        onCancel={() => {}}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Cancelar' })).toHaveLength(1);
  });

  it('al hacer clic en Cancelar, pide confirmacion en vez de cancelar directamente', () => {
    const onCancel = vi.fn();
    render(<AccountAppointmentsList appointments={[buildAppointment()]} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar cancelación' })).toBeInTheDocument();
  });

  it('dentro de la ventana de 1h, avisa que la sena se reembolsa automaticamente antes de confirmar', () => {
    render(<AccountAppointmentsList appointments={[buildAppointment()]} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByText(/toda.*a tiempo.*reembolsa autom.ticamente/i)).toBeInTheDocument();
  });

  it('fuera de la ventana de 1h, avisa que ya no se puede cancelar y no ofrece confirmar', () => {
    // 16:30Z is 30 minutes before a 17:00Z turno — past the 16:00Z cutoff.
    vi.mocked(nowMs).mockReturnValue(Date.parse('2026-09-01T16:30:00.000Z'));
    render(<AccountAppointmentsList appointments={[buildAppointment()]} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/ya pas. el l.mite de 60 minutos/i);
    expect(screen.queryByRole('button', { name: 'Confirmar cancelación' })).not.toBeInTheDocument();
  });

  it('Volver cierra la confirmacion sin cancelar nada', () => {
    const onCancel = vi.fn();
    render(<AccountAppointmentsList appointments={[buildAppointment()]} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('reenvia exactamente el id del turno confirmado, nunca otro', () => {
    const onCancel = vi.fn();
    render(
      <AccountAppointmentsList
        appointments={[
          buildAppointment({ id: 'appt-a', status: 'reservado' }),
          buildAppointment({ id: 'appt-b', status: 'reservado' }),
        ]}
        onCancel={onCancel}
      />,
    );

    const [, secondCancelButton] = screen.getAllByRole('button', { name: 'Cancelar' });
    if (!secondCancelButton) {
      throw new Error('expected two "Cancelar" buttons');
    }
    fireEvent.click(secondCancelButton);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));

    expect(onCancel).toHaveBeenCalledWith('appt-b');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // docs/HUECOS-BACKEND.md #7: sin esto el cliente veia fecha, hora y estado
  // pero nunca QUE reservo ni CON QUIEN, en la pantalla donde decide si
  // cancelar.
  it('dice qué se reservó y con qué barbero', () => {
    render(
      <AccountAppointmentsList appointments={[buildAppointment()]} onCancel={() => {}} />,
    );

    expect(screen.getByText('Corte + Barba')).toBeInTheDocument();
    expect(screen.getByText(/cristian g.mez/i)).toBeInTheDocument();
  });
});

// El dueño abrió su cuenta y encontró 44 turnos apilados sin ningún orden:
// "se puede perder fácilmente". Lo que una persona va a buscar a esta
// pantalla es UNA cosa — cuándo es su próximo turno — y recién después, tal
// vez, su historial.
describe('AccountAppointmentsList — orden y foco', () => {
  const AHORA = Date.parse('2026-09-01T15:00:00.000Z');

  beforeEach(() => {
    vi.mocked(nowMs).mockReturnValue(AHORA);
  });

  const futuro1 = buildAppointment({ id: 'f1', startsAt: '2026-09-02T13:00:00.000Z', endsAt: '2026-09-02T13:30:00.000Z' });
  const futuro2 = buildAppointment({ id: 'f2', startsAt: '2026-09-10T13:00:00.000Z', endsAt: '2026-09-10T13:30:00.000Z' });
  const pasado1 = buildAppointment({ id: 'p1', status: 'realizado', startsAt: '2026-08-20T13:00:00.000Z', endsAt: '2026-08-20T13:30:00.000Z' });
  const pasado2 = buildAppointment({ id: 'p2', status: 'cancelado', startsAt: '2026-08-25T13:00:00.000Z', endsAt: '2026-08-25T13:30:00.000Z' });

  it('destaca el proximo turno arriba de todo', () => {
    render(<AccountAppointmentsList appointments={[pasado1, futuro2, futuro1, pasado2]} onCancel={vi.fn()} />);

    const destacado = screen.getByRole('region', { name: /tu pr.ximo turno/i });
    // El más cercano de los dos futuros, no el primero de la lista.
    expect(destacado).toHaveTextContent(/mi.rcoles 2 de septiembre/i);
  });

  it('separa los proximos del historial, y no los mezcla', () => {
    render(<AccountAppointmentsList appointments={[pasado1, futuro2, futuro1, pasado2]} onCancel={vi.fn()} />);

    const proximos = screen.getByRole('region', { name: /^pr.ximos turnos$/i });
    const historial = screen.getByRole('region', { name: /historial/i });

    expect(proximos).toHaveTextContent(/10 de septiembre/i);
    expect(proximos).not.toHaveTextContent(/agosto/i);
    expect(historial).toHaveTextContent(/agosto/i);
  });

  it('los proximos van del mas cercano al mas lejano', () => {
    render(<AccountAppointmentsList appointments={[futuro2, futuro1]} onCancel={vi.fn()} />);

    const fechas = screen.getAllByTestId('appointment-date').map((el) => el.textContent);
    expect(fechas[0]).toMatch(/2 de septiembre/i);
    expect(fechas[1]).toMatch(/10 de septiembre/i);
  });

  it('el historial va del mas reciente al mas viejo: lo ultimo que pasó, primero', () => {
    render(<AccountAppointmentsList appointments={[pasado1, pasado2]} onCancel={vi.fn()} />);

    const fechas = screen.getAllByTestId('appointment-date').map((el) => el.textContent);
    expect(fechas[0]).toMatch(/25 de agosto/i);
    expect(fechas[1]).toMatch(/20 de agosto/i);
  });

  it('sin turnos futuros, no promete un proximo turno que no existe', () => {
    render(<AccountAppointmentsList appointments={[pasado1]} onCancel={vi.fn()} />);

    expect(screen.queryByRole('region', { name: /tu pr.ximo turno/i })).toBeNull();
    expect(screen.getByText(/no ten.s ning.n turno agendado/i)).toBeInTheDocument();
  });

  it('permite filtrar el historial por estado', () => {
    render(<AccountAppointmentsList appointments={[pasado1, pasado2]} onCancel={vi.fn()} />);

    const historial = screen.getByRole('region', { name: /historial/i });
    expect(historial).toHaveTextContent(/20 de agosto/i);

    fireEvent.change(screen.getByLabelText(/mostrar/i), { target: { value: 'cancelado' } });

    expect(screen.getByRole('region', { name: /historial/i })).not.toHaveTextContent(/20 de agosto/i);
    expect(screen.getByRole('region', { name: /historial/i })).toHaveTextContent(/25 de agosto/i);
  });

  it('escribe la fecha como la diria una persona, no en DD/MM', () => {
    render(<AccountAppointmentsList appointments={[futuro1]} onCancel={vi.fn()} />);

    expect(screen.getByTestId('appointment-date')).toHaveTextContent(/mi.rcoles 2 de septiembre/i);
  });
});
