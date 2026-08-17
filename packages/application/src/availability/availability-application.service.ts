import type { Clock } from '@jc-barberia/domain';
import type { AvailabilityService as DomainAvailabilityService, TimeWindow, Service } from '@jc-barberia/domain';
import type { HoldRepository } from '@jc-barberia/domain';
import { HOLD_DURATION_MINUTES } from '@jc-barberia/domain';

export interface AvailabilityInput {
  readonly serviceId: string;
  readonly date: string;
  readonly barberId?: string;
}

export interface AvailabilityOutput {
  readonly service: Service;
  readonly barber?: {
    readonly id: string;
    readonly name: string;
  };
  readonly workingWindow: TimeWindow;
  readonly freeSlots: TimeWindow[];
}

export class AvailabilityApplicationService {
  constructor(
    private readonly clock: Clock,
    private readonly holds: HoldRepository,
    private readonly services: DomainAvailabilityService,
  ) {}

  async execute(input: AvailabilityInput): Promise<AvailabilityOutput> {
    const service = await this.services.findById(input.serviceId);
    if (!service) {
      throw new Error('Service not found');
    }

    const barberId = input.barberId ?? undefined;
    const workingWindows = this.services.workingWindows({
      barberId: barberId || '',
      date: input.date,
      shopHours: [],
      barberSchedule: [],
      timeOff: [],
    });

    let freeSlots: TimeWindow[] = [];
    if (workingWindows.length > 0 && barberId) {
      const holdRepo = this.holds;
      // For each working window, compute free ranges after considering holds
      freeSlots = workingWindows.flatMap((window) =>
        await holdRepo.freeRanges(barberId, window),
      );
    }

    return {
      service,
      barber: barberId ? { id: barberId, name: '' } : undefined,
      workingWindow: workingWindows[0] || { start: new Date(), end: new Date() },
      freeSlots,
    };
  }
}