import {
  type TimeWindow,
  type WalkInOccupancy,
  type WalkInRepository,
} from '@jc-barberia/domain';

export interface CreateWalkInInput {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  /** Null when the walk-in is an unidentified customer — service and barber are the only required inputs. */
  readonly clientId: string | null;
  readonly timeRange: TimeWindow;
  /** Where alternatives would be searched if the slot turned out to be taken, for parity with the phone flow. */
  readonly searchWindow: TimeWindow;
}

export interface WalkIn {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string | null;
  readonly channel: 'walk_in';
  readonly timeRange: TimeWindow;
  readonly status: 'realizado';
  readonly deposit: { readonly kind: 'not_applicable' };
}

/**
 * Carga de walk-ins (admin-operations spec, "Carga de walk-ins" +
 * appointment-lifecycle spec, "Los walk-ins ingresan directamente como
 * realizado"): inserts the barber's slot straight into `realizado` via
 * `WalkInRepository`, with `channel='walk_in'` and no seña whatsoever. There
 * is deliberately no hold → confirm dance and no `reservado` step — so the
 * walk-in is never subject to the nightly sweep, and the `realizado` row
 * occupies the slot under the same `no_overlap_per_barber` EXCLUDE constraint
 * every other occupancy uses, which is why the horario stops being available
 * for online booking the moment the walk-in lands.
 */
export class CreateWalkInUseCase {
  constructor(private readonly walkIns: WalkInRepository) {}

  async execute(input: CreateWalkInInput): Promise<WalkIn> {
    const occupancy: WalkInOccupancy = {
      id: input.id,
      barberId: input.barberId,
      serviceId: input.serviceId,
      clientId: input.clientId,
      timeRange: input.timeRange,
    };
    await this.walkIns.create(occupancy, input.searchWindow);
    return {
      id: occupancy.id,
      barberId: occupancy.barberId,
      serviceId: occupancy.serviceId,
      clientId: occupancy.clientId,
      channel: 'walk_in',
      timeRange: occupancy.timeRange,
      status: 'realizado',
      deposit: { kind: 'not_applicable' },
    };
  }
}
