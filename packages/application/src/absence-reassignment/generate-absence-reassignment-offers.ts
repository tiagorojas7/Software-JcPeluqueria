import {
  AvailabilityService,
  findNearestAvailable,
  sliceIntoSlots,
  type Appointment,
  type AvailableCandidate,
  type BarberRepository,
  type Clock,
  type FreeRangesQuery,
  type Hold,
  type ScheduleRepository,
  type ServiceRepository,
} from '@jc-barberia/domain';

import type { CreateHold } from '../booking/create-hold';

export interface AbsenceOfferResult {
  readonly originalAppointmentId: string;
  readonly outcome: 'offered' | 'no-availability';
  readonly hold: Hold | null;
}

/**
 * barber-absence-reassignment spec, "Ofertas del mismo día, de cualquier
 * barbero": for each affected turno (produced by `MarkBarberAbsentUseCase`),
 * searches every ACTIVE barber's free windows on the ORIGIN turno's own
 * calendar day (never just the absent barber's), and claims the nearest one
 * with a 15-minute hold carrying `originOccupancyId`. Reuses `CreateHold`
 * (task 2.8) unmodified with `scope: 'same-day'` — no second hold-creation
 * code path. Task 12.4's scope stops at "what did we offer"; dispatching the
 * notification is task 12.5/12.6, added on top of this same class.
 *
 * "no-availability" (no candidate anywhere, on any barber, that day) is a
 * legitimate outcome, not an error: staff still knows which turnos need a
 * manual phone call, from `MarkBarberAbsentUseCase`'s own return value.
 */
export class GenerateAbsenceReassignmentOffers {
  constructor(
    private readonly barbers: BarberRepository,
    private readonly services: ServiceRepository,
    private readonly schedules: ScheduleRepository,
    private readonly freeRangesQuery: FreeRangesQuery,
    private readonly createHold: CreateHold,
    private readonly clock: Clock,
  ) {}

  /**
   * Processes `affected` SEQUENTIALLY, one appointment at a time — never
   * `Promise.all`. Each `CreateHold` call writes a `held` row that the NEXT
   * iteration's `FreeRangesQuery` reads back, which is what stops two
   * different affected clients from ever being offered the exact same slot.
   */
  async execute(affected: readonly Appointment[]): Promise<AbsenceOfferResult[]> {
    const results: AbsenceOfferResult[] = [];
    for (const appointment of affected) {
      results.push(await this.generateOneOffer(appointment));
    }
    return results;
  }

  private async generateOneOffer(appointment: Appointment): Promise<AbsenceOfferResult> {
    const service = await this.services.findById(appointment.serviceId);
    if (!service) {
      return { originalAppointmentId: appointment.id, outcome: 'no-availability', hold: null };
    }

    const originDate = this.clock.calendarDateOf(appointment.timeRange.start);
    const candidates = await this.collectCandidates(originDate, service.durationMinutes);

    const nearest = findNearestAvailable({
      candidates,
      originDate,
      referenceInstant: appointment.timeRange.start,
      scope: 'same-day',
    });
    if (!nearest || !nearest.barberId) {
      return { originalAppointmentId: appointment.id, outcome: 'no-availability', hold: null };
    }

    const hold = await this.createHold.execute({
      id: crypto.randomUUID(),
      barberId: nearest.barberId,
      serviceId: appointment.serviceId,
      clientId: appointment.clientId,
      channel: appointment.channel,
      timeRange: nearest.window,
      searchWindow: this.clock.businessDayBounds(originDate),
      originOccupancyId: appointment.id,
    });

    return { originalAppointmentId: appointment.id, outcome: 'offered', hold };
  }

  /**
   * "entre cualquier barbero disponible y no solo el ausente" — every ACTIVE
   * barber's free windows for `originDate`, not filtered to exclude the
   * absent one either: their own occupancy (the very appointment being
   * reassigned) already keeps that exact range out of their free ranges, so
   * nothing extra has to special-case them.
   */
  private async collectCandidates(originDate: string, durationMinutes: number): Promise<AvailableCandidate[]> {
    const availability = new AvailabilityService(this.clock);
    const shopHours = await this.schedules.listShopHours();
    const activeBarbers = (await this.barbers.list()).filter((barber) => barber.active);

    const candidates: AvailableCandidate[] = [];
    for (const barber of activeBarbers) {
      const [barberSchedule, timeOff] = await Promise.all([
        this.schedules.listBarberSchedule(barber.id),
        this.schedules.listBarberTimeOff(barber.id),
      ]);
      const workingWindows = availability.workingWindows({
        barberId: barber.id,
        date: originDate,
        shopHours,
        barberSchedule,
        timeOff,
      });
      for (const window of workingWindows) {
        const free = await this.freeRangesQuery.findFreeRanges(barber.id, window);
        for (const freeWindow of free) {
          for (const slot of sliceIntoSlots(freeWindow, durationMinutes, this.clock)) {
            candidates.push({ date: originDate, window: slot, barberId: barber.id });
          }
        }
      }
    }
    return candidates;
  }
}
