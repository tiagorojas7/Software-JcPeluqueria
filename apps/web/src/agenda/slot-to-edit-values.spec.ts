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
// the pure conversion from the slot's UTC `startsAt` (the only field
// `EditAppointmentFormValues` still needs a conversion for) to the
// shop-local `calendarDate`/`startTime` pair `EditAppointmentRequestSchema`
// expects, the same `utcIsoToShopLocalTime` offset every other panel form
// already uses.
//
// panel-usable: no more `endTime` — `EditAppointmentUseCase` derives it
// server-side from the target service's `durationMinutes`, so this
// conversion has nothing to compute it from (or for) any more.
describe('slotToEditValues', () => {
  it('converts a slot into shop-local calendarDate/startTime, keeping barberId/serviceId, and never an endTime', () => {
    const slot = aSlot();

    expect(slotToEditValues(slot)).toEqual({
      barberId: 'barber-1',
      serviceId: 'service-1',
      calendarDate: '2026-09-01',
      startTime: '10:00',
    });
  });

  it('never crosses midnight for a shop slot — the UTC date slice IS the shop-local calendarDate', () => {
    const slot = aSlot({ startsAt: '2026-09-01T22:45:00.000Z', endsAt: '2026-09-01T23:15:00.000Z' });

    expect(slotToEditValues(slot)).toEqual({
      barberId: 'barber-1',
      serviceId: 'service-1',
      calendarDate: '2026-09-01',
      startTime: '19:45',
    });
  });
});
