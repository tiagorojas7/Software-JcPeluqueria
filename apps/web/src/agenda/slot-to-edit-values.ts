import type { DayBoardSlot } from '@jc-barberia/contracts';

import type { EditAppointmentFormValues } from './EditAppointmentForm';
import { utcIsoToShopLocalTime } from '../shared/shop-time';

/**
 * B.6: `EditAppointmentForm` needs shop-local `calendarDate`/`startTime`/
 * `endTime` to pre-fill from a `DayBoardSlot`'s UTC `startsAt`/`endsAt` — the
 * same `utcIsoToShopLocalTime` conversion every other panel form already
 * uses for time. The calendar date is a plain slice, never re-derived
 * through the offset: every slot the shop ever offers stays within one
 * local calendar day (see that helper's own doc comment), so `startsAt`'s
 * UTC date IS the shop-local date.
 */
export function slotToEditValues(slot: DayBoardSlot): EditAppointmentFormValues {
  return {
    barberId: slot.barberId,
    serviceId: slot.serviceId,
    calendarDate: slot.startsAt.slice(0, 10),
    startTime: utcIsoToShopLocalTime(slot.startsAt),
    endTime: utcIsoToShopLocalTime(slot.endsAt),
  };
}
