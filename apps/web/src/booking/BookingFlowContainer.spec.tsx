import type { AvailabilitySlot, HoldResponse } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookingFlowContainer } from './BookingFlowContainer';

// client-booking spec, "Exploración sin cuenta" + slot-hold, "Creación del
// hold" (tasks 9.3/9.4): picking a schedule creates a hold and the flow then
// shows it with a countdown — this container is the seam that switches
// between those two steps. No account/password step happens here yet
// (that is task 9.5/9.6): before a hold exists, only the picker; once one
// exists, only the countdown.
const slots: AvailabilitySlot[] = [
  { startsAt: '2026-09-07T12:00:00.000Z', endsAt: '2026-09-07T12:30:00.000Z' },
];
const hold: HoldResponse = { holdId: 'hold-1', expiresAt: '2026-09-07T12:15:00.000Z' };

describe('BookingFlowContainer', () => {
  it('shows the availability picker while no hold exists yet', () => {
    render(<BookingFlowContainer slots={slots} hold={null} nowMs={0} onSelectSlot={() => {}} />);

    expect(screen.getByRole('button', { name: '12:00 - 12:30' })).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('forwards the chosen slot to the caller, who is responsible for creating the hold', () => {
    const onSelectSlot = vi.fn();
    render(<BookingFlowContainer slots={slots} hold={null} nowMs={0} onSelectSlot={onSelectSlot} />);

    fireEvent.click(screen.getByRole('button', { name: '12:00 - 12:30' }));

    expect(onSelectSlot).toHaveBeenCalledWith(slots[0]);
  });

  it('shows the hold countdown, not the picker, once a hold has been created', () => {
    const nowMs = Date.parse('2026-09-07T12:00:00.000Z');

    render(<BookingFlowContainer slots={slots} hold={hold} nowMs={nowMs} onSelectSlot={() => {}} />);

    expect(screen.getByRole('timer')).toHaveTextContent('15:00');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
