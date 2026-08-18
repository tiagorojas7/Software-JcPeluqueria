import type { EditAppointmentRequest } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EditAppointmentForm } from './EditAppointmentForm';

// admin-operations spec, "Edición y cancelación administrativa": servicio,
// barbero y horario son los tres campos editables — mismo shape que
// EditAppointmentRequestSchema. Presentacional puro: solo reporta el
// request armado a onSubmit, nunca llama a la API (mismo split que
// PhoneAppointmentForm).
describe('EditAppointmentForm', () => {
  function fillFields() {
    fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'barber-2' } });
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-2' } });
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '15:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '15:30' } });
  }

  it('submits the edited barbero, servicio and horario', () => {
    const onSubmit = vi.fn();
    render(<EditAppointmentForm onSubmit={onSubmit} onCancel={() => {}} />);

    fillFields();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    const expected: EditAppointmentRequest = {
      barberId: 'barber-2',
      serviceId: 'service-2',
      calendarDate: '2026-09-01',
      startTime: '15:00',
      endTime: '15:30',
    };
    expect(onSubmit).toHaveBeenCalledWith(expected);
  });

  it('pre-fills from initialValues so editing does not start from a blank form', () => {
    const onSubmit = vi.fn();
    render(
      <EditAppointmentForm
        onSubmit={onSubmit}
        onCancel={() => {}}
        initialValues={{
          barberId: 'barber-1',
          serviceId: 'service-1',
          calendarDate: '2026-09-01',
          startTime: '10:00',
          endTime: '10:30',
        }}
      />,
    );

    expect(screen.getByLabelText('Barbero')).toHaveValue('barber-1');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ barberId: 'barber-1', serviceId: 'service-1' }),
    );
  });

  it('calls onCancel and submits nothing when the staff member backs out', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<EditAppointmentForm onSubmit={onSubmit} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
