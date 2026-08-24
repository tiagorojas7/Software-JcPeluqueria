import type { CreatePhoneAppointmentRequest } from '@jc-barberia/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PhoneAppointmentForm } from './PhoneAppointmentForm';
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
  { id: 'service-1', name: 'Corte clasico ($8.000)' },
  { id: 'service-2', name: 'Corte + Barba ($12.000)' },
];

// 13:00Z is 10:00 shop-local (UTC-3) — the same offset every other spec in
// this codebase uses (BookingPage.spec.tsx, AvailabilityPicker.spec.tsx).
const AVAILABLE_SLOTS = {
  slots: [{ startsAt: '2026-09-01T13:00:00.000Z', endsAt: '2026-09-01T13:30:00.000Z' }],
};

async function fillRequiredFieldsAndPickStartTime() {
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Marcos' } });
  fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '3511234567' } });
  fireEvent.change(screen.getByLabelText('Barbero'), { target: { value: 'barber-1' } });
  fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-1' } });
  fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });
  fireEvent.click(await screen.findByRole('button', { name: '10:00' }));
}

// admin-operations spec, "Creación de turnos telefónicos sin seña": only
// nombre y teléfono are required; email/edad stay optional and never block
// the submission, matching CreatePhoneAppointmentRequestSchema exactly.
//
// paneles-y-turno-telefonico: barbero/servicio are real selects (never a
// pasted UUID) and there is no endTime field at all — the secretary never
// has that information, CreatePhoneAppointmentUseCase derives it from the
// selected service's durationMinutes server-side.
//
// panel-usable: startTime is no longer free text — it can only be one of
// the horarios GET /availability actually reports as free.
describe('PhoneAppointmentForm', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockResolvedValue(AVAILABLE_SLOTS);
  });

  it('submits with only the required fields, leaving email and age out, and no endTime at all', async () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    await fillRequiredFieldsAndPickStartTime();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar turno' }));

    const expected: CreatePhoneAppointmentRequest = {
      barberId: 'barber-1',
      serviceId: 'service-1',
      calendarDate: '2026-09-01',
      startTime: '10:00',
      client: { name: 'Marcos', phone: '3511234567', email: null, age: null },
    };
    expect(onSubmit).toHaveBeenCalledWith(expected);
    expect(vi.mocked(onSubmit).mock.calls[0]?.[0]).not.toHaveProperty('endTime');
  });

  it('includes email and age when the staff member loads them', async () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    await fillRequiredFieldsAndPickStartTime();
    fireEvent.change(screen.getByLabelText('Email (opcional)'), { target: { value: 'marcos@example.com' } });
    fireEvent.change(screen.getByLabelText('Edad (opcional)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar turno' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 } }),
    );
  });

  it('does not submit while name or phone is empty — the browser enforces required fields', () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    expect(screen.getByLabelText('Nombre')).toBeRequired();
    expect(screen.getByLabelText('Teléfono')).toBeRequired();
  });

  // The actual product gap: a developer's harness (paste a raw UUID) is not
  // something a person can operate with a client waiting on the phone.
  it('lists barbers and services by name in real selects, never a free-text UUID field', () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    const barberSelect = screen.getByLabelText('Barbero');
    expect(barberSelect.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Cristian Gomez' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Facundo Diaz' })).toBeInTheDocument();

    const serviceSelect = screen.getByLabelText('Servicio');
    expect(serviceSelect.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Corte clasico ($8.000)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Corte + Barba ($12.000)' })).toBeInTheDocument();
  });

  it('defaults barbero/servicio to the first option so a lazy submit still sends a valid id', () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    expect(screen.getByLabelText('Barbero')).toHaveValue('barber-1');
    expect(screen.getByLabelText('Servicio')).toHaveValue('service-1');
  });

  it('renders Fecha as a real date input', () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    expect(screen.getByLabelText('Fecha')).toHaveAttribute('type', 'date');
  });

  // The actual bug the shop owner hit: typing "10" or "10:00 am" into a free
  // text field was a 400 with no explanation. Now there is no text field at
  // all — only the horarios the server itself reports as free.
  it('offers only the start times GET /availability reports as free, never a free-text field', async () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    expect(screen.queryByLabelText('Hora de inicio')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/availability?barberId=barber-1&serviceId=service-1&date=2026-09-01'),
    );
    expect(await screen.findByRole('button', { name: '10:00' })).toBeInTheDocument();
  });

  it('keeps Guardar turno disabled until a start time is actually picked', async () => {
    const onSubmit = vi.fn();
    render(<PhoneAppointmentForm barbers={barbers} services={services} onSubmit={onSubmit} />);

    expect(screen.getByRole('button', { name: 'Guardar turno' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } });
    fireEvent.click(await screen.findByRole('button', { name: '10:00' }));

    expect(screen.getByRole('button', { name: 'Guardar turno' })).not.toBeDisabled();
  });
});
