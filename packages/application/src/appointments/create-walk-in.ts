import {
  type Clock,
  type ClientRepository,
  type ServiceRepository,
  type TimeWindow,
  type WalkInOccupancy,
  type WalkInRepository,
} from '@jc-barberia/domain';

/** Same rule `CreatePhoneAppointmentUseCase`/`EditAppointmentUseCase` already
 *  enforce: the duration is never something a caller restates by hand. */
export class WalkInServiceNotFoundError extends Error {
  constructor(readonly serviceId: string) {
    super(`No service found with id "${serviceId}"`);
    this.name = 'WalkInServiceNotFoundError';
  }
}

export interface CreateWalkInInput {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  /**
   * A walk-in is someone who showed up without an appointment: they may
   * already be a known client, or nobody at all. Rather than asking the
   * front desk to paste a `clientId` (a raw UUID nobody has memorized), this
   * takes the same identifier every other client-facing lookup in this
   * codebase uses — a phone number — and looks up an EXISTING client by it
   * (`ClientRepository.findByPhone`, the same lookup
   * `CreatePhoneAppointmentUseCase` performs). Unlike that phone-booking
   * flow, this never CREATES a client from just a phone number: a phone
   * booking always has a name to go with it, a walk-in might not, and
   * writing a client record with no name would not be an honest one. A
   * missing or unmatched phone leaves the walk-in linked to no client at
   * all — `clientId: null`, the existing "cliente no identificado" case —
   * rather than fabricating a record.
   */
  readonly clientPhone?: string | null;
  /** Shop-local instant the walk-in starts. The end is never supplied by the
   *  caller — it is always derived from the selected service's
   *  `durationMinutes` (see `WalkInServiceNotFoundError`'s doc comment). */
  readonly startsAt: Date;
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
  constructor(
    private readonly walkIns: WalkInRepository,
    private readonly clients: ClientRepository,
    private readonly services: ServiceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateWalkInInput): Promise<WalkIn> {
    const service = await this.services.findById(input.serviceId);
    if (!service) {
      throw new WalkInServiceNotFoundError(input.serviceId);
    }

    const client = input.clientPhone ? await this.clients.findByPhone(input.clientPhone) : null;

    const timeRange: TimeWindow = {
      start: input.startsAt,
      end: this.clock.addMinutes(input.startsAt, service.durationMinutes),
    };

    const occupancy: WalkInOccupancy = {
      id: input.id,
      barberId: input.barberId,
      serviceId: input.serviceId,
      clientId: client?.id ?? null,
      timeRange,
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
