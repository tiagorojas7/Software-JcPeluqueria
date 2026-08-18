import type { AccountAppointmentResponse } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccountAppointmentsList } from './AccountAppointmentsList';

// cablear-el-mvp Slice C (C.3/C.5): "Mi cuenta" shows every one of the
// client's own turnos (any status — client-booking spec is silent on status
// filtering, see `AppointmentRepository.findByClientId`'s own doc comment)
// and offers "Cancelar" only on a `reservado` one: showing it on an
// already-`cancelado`/`realizado` row would just produce a guaranteed
// `not-cancellable` round trip for no reason. Purely presentational — never
// calls the API itself, same container/presentational split `DayBoard`
// already established.

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

    expect(screen.getByText('realizado')).toBeInTheDocument();
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

  it('reenvia exactamente el id del turno clickeado, nunca otro', () => {
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

    expect(onCancel).toHaveBeenCalledWith('appt-b');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
