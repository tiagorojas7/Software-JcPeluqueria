import { describe, expect, it } from 'vitest';

import {
  AvailabilityValidationError,
  createBarber,
  createBarberSchedule,
  createBarberTimeOff,
  createService,
  createShopHours,
} from './entities';

describe('createBarber', () => {
  it('creates a barber with a trimmed name', () => {
    const barber = createBarber({ id: 'b1', name: '  Juan  ', active: true });

    expect(barber).toEqual({ id: 'b1', name: 'Juan', active: true });
  });

  it('rejects an empty name', () => {
    expect(() => createBarber({ id: 'b1', name: '   ', active: true })).toThrow(
      AvailabilityValidationError,
    );
  });
});

describe('createService', () => {
  it('creates a service with a positive duration and non-negative price', () => {
    const service = createService({
      id: 's1',
      name: 'Corte clásico',
      durationMinutes: 30,
      priceCents: 500000,
    });

    expect(service).toEqual({
      id: 's1',
      name: 'Corte clásico',
      durationMinutes: 30,
      priceCents: 500000,
    });
  });

  it('rejects a zero or negative duration', () => {
    expect(() =>
      createService({ id: 's1', name: 'Corte', durationMinutes: 0, priceCents: 100 }),
    ).toThrow(AvailabilityValidationError);
  });

  it('rejects a negative price', () => {
    expect(() =>
      createService({ id: 's1', name: 'Corte', durationMinutes: 30, priceCents: -1 }),
    ).toThrow(AvailabilityValidationError);
  });
});

describe('createShopHours', () => {
  it('creates shop hours for a valid day and wall-clock range', () => {
    const hours = createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '20:00' });

    expect(hours).toEqual({ dayOfWeek: 1, opensAt: '09:00', closesAt: '20:00' });
  });

  it('rejects a day of week outside 0-6', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid for the RED case
      createShopHours({ dayOfWeek: 7, opensAt: '09:00', closesAt: '20:00' }),
    ).toThrow(AvailabilityValidationError);
  });

  it('rejects a malformed wall-clock time', () => {
    expect(() =>
      createShopHours({ dayOfWeek: 1, opensAt: '9:00', closesAt: '20:00' }),
    ).toThrow(AvailabilityValidationError);
  });

  it('rejects closesAt at or before opensAt', () => {
    expect(() =>
      createShopHours({ dayOfWeek: 1, opensAt: '20:00', closesAt: '20:00' }),
    ).toThrow(AvailabilityValidationError);
  });
});

describe('createBarberSchedule', () => {
  it('creates a barber schedule tied to a barber and a day', () => {
    const schedule = createBarberSchedule({
      barberId: 'b1',
      dayOfWeek: 2,
      opensAt: '10:00',
      closesAt: '18:00',
    });

    expect(schedule).toEqual({ barberId: 'b1', dayOfWeek: 2, opensAt: '10:00', closesAt: '18:00' });
  });

  it('rejects an empty barberId', () => {
    expect(() =>
      createBarberSchedule({ barberId: '', dayOfWeek: 2, opensAt: '10:00', closesAt: '18:00' }),
    ).toThrow(AvailabilityValidationError);
  });
});

describe('createBarberTimeOff', () => {
  it('creates a single-day time off when startDate equals endDate', () => {
    const timeOff = createBarberTimeOff({
      barberId: 'b1',
      startDate: '2026-08-20',
      endDate: '2026-08-20',
    });

    expect(timeOff).toEqual({ barberId: 'b1', startDate: '2026-08-20', endDate: '2026-08-20' });
  });

  it('creates a multi-day time off range', () => {
    const timeOff = createBarberTimeOff({
      barberId: 'b1',
      startDate: '2026-08-20',
      endDate: '2026-08-22',
    });

    expect(timeOff.endDate).toBe('2026-08-22');
  });

  it('rejects a range where startDate is after endDate', () => {
    expect(() =>
      createBarberTimeOff({ barberId: 'b1', startDate: '2026-08-22', endDate: '2026-08-20' }),
    ).toThrow(AvailabilityValidationError);
  });

  it('rejects a malformed date', () => {
    expect(() =>
      createBarberTimeOff({ barberId: 'b1', startDate: '2026/08/20', endDate: '2026-08-20' }),
    ).toThrow(AvailabilityValidationError);
  });
});
