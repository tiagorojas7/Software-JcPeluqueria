import type { DayBoardResponse } from '@jc-barberia/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminDayBoardContainer } from './AdminDayBoardContainer';

const dayBoard: DayBoardResponse = {
  date: '2026-08-20',
  columns: [
    { barberId: 'barber-1', barberName: 'Juan', opensAt: '09:00', closesAt: '18:00' },
    { barberId: 'barber-2', barberName: 'Ana', opensAt: '09:00', closesAt: '18:00' },
  ],
  slots: [
    {
      id: 'slot-1',
      barberId: 'barber-1',
      serviceId: 'service-1',
      serviceName: 'Corte clasico',
      status: 'reservado',
      channel: 'web',
      startsAt: '2026-08-20T12:00:00.000Z',
      endsAt: '2026-08-20T12:30:00.000Z',
      clientName: 'Marcos',
      clientAge: 34,
      allowedActions: ['edit', 'cancel'],
    },
    {
      id: 'slot-2',
      barberId: 'barber-2',
      serviceId: 'service-2',
      serviceName: 'Corte + Barba',
      status: 'held',
      channel: 'web',
      startsAt: '2026-08-20T13:00:00.000Z',
      endsAt: '2026-08-20T13:30:00.000Z',
      allowedActions: [],
    },
  ],
};

// admin-operations: "Vista del día por columnas de barbero" — the admin
// view shows every barber's column, each turno's status, and the client's
// name/age when loaded. AdminDayBoardContainer is the seam that receives
// the already server-scoped DayBoardResponse (owner/secretary get every
// column back; no client-side filtering happens here).
describe('AdminDayBoardContainer', () => {
  it("renders a column per barber with each turno's status and the client's name/age when loaded", () => {
    render(<AdminDayBoardContainer dayBoard={dayBoard} onSlotAction={() => {}} />);

    const juanColumn = screen.getByRole('region', { name: 'Juan' });
    expect(within(juanColumn).getByText('Reservado')).toBeInTheDocument();
    expect(within(juanColumn).getByText('Marcos (34)')).toBeInTheDocument();

    const anaColumn = screen.getByRole('region', { name: 'Ana' });
    expect(within(anaColumn).getByText('held')).toBeInTheDocument();
    expect(within(anaColumn).queryByText(/Marcos/)).not.toBeInTheDocument();
  });

  it('forwards the exact slot id and action the server allowed, on click, to the caller', () => {
    const onSlotAction = vi.fn();
    render(<AdminDayBoardContainer dayBoard={dayBoard} onSlotAction={onSlotAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect(onSlotAction).toHaveBeenCalledWith('slot-1', 'edit');
  });
});
