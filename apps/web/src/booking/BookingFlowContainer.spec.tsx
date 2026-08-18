import type { AvailabilitySlot, HoldResponse } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookingFlowContainer } from './BookingFlowContainer';

// client-booking spec, "Exploración sin cuenta" + "Cuenta sin contraseña
// creada al final del flujo" (tasks 9.3/9.4/9.5/9.6): picking a schedule
// creates a hold and the flow then shows it with a countdown TOGETHER with
// the account form — this container is the seam that switches between
// those two steps. Before a hold exists: only the picker. Once one exists:
// the countdown (it keeps running while the form is filled) plus the form,
// never the picker again.
const slots: AvailabilitySlot[] = [
  { startsAt: '2026-09-07T12:00:00.000Z', endsAt: '2026-09-07T12:30:00.000Z' },
];
const hold: HoldResponse = { holdId: 'hold-1', expiresAt: '2026-09-07T12:15:00.000Z' };

describe('BookingFlowContainer', () => {
  it('shows the availability picker while no hold exists yet', () => {
    render(
      <BookingFlowContainer
        slots={slots}
        hold={null}
        nowMs={0}
        onSelectSlot={() => {}}
        onConfirmReservation={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: '09:00 - 09:30' })).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('forwards the chosen slot to the caller, who is responsible for creating the hold', () => {
    const onSelectSlot = vi.fn();
    render(
      <BookingFlowContainer
        slots={slots}
        hold={null}
        nowMs={0}
        onSelectSlot={onSelectSlot}
        onConfirmReservation={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '09:00 - 09:30' }));

    expect(onSelectSlot).toHaveBeenCalledWith(slots[0]);
  });

  it('shows the hold countdown together with the account form, not the picker, once a hold exists', () => {
    const nowMs = Date.parse('2026-09-07T12:00:00.000Z');

    render(
      <BookingFlowContainer
        slots={slots}
        hold={hold}
        nowMs={nowMs}
        onSelectSlot={() => {}}
        onConfirmReservation={() => {}}
      />,
    );

    expect(screen.getByRole('timer')).toHaveTextContent('15:00');
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\d{2}:\d{2}/ })).not.toBeInTheDocument();
  });

  it('forwards the confirmation exactly as the account form built it, scoped to this hold', () => {
    const onConfirmReservation = vi.fn();
    const nowMs = Date.parse('2026-09-07T12:00:00.000Z');
    render(
      <BookingFlowContainer
        slots={slots}
        hold={hold}
        nowMs={nowMs}
        onSelectSlot={() => {}}
        onConfirmReservation={onConfirmReservation}
      />,
    );

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Marcos' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '3511234567' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'marcos@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));

    expect(onConfirmReservation).toHaveBeenCalledWith({
      holdId: 'hold-1',
      client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: null },
    });
  });
});
