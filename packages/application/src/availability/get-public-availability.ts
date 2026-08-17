import {
  AvailabilityService,
  sliceIntoSlots,
  type BarberRepository,
  type Clock,
  type FreeRangesQuery,
  type ScheduleRepository,
  type ServiceRepository,
  type TimeWindow,
} from '@jc-barberia/domain';

export interface GetPublicAvailabilityInput {
  readonly barberId: string;
  readonly serviceId: string;
  /** ISO calendar date, `YYYY-MM-DD`, shop-local. */
  readonly date: string;
}

export interface GetPublicAvailabilityResult {
  readonly slots: readonly TimeWindow[];
}

/**
 * client-booking spec, "Exploración sin cuenta": lets any visitor browse
 * bookable start times with no session, no `ActorContext`, no permission
 * check — there is nothing to authenticate here by construction.
 *
 * Composes three already-existing pieces, in order, and adds no business
 * rule of its own:
 *   1. `AvailabilityService.workingWindows` — is the barber working, and when.
 *   2. `FreeRangesQuery.findFreeRanges` — subtract everything already
 *      held/reservado/realizado (Phase 2's occupancy model).
 *   3. `sliceIntoSlots` — cut what remains into concrete, bookable
 *      `Service.durationMinutes`-sized start times.
 *
 * An unknown `serviceId` or a day the barber does not work both resolve to
 * an empty `slots` list, never a throw — an anonymous visitor browsing
 * availability is not an exceptional path.
 */
export class GetPublicAvailabilityUseCase {
  private readonly availabilityService: AvailabilityService;

  constructor(
    private readonly barbers: BarberRepository,
    private readonly services: ServiceRepository,
    private readonly schedules: ScheduleRepository,
    private readonly freeRangesQuery: FreeRangesQuery,
    private readonly clock: Clock,
  ) {
    this.availabilityService = new AvailabilityService(clock);
  }

  async execute(input: GetPublicAvailabilityInput): Promise<GetPublicAvailabilityResult> {
    const [service, barber] = await Promise.all([
      this.services.findById(input.serviceId),
      this.barbers.findById(input.barberId),
    ]);
    if (!service || !barber || !barber.active) {
      return { slots: [] };
    }

    const [shopHours, barberSchedule, timeOff] = await Promise.all([
      this.schedules.listShopHours(),
      this.schedules.listBarberSchedule(input.barberId),
      this.schedules.listBarberTimeOff(input.barberId),
    ]);

    const workingWindows = this.availabilityService.workingWindows({
      barberId: input.barberId,
      date: input.date,
      shopHours,
      barberSchedule,
      timeOff,
    });

    const slots: TimeWindow[] = [];
    for (const window of workingWindows) {
      const free = await this.freeRangesQuery.findFreeRanges(input.barberId, window);
      for (const freeWindow of free) {
        slots.push(...sliceIntoSlots(freeWindow, service.durationMinutes, this.clock));
      }
    }
    return { slots };
  }
}
