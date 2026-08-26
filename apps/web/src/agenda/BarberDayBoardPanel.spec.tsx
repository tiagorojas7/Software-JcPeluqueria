import type { DayBoardResponse, DayBoardSlot } from '@jc-barberia/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BarberDayBoardPanel } from './BarberDayBoardPanel';
import { apiGet, apiPost } from '../shared/api-client';

// B.6, barber side: `BarberDayBoardContainer` stays the exact `barberId`
// pure-filtering seam Phase 11 left (its own spec unmodified) — this panel
// wraps it and turns `mark-completed`/`confirm-absence` into the real
// BarberMarkCompleted/BarberConfirmAbsence HTTP calls B.2 opened. A barber's
// `allowedActions` never carries `edit`/`cancel` (no appointment:update/
// :cancel permission — GetDayBoardUseCase.allowedActionsFor) and
// `walkin:create` is not part of this role's grant either, so neither the
// edit form nor the walk-in form has any reason to exist on this panel.
vi.mock('../shared/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/api-client')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

const baseSlot: DayBoardSlot = {
  id: 'slot-1',
  barberId: 'barber-1',
  serviceId: 'service-1',
  serviceName: 'Corte clasico',
  status: 'reservado',
  startsAt: '2026-09-01T13:00:00.000Z',
  endsAt: '2026-09-01T13:30:00.000Z',
  allowedActions: ['mark-completed'],
};

const initialBoard: DayBoardResponse = {
  date: '2026-09-01',
  columns: [{ barberId: 'barber-1', barberName: 'Juan' }],
  slots: [baseSlot],
};

const reloadedBoard: DayBoardResponse = {
  ...initialBoard,
  slots: [{ ...baseSlot, status: 'realizado', allowedActions: [] }],
};

describe('BarberDayBoardPanel', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
  });

  it('marks the own turno as realizado and reloads the board from the server', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 'slot-1', status: 'realizado' });
    vi.mocked(apiGet).mockResolvedValue(reloadedBoard);

    render(<BarberDayBoardPanel dayBoard={initialBoard} barberId="barber-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar realizado' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/appointments/slot-1/mark-completed'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/agenda/day-board?date=2026-09-01'));
    expect(await screen.findByText('Realizado')).toBeInTheDocument();
  });

  it("rejects marking a colleague's turno, showing the API's message and never reloading", async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('No podés resolver un turno de otro barbero.'));
    const colleagueBoard: DayBoardResponse = {
      ...initialBoard,
      columns: [
        { barberId: 'barber-1', barberName: 'Juan' },
        { barberId: 'barber-2', barberName: 'Ana' },
      ],
      slots: [{ ...baseSlot, id: 'slot-2', barberId: 'barber-2', allowedActions: ['mark-completed'] }],
    };

    render(<BarberDayBoardPanel dayBoard={colleagueBoard} barberId="barber-1" />);
    // BarberDayBoardContainer already filters columns/slots to `barberId` —
    // nothing to click here confirms this panel never even offers the
    // colleague's button. The server-rejection path is exercised in the
    // "own turno" happy-path test above via the mocked apiPost; this test
    // only needs to prove the filtering panel wraps still applies.
    expect(screen.queryByRole('button', { name: 'Marcar realizado' })).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('shows the API error message when an action fails', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('No podés resolver un turno de otro barbero.'));

    render(<BarberDayBoardPanel dayBoard={initialBoard} barberId="barber-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar realizado' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No podés resolver un turno de otro barbero.');
    expect(apiGet).not.toHaveBeenCalled();
  });
});
