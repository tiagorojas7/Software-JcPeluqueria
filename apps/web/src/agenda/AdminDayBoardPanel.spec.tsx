import type { CreateWalkInRequest, DayBoardResponse, DayBoardSlot, EditAppointmentRequest } from '@jc-barberia/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminDayBoardPanel } from './AdminDayBoardPanel';
import { apiGet, apiPost, apiPut } from '../shared/api-client';

// B.6: "los botones que hoy están montados y muertos pasan a llamar a los
// endpoints de arriba" — B.1-B.5 opened `/appointments/*` HTTP routes with
// zero UI behind them. This is that UI: `AdminDayBoardContainer` stays
// exactly as Phase 8 left it (a pure `onSlotAction` forwarder, still covered
// by its own spec unmodified); this panel wraps it, turns each forwarded
// action into the matching HTTP call, and reloads the board from the server
// afterward — `allowedActions` is server-computed (design.md, "Frontend"),
// so re-fetching is the only correct way to know what a slot allows next.
vi.mock('../shared/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/api-client')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() };
});

const baseSlot: DayBoardSlot = {
  id: 'slot-1',
  barberId: 'barber-1',
  serviceId: 'service-1',
  serviceName: 'Corte clasico',
  status: 'reservado',
  startsAt: '2026-09-01T13:00:00.000Z',
  endsAt: '2026-09-01T13:30:00.000Z',
  allowedActions: ['edit', 'cancel', 'mark-completed'],
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

describe('AdminDayBoardPanel', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset();
  });

  it('marks a turno as realizado through the endpoint and reloads the board from the server', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 'slot-1', status: 'realizado' });
    vi.mocked(apiGet).mockResolvedValue(reloadedBoard);

    render(<AdminDayBoardPanel dayBoard={initialBoard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar realizado' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/appointments/slot-1/mark-completed'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/agenda/day-board?date=2026-09-01'));
    expect(await screen.findByText('realizado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar realizado' })).not.toBeInTheDocument();
  });

  it('cancels a turno through the endpoint', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 'slot-1', status: 'cancelado' });
    vi.mocked(apiGet).mockResolvedValue(reloadedBoard);

    render(<AdminDayBoardPanel dayBoard={initialBoard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/appointments/slot-1/cancel'));
  });

  it('confirms an absence through the endpoint', async () => {
    const boardWithAbsence: DayBoardResponse = {
      ...initialBoard,
      slots: [{ ...baseSlot, status: 'sin_registrado', allowedActions: ['mark-completed', 'confirm-absence'] }],
    };
    vi.mocked(apiPost).mockResolvedValue({ appointment: { id: 'slot-1', status: 'ausente' } });
    vi.mocked(apiGet).mockResolvedValue(reloadedBoard);

    render(<AdminDayBoardPanel dayBoard={boardWithAbsence} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ausencia' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/appointments/slot-1/confirm-absence'));
  });

  it('opens EditAppointmentForm pre-filled from the clicked slot, and PUTs the edited fields on submit', async () => {
    vi.mocked(apiPut).mockResolvedValue({ id: 'slot-1', status: 'reservado' });
    vi.mocked(apiGet).mockResolvedValue(reloadedBoard);

    render(<AdminDayBoardPanel dayBoard={initialBoard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect(screen.getByLabelText('Barbero')).toHaveValue('barber-1');
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-09-01');
    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    const expected: EditAppointmentRequest = {
      barberId: 'barber-1',
      serviceId: 'service-1',
      calendarDate: '2026-09-01',
      startTime: '15:00',
      endTime: '10:30',
    };
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/appointments/slot-1', expected));
    await waitFor(() => expect(screen.queryByLabelText('Barbero')).not.toBeInTheDocument());
  });

  it('closes the edit form without calling the API when the staff member backs out', () => {
    render(<AdminDayBoardPanel dayBoard={initialBoard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }));

    expect(screen.queryByLabelText('Barbero')).not.toBeInTheDocument();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('loads a walk-in through the endpoint and hides the form again', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 'walkin-1', status: 'realizado' });
    vi.mocked(apiGet).mockResolvedValue(reloadedBoard);

    render(<AdminDayBoardPanel dayBoard={initialBoard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo walk-in' }));
    fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'barber-1' } });
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-1' } });
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '11:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '11:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar walk-in' }));

    const expected: CreateWalkInRequest = {
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: null,
      calendarDate: '2026-09-01',
      startTime: '11:00',
      endTime: '11:30',
    };
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/appointments/walk-in', expected));
    await waitFor(() => expect(screen.queryByLabelText('Cliente (opcional)')).not.toBeInTheDocument());
  });

  it('shows the API error message and never reloads the board when an action fails', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('El horario ya no está disponible'));

    render(<AdminDayBoardPanel dayBoard={initialBoard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El horario ya no está disponible');
    expect(apiGet).not.toHaveBeenCalled();
  });
});
