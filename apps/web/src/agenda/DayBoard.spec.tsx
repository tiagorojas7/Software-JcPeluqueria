import type { DayBoardColumn, DayBoardSlot } from '@jc-barberia/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DayBoard } from './DayBoard';

const columns: DayBoardColumn[] = [
  { barberId: 'barber-1', barberName: 'Juan', opensAt: '09:00', closesAt: '18:00' },
  { barberId: 'barber-2', barberName: 'Ana', opensAt: '09:00', closesAt: '18:00' },
];

function buildSlot(overrides: Partial<DayBoardSlot> = {}): DayBoardSlot {
  return {
    id: 'slot-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    serviceName: 'Corte clasico',
    status: 'reservado',
    channel: 'web',
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

  // README §"El personal se olvida de marcar los turnos": the pendientes
  // must be the first thing seen on opening the panel, or they pile up and
  // the shop loses the record of what was actually done. The board says how
  // many are waiting instead of making someone scan every column for amber.
  describe('pendientes sin registrar', () => {
    it('announces how many slots are waiting for a decision', () => {
      const slots = [
        buildSlot({ id: 'slot-1', barberId: 'barber-1', status: 'sin_registrado' }),
        buildSlot({ id: 'slot-2', barberId: 'barber-2', status: 'sin_registrado' }),
        buildSlot({ id: 'slot-3', barberId: 'barber-1', status: 'realizado' }),
      ];

      render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

      expect(screen.getByRole('status')).toHaveTextContent(
        '2 turnos sin registrar esperan que alguien los resuelva',
      );
    });

    it('says it in the singular for a single pending slot', () => {
      const slots = [buildSlot({ id: 'slot-1', status: 'sin_registrado' })];

      render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

      expect(screen.getByRole('status')).toHaveTextContent(
        '1 turno sin registrar espera que alguien lo resuelva',
      );
    });

    it('stays quiet when the day has nothing pending', () => {
      const slots = [
        buildSlot({ id: 'slot-1', status: 'realizado' }),
        buildSlot({ id: 'slot-2', status: 'reservado' }),
      ];

      render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  // A barber's own column header carries their day at a glance, so nobody
  // has to count rows to answer "how did today go for Ana".
  describe('resumen por barbero', () => {
    it("counts each barber's own slots by status, scoped to their column", () => {
      const slots = [
        buildSlot({ id: 'slot-1', barberId: 'barber-1', status: 'realizado' }),
        buildSlot({ id: 'slot-2', barberId: 'barber-1', status: 'realizado' }),
        buildSlot({ id: 'slot-3', barberId: 'barber-1', status: 'reservado' }),
        buildSlot({ id: 'slot-4', barberId: 'barber-2', status: 'realizado' }),
      ];

      render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

      const juanColumn = screen.getByRole('region', { name: 'Juan' });
      expect(within(juanColumn).getByText('2 realizados')).toBeInTheDocument();
      expect(within(juanColumn).getByText('1 reservado')).toBeInTheDocument();

      const anaColumn = screen.getByRole('region', { name: 'Ana' });
      expect(within(anaColumn).getByText('1 realizado')).toBeInTheDocument();
      expect(within(anaColumn).queryByText(/reservado/)).not.toBeInTheDocument();
    });

    it('omits a status the barber has none of, rather than showing a zero', () => {
      const slots = [buildSlot({ id: 'slot-1', barberId: 'barber-1', status: 'realizado' })];

      render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

      const juanColumn = screen.getByRole('region', { name: 'Juan' });
      expect(within(juanColumn).queryByText(/^0 /)).not.toBeInTheDocument();
    });
  });

  // `opensAt`/`closesAt` now travel on the column (contracts/agenda.ts). The
  // header states the barber's real extent for the day, so an empty morning
  // can be told apart from a morning the barber does not work.
  describe('horario del barbero', () => {
    it("shows the barber's working hours for the day", () => {
      render(<DayBoard columns={columns} slots={[]} onSlotAction={() => {}} />);

      const juanColumn = screen.getByRole('region', { name: 'Juan' });
      expect(within(juanColumn).getByText('09:00 – 18:00')).toBeInTheDocument();
    });

    it('says so when the barber does not work that day', () => {
      const closed: DayBoardColumn[] = [
        { barberId: 'barber-1', barberName: 'Juan', opensAt: null, closesAt: null },
      ];

      render(<DayBoard columns={closed} slots={[]} onSlotAction={() => {}} />);

      expect(screen.getByText('No trabaja este día')).toBeInTheDocument();
    });
  });

  // Origin used to be guessed from what was MISSING — no phone meant
  // "probably a walk-in", which was never reliable. `channel` travels now,
  // so the panel states it. A `web` turno is the norm and carries no badge:
  // labelling every row would drown the two that are worth noticing.
  describe('origen del turno', () => {
    it('marks a walk-in', () => {
      const slots = [buildSlot({ id: 'slot-1', channel: 'walk_in' })];

      render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

      expect(screen.getByText('Walk-in')).toBeInTheDocument();
    });

    it('marks a turno taken over the phone', () => {
      const slots = [buildSlot({ id: 'slot-1', channel: 'telefonico' })];

      render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

      expect(screen.getByText('Teléfono')).toBeInTheDocument();
    });

    it('leaves an online booking unlabelled, since that is the norm', () => {
      const slots = [buildSlot({ id: 'slot-1', channel: 'web' })];

      render(<DayBoard columns={columns} slots={slots} onSlotAction={() => {}} />);

      expect(screen.queryByText('Walk-in')).not.toBeInTheDocument();
      expect(screen.queryByText('Teléfono')).not.toBeInTheDocument();
      expect(screen.queryByText('web')).not.toBeInTheDocument();
    });
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
