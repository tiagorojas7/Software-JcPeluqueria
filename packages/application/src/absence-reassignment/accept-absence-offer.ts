import {
  SlotUnavailableError,
  type AppointmentRepository,
  type HoldRepository,
  type TimeWindow,
} from '@jc-barberia/domain';

export interface AcceptOfferInput {
  readonly offerHoldId: string;
  /** Where alternatives are searched if the original loses the race for the
   *  offered slot — the same role `CreateHoldInput.searchWindow` plays. */
  readonly searchWindow: TimeWindow;
}

export type AcceptOfferResult =
  | { readonly outcome: 'reassigned' }
  | { readonly outcome: 'offer-expired' }
  | { readonly outcome: 'slot-taken'; readonly alternatives: readonly TimeWindow[] };

/**
 * barber-absence-reassignment spec, "Aceptación reagenda sin mover dinero":
 * the client accepted one of the offered same-day holds. The ORIGINAL
 * appointment row moves via `AppointmentRepository.updateSchedule` — an
 * UPDATE of `barberId`/`timeRange`, `deposit_id` untouched — never an
 * INSERT of a new row plus a DELETE/cancel of the old one. No `PaymentPort`
 * is injected at all: the signature itself is proof this use case cannot
 * charge or refund anything, exactly like `resolveDepositForCompletion`.
 *
 * Ordering matters here (security/correctness-relevant, not arbitrary):
 * the offer hold is RELEASED before the original's schedule update runs.
 * The offer hold occupies the exact (barberId, timeRange) the original is
 * about to claim; both rows being simultaneously `held`/`reservado` on the
 * same range would trip the `no_overlap_per_barber` EXCLUDE constraint
 * against ITSELF. Releasing first vacates that range so the original's own
 * UPDATE is the only thing left claiming it.
 */
export class AcceptOfferUseCase {
  constructor(
    private readonly holds: HoldRepository,
    private readonly appointments: AppointmentRepository,
  ) {}

  async execute(input: AcceptOfferInput): Promise<AcceptOfferResult> {
    const offer = await this.holds.findById(input.offerHoldId);
    if (!offer || offer.originOccupancyId === null) {
      return { outcome: 'offer-expired' };
    }

    // Re-validates the offer is still live (held, not expired) in the same
    // statement — the identical re-validate-then-write shape `confirm()`/
    // `beginCheckout()` already use elsewhere in this codebase.
    const released = await this.holds.release(input.offerHoldId);
    if (!released) {
      return { outcome: 'offer-expired' };
    }

    try {
      await this.appointments.updateSchedule(
        offer.originOccupancyId,
        { barberId: offer.barberId, serviceId: offer.serviceId, timeRange: offer.timeRange },
        input.searchWindow,
      );
    } catch (error) {
      if (error instanceof SlotUnavailableError) {
        return { outcome: 'slot-taken', alternatives: error.alternatives };
      }
      throw error;
    }

    return { outcome: 'reassigned' };
  }
}
