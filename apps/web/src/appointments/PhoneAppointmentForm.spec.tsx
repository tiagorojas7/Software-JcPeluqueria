import type { CreatePhoneAppointmentRequest } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PhoneAppointmentForm } from './PhoneAppointmentForm';

// admin-operations spec, "Creación de turnos telefónicos sin seña": only
// nombre y teléfono are required; email/edad stay optional and never block
// the submission, matching CreatePhoneAppointmentRequestSchema exactly.
describe('PhoneAppointmentForm', () => {
  function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Marcos' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '3511234567' } });
    fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'barber-1' } });
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-1' } });
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '10:30' } });
  }

  it('submits with only the required fields, leaving email and age out', () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm onSubmit={onSubmit} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar turno' }));

    const expected: CreatePhoneAppointmentRequest = {
      barberId: 'barber-1',
      serviceId: 'service-1',
      calendarDate: '2026-09-01',
      startTime: '10:00',
      endTime: '10:30',
      client: { name: 'Marcos', phone: '3511234567', email: null, age: null },
    };
    expect(onSubmit).toHaveBeenCalledWith(expected);
  });

  it('includes email and age when the staff member loads them', () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm onSubmit={onSubmit} />);

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Email (opcional)'), { target: { value: 'marcos@example.com' } });
    fireEvent.change(screen.getByLabelText('Edad (opcional)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar turno' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 } }),
    );
  });

  it('does not submit while name or phone is empty — the browser enforces required fields', () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm onSubmit={onSubmit} />);

    expect(screen.getByLabelText('Nombre')).toBeRequired();
    expect(screen.getByLabelText('Teléfono')).toBeRequired();
  });
});
