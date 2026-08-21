import type { AvailabilitySlot } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AvailabilityPicker } from './AvailabilityPicker';

// client-booking spec, "Exploración sin cuenta" (tasks 9.1/9.2): the visitor
// sees the free schedules for a service without any account/session —
// AvailabilityPicker receives the already-fetched `AvailabilityResponse`
// slots as a prop, same container/presentational split as `DayBoard`, and
// never itself talks to an API or asks for credentials.
const slots: AvailabilitySlot[] = [
  { startsAt: '2026-09-07T12:00:00.000Z', endsAt: '2026-09-07T12:30:00.000Z' },
  { startsAt: '2026-09-07T12:30:00.000Z', endsAt: '2026-09-07T13:00:00.000Z' },
];

describe('AvailabilityPicker', () => {
  it('lists every free schedule with no registration prompt anywhere', () => {
    render(<AvailabilityPicker slots={slots} onSelectSlot={() => {}} />);

    expect(screen.getAllByRole('button', { name: /^\d{2}:\d{2}$/ })).toHaveLength(2);
    expect(screen.queryByText(/registr/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/contraseñ/i)).not.toBeInTheDocument();
  });

  // The owner's own words: "poné cuándo inicia, no cuándo inicia y
  // termina." Each button shows ONLY the start time — never a range —
  // and the duration every slot shares is stated once, above the list.
  it('shows only the start time on each slot, and the shared duration once above the list', () => {
    render(<AvailabilityPicker slots={slots} onSelectSlot={() => {}} />);

    expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '09:30' })).toBeInTheDocument();
    expect(screen.queryByText(/09:00 - 09:30/)).not.toBeInTheDocument();
    expect(screen.getByText(/duraci.n del turno: 30 min/i)).toBeInTheDocument();
  });

  it('reports the exact slot chosen, unmodified, to the caller', () => {
    const onSelectSlot = vi.fn();
    render(<AvailabilityPicker slots={slots} onSelectSlot={onSelectSlot} />);

    fireEvent.click(screen.getByRole('button', { name: '09:30' }));

    expect(onSelectSlot).toHaveBeenCalledWith(slots[1]);
  });

  it('shows an explicit empty state instead of an empty, silent list', () => {
    render(<AvailabilityPicker slots={[]} onSelectSlot={() => {}} />);

    expect(screen.getByText(/no hay horarios disponibles/i)).toBeInTheDocument();
  });
});
