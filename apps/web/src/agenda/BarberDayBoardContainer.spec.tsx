import type { DayBoardResponse } from '@jc-barberia/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BarberDayBoardContainer } from './BarberDayBoardContainer';

const dayBoard: DayBoardResponse = {
  date: '2026-08-20',
  columns: [
    { barberId: 'barber-own', barberName: 'Juan' },
    { barberId: 'barber-colleague', barberName: 'Ana' },
  ],
  slots: [
    {
      id: 'slot-own',
      barberId: 'barber-own',
      serviceId: 'service-1',
      status: 'reservado',
      startsAt: '2026-08-20T12:00:00.000Z',
      endsAt: '2026-08-20T12:30:00.000Z',
      clientName: 'Marcos',
      clientAge: 34,
      allowedActions: ['mark-completed'],
    },
    {
      id: 'slot-colleague',
      barberId: 'barber-colleague',
      serviceId: 'service-2',
      status: 'reservado',
      startsAt: '2026-08-20T13:00:00.000Z',
      endsAt: '2026-08-20T13:30:00.000Z',
      clientName: 'Otro Cliente',
      allowedActions: ['mark-completed'],
    },
  ],
};

// barber-profile spec, "Agenda propia filtrada":
//
//   Scenario: Barbero ve su agenda con edad cargada
//     GIVEN un turno del propio barbero con la edad del cliente cargada
//     WHEN el barbero abre su agenda del día
//     THEN ve el turno con el nombre y la edad del cliente
//
//   Scenario: Barbero no accede a la agenda de un colega
//     GIVEN turnos agendados para otro barbero el mismo día
//     WHEN el barbero autenticado consulta su agenda
//     THEN el sistema MUST NOT incluir esos turnos ni datos del colega
//
// The day-board endpoint already narrows server-side (task 8.7), but this
// container does NOT simply trust the fetched payload the way
// AdminDayBoardContainer does — for the barber-facing surface specifically,
// blindly rendering whatever `dayBoard` contains would turn any future
// server-side regression into an immediate leak of a colleague's client
// data. Filtering to `barberId` here is defense in depth, not redundant
// trust of the server.
describe('BarberDayBoardContainer', () => {
  it("shows the barber's own column with the client's name and age", () => {
    render(<BarberDayBoardContainer dayBoard={dayBoard} barberId="barber-own" onSlotAction={() => {}} />);

    const ownColumn = screen.getByRole('region', { name: 'Juan' });
    expect(within(ownColumn).getByText('Marcos (34)')).toBeInTheDocument();
  });

  it('never renders a colleague column or slot, even if the fetched payload included one', () => {
    render(<BarberDayBoardContainer dayBoard={dayBoard} barberId="barber-own" onSlotAction={() => {}} />);

    expect(screen.queryByRole('region', { name: 'Ana' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Otro Cliente/)).not.toBeInTheDocument();
  });

  it('forwards the exact slot id and action DayBoard reports, on click, to the caller', () => {
    const onSlotAction = vi.fn();
    render(<BarberDayBoardContainer dayBoard={dayBoard} barberId="barber-own" onSlotAction={onSlotAction} />);

    screen.getByRole('button', { name: 'Marcar realizado' }).click();

    expect(onSlotAction).toHaveBeenCalledWith('slot-own', 'mark-completed');
  });
});
