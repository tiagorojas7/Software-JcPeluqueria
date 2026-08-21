import type { DayBoardSlot } from '@jc-barberia/contracts';
import { describe, expect, it } from 'vitest';

import { slotToEditValues } from './slot-to-edit-values';

function aSlot(overrides: Partial<DayBoardSlot> = {}): DayBoardSlot {
  return {
    id: 'slot-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    serviceName: 'Corte clasico',
    status: 'reservado',
    startsAt: '2026-09-01T13:00:00.000Z',
    endsAt: '2026-09-01T13:30:00.000Z',
    allowedActions: ['edit'],
    ...overrides,
  };
}

// B.6: `AdminDayBoardPanel` pre-fills `EditAppointmentForm` from the slot
// the staff member clicked "Editar" on, instead of an empty form — this is
// the pure conversion from the slot's UTC `startsAt`/`endsAt` (the only
// shape `DayBoardSlot` carries) to the shop-local `calendarDate`/
// `startTime`/`endTime` triple `EditAppointmentRequestSchema` expects, the
// same `utcIsoToShopLocalTime` offset every other panel form already uses.
describe('slotToEditValues', () => {
  it('converts a slot into shop-local calendarDate/startTime/endTime, keeping barberId/serviceId', () => {
    const slot = aSlot();

    expect(slotToEditValues(slot)).toEqual({
      barberId: 'barber-1',
      serviceId: 'service-1',
      calendarDate: '2026-09-01',
      startTime: '10:00',
      endTime: '10:30',
    });
  });

  it('never crosses midnight for a shop slot — same calendarDate for start and end', () => {
    const slot = aSlot({ startsAt: '2026-09-01T22:45:00.000Z', endsAt: '2026-09-01T23:15:00.000Z' });

    expect(slotToEditValues(slot)).toEqual({
      barberId: 'barber-1',
      serviceId: 'service-1',
      calendarDate: '2026-09-01',
      startTime: '19:45',
      endTime: '20:15',
    });
  });
});
