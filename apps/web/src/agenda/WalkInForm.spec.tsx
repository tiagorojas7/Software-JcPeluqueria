import type { CreateWalkInRequest } from '@jc-barberia/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalkInForm } from './WalkInForm';
import { apiGet } from '../shared/api-client';

vi.mock('../shared/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/api-client')>();
  return { ...actual, apiGet: vi.fn() };
});

const barbers = [{ id: 'barber-1', name: 'Cristian Gomez' }];
const services = [{ id: 'service-1', name: 'Corte clasico' }];

// 14:00Z is 11:00 shop-local (UTC-3).
const AVAILABLE_SLOTS_AT_11 = {
  slots: [{ startsAt: '2026-09-01T14:00:00.000Z', endsAt: '2026-09-01T14:30:00.000Z' }],
};

async function fillRequiredFieldsAndPickStartTime() {
  fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'barber-1' } });
  fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-1' } });
  fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });
  fireEvent.click(await screen.findByRole('button', { name: '11:00' }));
}

// admin-operations spec, "Carga de walk-ins": solo servicio y barbero son
// obligatorios — un walk-in puede ser un cliente no identificado
// (appointment-lifecycle spec, "Los walk-ins ingresan directamente como
// realizado"), asi que el telefono nunca bloquea el envio.
//
// panel-usable: barbero/servicio son selects reales; no hay campo "Hora de
// fin" (CreateWalkInUseCase lo deriva del servicio); "cliente" pide un
// telefono, no un UUID — CreateWalkInUseCase busca por telefono y deja el
// walk-in sin identificar si no hay coincidencia.
describe('WalkInForm', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockResolvedValue(AVAILABLE_SLOTS_AT_11);
  });

  it('submits with clientPhone null when no phone was loaded — cliente no identificado', async () => {
    const onSubmit = vi.fn();
    render(<WalkInForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    await fillRequiredFieldsAndPickStartTime();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar walk-in' }));

    const expected: CreateWalkInRequest = {
      barberId: 'barber-1',
      serviceId: 'service-1',
      clientPhone: null,
      calendarDate: '2026-09-01',
      startTime: '11:00',
    };
    expect(onSubmit).toHaveBeenCalledWith(expected);
    expect(vi.mocked(onSubmit).mock.calls[0]?.[0]).not.toHaveProperty('endTime');
  });

  it('includes clientPhone when the staff member identifies the client by phone', async () => {
    const onSubmit = vi.fn();
    render(<WalkInForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    await fillRequiredFieldsAndPickStartTime();
    fireEvent.change(screen.getByLabelText('Teléfono del cliente (opcional)'), { target: { value: '3511234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar walk-in' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ clientPhone: '3511234567' }));
  });

  it('requires barbero and servicio before submitting', () => {
    render(<WalkInForm barbers={barbers} services={services} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Barbero')).toBeRequired();
    expect(screen.getByLabelText('Servicio')).toBeRequired();
  });

  it('lists barbers and services by name in real selects, never a free-text UUID field', () => {
    render(<WalkInForm barbers={barbers} services={services} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Barbero').tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Cristian Gomez' })).toBeInTheDocument();
    expect(screen.getByLabelText('Servicio').tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Corte clasico' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Cliente (opcional)')).not.toBeInTheDocument();
  });

  it('renders Fecha as a real date input and never a Hora de fin field', () => {
    render(<WalkInForm barbers={barbers} services={services} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Fecha')).toHaveAttribute('type', 'date');
    expect(screen.queryByLabelText('Hora de fin')).not.toBeInTheDocument();
  });

  it('offers only the start times GET /availability reports as free', async () => {
    render(<WalkInForm barbers={barbers} services={services} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/availability?barberId=barber-1&serviceId=service-1&date=2026-09-01'),
    );
    expect(await screen.findByRole('button', { name: '11:00' })).toBeInTheDocument();
  });

  it('keeps Cargar walk-in disabled until a start time is picked', () => {
    render(<WalkInForm barbers={barbers} services={services} onSubmit={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Cargar walk-in' })).toBeDisabled();
  });
});
