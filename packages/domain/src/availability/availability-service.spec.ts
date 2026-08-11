import { describe, expect, it } from 'vitest';

import { FakeClock } from '../shared/ports/testing/fake-clock';
import { AvailabilityService } from './availability-service';
import { createBarberSchedule, createBarberTimeOff, createShopHours } from './entities';

describe('AvailabilityService.freeSlots', () => {
  const monday = { dayOfWeek: 1 as const, opensAt: '09:00', closesAt: '20:00' };

  it('returns the intersection of shop hours and barber schedule for that day', () => {
    const service = new AvailabilityService(new FakeClock());

    const slots = service.freeSlots({
      barberId: 'b1',
      date: '2026-08-10', // a Monday
      shopHours: [createShopHours(monday)],
      barberSchedule: [createBarberSchedule({ barberId: 'b1', dayOfWeek: 1, opensAt: '10:00', closesAt: '18:00' })],
      timeOff: [],
    });

    expect(slots).toHaveLength(1);
    // 2026-08-10T10:00-03:00 === 2026-08-10T13:00:00.000Z
    expect(slots[0]?.start.toISOString()).toBe('2026-08-10T13:00:00.000Z');
    // 2026-08-10T18:00-03:00 === 2026-08-10T21:00:00.000Z
    expect(slots[0]?.end.toISOString()).toBe('2026-08-10T21:00:00.000Z');
  });

  it('returns nothing when the shop is closed that day of week', () => {
    const service = new AvailabilityService(new FakeClock());

    const slots = service.freeSlots({
      barberId: 'b1',
      date: '2026-08-09', // a Sunday — no ShopHours row provided
      shopHours: [createShopHours(monday)],
      barberSchedule: [createBarberSchedule({ barberId: 'b1', dayOfWeek: 1, opensAt: '10:00', closesAt: '18:00' })],
      timeOff: [],
    });

    expect(slots).toEqual([]);
  });

  it('returns nothing when the barber has no schedule for that day of week', () => {
    const service = new AvailabilityService(new FakeClock());

    const slots = service.freeSlots({
      barberId: 'b1',
      date: '2026-08-10', // a Monday, but the barber's schedule below is Tuesday
      shopHours: [createShopHours(monday)],
      barberSchedule: [createBarberSchedule({ barberId: 'b1', dayOfWeek: 2, opensAt: '10:00', closesAt: '18:00' })],
      timeOff: [],
    });

    expect(slots).toEqual([]);
  });

  it('returns nothing when the barber is off on that exact date', () => {
    const service = new AvailabilityService(new FakeClock());

    const slots = service.freeSlots({
      barberId: 'b1',
      date: '2026-08-10',
      shopHours: [createShopHours(monday)],
      barberSchedule: [createBarberSchedule({ barberId: 'b1', dayOfWeek: 1, opensAt: '10:00', closesAt: '18:00' })],
      timeOff: [createBarberTimeOff({ barberId: 'b1', startDate: '2026-08-09', endDate: '2026-08-11' })],
    });

    expect(slots).toEqual([]);
  });

  it('returns nothing when the barber schedule and shop hours do not overlap at all', () => {
    const service = new AvailabilityService(new FakeClock());

    const slots = service.freeSlots({
      barberId: 'b1',
      date: '2026-08-10',
      shopHours: [createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '12:00' })],
      barberSchedule: [createBarberSchedule({ barberId: 'b1', dayOfWeek: 1, opensAt: '13:00', closesAt: '18:00' })],
      timeOff: [],
    });

    expect(slots).toEqual([]);
  });

  it('ignores another barber schedule sharing the same day', () => {
    const service = new AvailabilityService(new FakeClock());

    const slots = service.freeSlots({
      barberId: 'b1',
      date: '2026-08-10',
      shopHours: [createShopHours(monday)],
      barberSchedule: [
        createBarberSchedule({ barberId: 'b2', dayOfWeek: 1, opensAt: '10:00', closesAt: '18:00' }),
      ],
      timeOff: [],
    });

    expect(slots).toEqual([]);
  });

  it('rolls across a month boundary via ShopClock, never a direct Date', () => {
    const service = new AvailabilityService(new FakeClock());

    const slots = service.freeSlots({
      barberId: 'b1',
      date: '2026-01-31', // a Saturday
      shopHours: [createShopHours({ dayOfWeek: 6, opensAt: '09:00', closesAt: '23:30' })],
      barberSchedule: [
        createBarberSchedule({ barberId: 'b1', dayOfWeek: 6, opensAt: '09:00', closesAt: '23:30' }),
      ],
      timeOff: [],
    });

    expect(slots).toHaveLength(1);
    // 2026-01-31T23:30-03:00 crosses into February in UTC.
    expect(slots[0]?.end.toISOString()).toBe('2026-02-01T02:30:00.000Z');
  });
});
