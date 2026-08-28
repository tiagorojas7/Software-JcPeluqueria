import type { EditAppointmentRequest } from '@jc-barberia/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditAppointmentForm } from './EditAppointmentForm';
import { apiGet } from '../shared/api-client';

vi.mock('../shared/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/api-client')>();
  return { ...actual, apiGet: vi.fn() };
});

const barbers = [
  { id: 'barber-1', name: 'Cristian Gomez' },
  { id: 'barber-2', name: 'Facundo Diaz' },
];

const services = [
  { id: 'service-1', name: 'Corte clasico' },
  { id: 'service-2', name: 'Corte + Barba' },
];

// 18:00Z is 15:00 shop-local (UTC-3).
const AVAILABLE_SLOTS_AT_15 = {
  slots: [{ startsAt: '2026-09-01T18:00:00.000Z', endsAt: '2026-09-01T18:30:00.000Z' }],
};

/** Trabaja los siete dias: ninguna fecha del test dispara la advertencia. */
const BARBER_WEEK = {
  days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, opensAt: '09:00', closesAt: '18:00' })),
};

// admin-operations spec, "Edición y cancelación administrativa": servicio,
// barbero y horario son los tres campos editables. Presentacional puro
// aparte de `StartTimeField`'s read-only GET /availability lookup — nunca
// llama a la API para el PUT (mismo split que PhoneAppointmentForm).
//
// panel-usable: barbero/servicio son selects reales sobre nombres, nunca un
// UUID pegado a mano; no hay campo "Hora de fin" (EditAppointmentUseCase lo
// deriva del servicio); "Hora de inicio" solo ofrece horarios que
// GET /availability reporta como libres.
describe('EditAppointmentForm', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    // Por path: este formulario hace DOS lecturas distintas — los horarios
    // libres y los dias que el barbero trabaja (`BarberWorkingDays`).
    vi.mocked(apiGet).mockImplementation((path: string) => {
      if (path.startsWith('/panel/barbers/')) {
        return Promise.resolve(BARBER_WEEK);
      }
      return Promise.resolve(AVAILABLE_SLOTS_AT_15);
    });
  });

  it('submits the edited barbero, servicio and horario, with no endTime at all', async () => {
    const onSubmit = vi.fn();
    render(<EditAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'barber-2' } });
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-2' } });
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });
    fireEvent.click(await screen.findByRole('button', { name: '15:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    const expected: EditAppointmentRequest = {
      barberId: 'barber-2',
      serviceId: 'service-2',
      calendarDate: '2026-09-01',
      startTime: '15:00',
    };
    expect(onSubmit).toHaveBeenCalledWith(expected);
    expect(vi.mocked(onSubmit).mock.calls[0]?.[0]).not.toHaveProperty('endTime');
  });

  it('pre-fills from initialValues so editing does not start from a blank form, and can submit unchanged', () => {
    const onSubmit = vi.fn();
    render(
      <EditAppointmentForm
        barbers={barbers}
        services={services}
        onSubmit={onSubmit}
        onCancel={() => {}}
        initialValues={{ barberId: 'barber-1', serviceId: 'service-1', calendarDate: '2026-09-01', startTime: '10:00' }}
      />,
    );

    expect(screen.getByLabelText('Barbero')).toHaveValue('barber-1');
    expect(screen.getByLabelText('Servicio')).toHaveValue('service-1');
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-09-01');
    // The turno's own current horario stays selected without the staff
    // member having to re-pick it from the availability list — see
    // StartTimeField's own doc comment for why GET /availability would not
    // offer this exact horario back (it is occupied by this very turno).
    expect(screen.getByText('Hora elegida: 10:00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ barberId: 'barber-1', serviceId: 'service-1', startTime: '10:00' }),
    );
  });

  it('calls onCancel and submits nothing when the staff member backs out', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<EditAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lists barbers and services by name in real selects, never a free-text UUID field', () => {
    render(<EditAppointmentForm barbers={barbers} services={services} onSubmit={vi.fn()} onCancel={() => {}} />);

    expect(screen.getByLabelText('Barbero').tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Cristian Gomez' })).toBeInTheDocument();
    expect(screen.getByLabelText('Servicio').tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Corte + Barba' })).toBeInTheDocument();
  });

  it('renders Fecha as a real date input and never a Hora de fin field', () => {
    render(<EditAppointmentForm barbers={barbers} services={services} onSubmit={vi.fn()} onCancel={() => {}} />);

    expect(screen.getByLabelText('Fecha')).toHaveAttribute('type', 'date');
    expect(screen.queryByLabelText('Hora de fin')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hora de inicio')).not.toBeInTheDocument();
  });

  it('keeps Guardar cambios disabled until a start time is picked, when starting blank', async () => {
    render(<EditAppointmentForm barbers={barbers} services={services} onSubmit={vi.fn()} onCancel={() => {}} />);

    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('re-fetches availability and clears the picked time when the staff member changes barbero', async () => {
    render(
      <EditAppointmentForm
        barbers={barbers}
        services={services}
        onSubmit={vi.fn()}
        onCancel={() => {}}
        initialValues={{ barberId: 'barber-1', serviceId: 'service-1', calendarDate: '2026-09-01', startTime: '10:00' }}
      />,
    );
    expect(screen.getByText('Hora elegida: 10:00')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'barber-2' } });

    expect(screen.queryByText('Hora elegida: 10:00')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/availability?barberId=barber-2&serviceId=service-1&date=2026-09-01'),
    );
  });
});
