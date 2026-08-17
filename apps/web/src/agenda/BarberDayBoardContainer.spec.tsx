import type { DayBoardResponse, SlotAction } from '@jc-barberia/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarberDayBoardContainer } from './BarberDayBoardContainer';

const dayBoard: DayBoardResponse = {
  date: '2026-08-20',
  columns: [
    { barberId: 'barber-1', barberName: 'Juan' },
    { barberId: 'barber-2', barberName: 'Ana' },
  ],
  slots: [],
};

describe('BarberDayBoardContainer (11.1/11.2)', () => {
  it('filters the DayBoard to show only the authenticated barber\'s column', () => {
    const actor = { userId: 'user-1', role: 'barber', barberId: 'barber-1' };

    render(
      <BarberDayBoardContainer
        dayBoard={dayBoard}
        onSlotAction={() => {}}
        actor={actor}
      />,
    );

    const juanColumn = screen.getByRole('region', { name: 'Juan' });
    expect(juanColumn).toBeInTheDocument();

    const anaColumn = screen.queryByRole('region', { name: 'Ana' });
    expect(anaColumn).not.toBeInTheDocument();
  });
});