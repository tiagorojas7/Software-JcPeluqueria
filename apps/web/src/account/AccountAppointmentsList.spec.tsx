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
});
