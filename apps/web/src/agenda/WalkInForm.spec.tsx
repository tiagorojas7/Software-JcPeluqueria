import type { CreateWalkInRequest } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WalkInForm } from './WalkInForm';

// admin-operations spec, "Carga de walk-ins": solo servicio y barbero son
// obligatorios — un walk-in puede ser un cliente no identificado
// (appointment-lifecycle spec, "Los walk-ins ingresan directamente como
// realizado"), asi que clientId nunca bloquea el envio.
describe('WalkInForm', () => {
  function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'barber-1' } });
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-1' } });
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '11:00' } });
    fireEvent.change(screen.getByLabelText('Hora de fin'), { target: { value: '11:30' } });
  }

  it('submits with clientId null when no client id was loaded — cliente no identificado', () => {
    const onSubmit = vi.fn();
    render(<WalkInForm onSubmit={onSubmit} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar walk-in' }));

    const expected: CreateWalkInRequest = {
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientId: null,
      calendarDate: '2026-09-01',
      startTime: '11:00',
      endTime: '11:30',
    };
    expect(onSubmit).toHaveBeenCalledWith(expected);
  });

  it('includes clientId when the staff member identifies the client', () => {
    const onSubmit = vi.fn();
    render(<WalkInForm onSubmit={onSubmit} />);

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Cliente (opcional)'), { target: { value: 'client-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar walk-in' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-9' }));
  });

  it('requires barbero and servicio before submitting', () => {
    render(<WalkInForm onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Barbero')).toBeRequired();
    expect(screen.getByLabelText('Servicio')).toBeRequired();
  });
});
