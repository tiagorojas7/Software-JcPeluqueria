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
    serviceName: 'Corte clasico',
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
    expect(within(juanColumn).getByText('Reservado')).toBeInTheDocument();
    expect(within(juanColumn).queryByText('held')).not.toBeInTheDocument();

    const anaColumn = screen.getByRole('region', { name: 'Ana' });
    expect(within(anaColumn).getByText('held')).toBeInTheDocument();
  });

  // The owner reads this board at a glance to find what still needs a
  // decision. Each of the domain's five statuses gets the word the shop
  // actually uses, not the snake_case database value — `sin_registrado` in
  // particular reads "Sin registrar", the wording the README's status table
  // uses. Anything else (the `held`/`liberado` hold states the type still
  // permits) falls back to the raw value rather than rendering blank.
  it.each([
    ['reservado', 'Reservado'],
    ['realizado', 'Realizado'],
    ['cancelado', 'Cancelado'],
    ['sin_registrado', 'Sin registrar'],
    ['ausente', 'Ausente'],
    ['held', 'held'],
  ])('labels the %s status as "%s"', (status, label) => {
    const slots = [buildSlot({ id: 'slot-1', status: status as DayBoardSlot['status'] })];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  // Colour alone must never carry the status: a badge that is only tinted
  // is unreadable to a colour-blind barber and invisible in a printed or
  // screenshotted board. The status word is text, and the badge names the
  // status for assistive tech too.
  it('exposes the status as text, not as colour alone', () => {
    const slots = [buildSlot({ id: 'slot-1', status: 'sin_registrado' })];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

    expect(screen.getByText('Sin registrar')).toHaveAccessibleName('Estado: Sin registrar');
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

  // The owner's actual complaint: a slot rendered as little more than the
  // word "reservado". Time must be shop-local (utcIsoToShopLocalTime), never
  // sliced off the raw UTC ISO string, and the service name must be on
  // screen without the browser inventing a lookup of its own.
  it('shows the shop-local start-end time and the service name on every slot', () => {
    const slots = [
      buildSlot({ id: 'slot-1', serviceName: 'Corte + Barba', startsAt: '2026-08-20T12:00:00.000Z', endsAt: '2026-08-20T12:30:00.000Z' }),
    ];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

    expect(screen.getByText('09:00-09:30')).toBeInTheDocument();
    expect(screen.getByText('Corte + Barba')).toBeInTheDocument();
  });

  it('shows the client phone only when the server sent it (an actor holding client:manage)', () => {
    const slots = [
      buildSlot({ id: 'slot-1', clientName: 'Marcos', clientPhone: '3511234567' }),
      buildSlot({ id: 'slot-2', clientName: 'Laura' }),
    ];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

    expect(screen.getByText('3511234567')).toBeInTheDocument();
  });

  it('renders only the actions the server allowed for a slot, and reports the chosen one back with the slot id', () => {
    const onSlotAction = vi.fn();
    const slots = [buildSlot({ id: 'slot-1', allowedActions: ['mark-completed'] })];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={onSlotAction} />);

    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar realizado' }));

    expect(onSlotAction).toHaveBeenCalledWith('slot-1', 'mark-completed');
  });

  // Slice B (cablear-el-mvp, B.6): admin-operations spec, "resolución de
  // pendientes" — a sin_registrado slot's allowedActions now carries
  // confirm-absence alongside mark-completed (GetDayBoardUseCase, B.1/B.2).
  it('renders a "Confirmar ausencia" button for confirm-absence and reports it back with the slot id', () => {
    const onSlotAction = vi.fn();
    const slots = [
      buildSlot({ id: 'slot-1', status: 'sin_registrado', allowedActions: ['mark-completed', 'confirm-absence'] }),
    ];

    render(<DayBoard columns={columns} slots={slots} onSlotAction={onSlotAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ausencia' }));

    expect(onSlotAction).toHaveBeenCalledWith('slot-1', 'confirm-absence');
  });
});
