import type { DayBoardColumn, DayBoardSlot } from '@jc-barberia/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DayBoard } from './DayBoard';

const columns: DayBoardColumn[] = [
  { barberId: 'barber-1', barberName: 'Juan' },
  { barberId: 'barber-2', barberName: 'Ana' },
];

function buildSlot(overrides: Partial<DayBoardSlot> = {}): DayBoardSlot {
  return {
    id: 'slot-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    status: 'reservado',
    startsAt: '2026-08-20T12:00:00.000Z',
    endsAt: '2026-08-20T12:30:00.000Z',
    allowedActions: [],
    ...overrides,
  };
}

// DayBoard is a pure presentational organism (design.md's Frontend section):
// it draws exactly `columns`/`slots`/`allowedActions` as given, and never
// decides anything about roles or permissions itself — that decision was
// already made on the server (GetDayBoardUseCase). These tests only ever
// assert on what was rendered from the props, never on any role concept.
describe('DayBoard', () => {
  it("renders one column per barber, scoped to that barber's own slots", () => {
    const slots = [
      buildSlot({ id: 'slot-1', barberId: 'barber-1', status: 'reservado' }),
      buildSlot({ id: 'slot-2', barberId: 'barber-2', status: 'held' }),
    ];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

    const juanColumn = screen.getByRole('region', { name: 'Juan' });
    expect(within(juanColumn).getByText('reservado')).toBeInTheDocument();
    expect(within(juanColumn).queryByText('held')).not.toBeInTheDocument();

    const anaColumn = screen.getByRole('region', { name: 'Ana' });
    expect(within(anaColumn).getByText('held')).toBeInTheDocument();
  });

  it('shows the client name and age only when loaded on that slot', () => {
    const slots = [
      buildSlot({ id: 'slot-1', clientName: 'Marcos', clientAge: 34 }),
      buildSlot({ id: 'slot-2' }),
    ];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

    expect(screen.getByText('Marcos (34)')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it('renders only the actions the server allowed for a slot, and reports the chosen one back with the slot id', () => {
    const onSlotAction = vi.fn();
    const slots = [buildSlot({ id: 'slot-1', allowedActions: ['mark-completed'] })];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={onSlotAction} />);

    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar realizado' }));

    expect(onSlotAction).toHaveBeenCalledWith('slot-1', 'mark-completed');
  });
});
