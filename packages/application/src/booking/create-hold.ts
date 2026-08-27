import {
  HOLD_DURATION_MINUTES,
  type Clock,
  type Hold,
  type HoldExpireScheduler,
  type HoldRepository,
  type OccupancyChannel,
  type TimeWindow,
} from '@jc-barberia/domain';

export interface CreateHoldInput {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string | null;
  readonly channel: OccupancyChannel;
  readonly timeRange: TimeWindow;
  /** Where alternatives are searched if the slot turns out to be taken. */
  readonly searchWindow: TimeWindow;
  /**
   * Set only by `GenerateAbsenceReassignmentOffers` (barber-absence-
   * reassignment, task 12.4): the `reservado` appointment this hold is
   * offered as a same-day replacement for. Every other caller (client-
   * booking, phone/walk-in, `ConfirmHold`'s reoffer) omits it, which
   * defaults to `null` — an ordinary hold with nothing to replace.
   */
  readonly originOccupancyId?: string | null;
}

/**
 * Claims a slot for exactly `HOLD_DURATION_MINUTES`. The duration is a
 * business rule this use case enforces via the injected `Clock` — callers
 * never supply `holdExpiresAt` themselves, and `HoldRepository.create` only
 * knows how to persist an already-formed `Hold`.
 *
 * design.md's "Encolado transaccional" wants the hold and its `hold.expire`
 * job to commit together. `PgBossHoldExpireScheduler` can do that — it takes
 * an optional `currentTransaction` — but no composition root supplies one,
 * so in production these are two independent writes. The ordering below is
 * what makes that safe; see `execute`'s own comment.
 *
 * `startAfter` is always the hold's own `holdExpiresAt`, computed by the
 * same `Clock` — never a fresh wall-clock read.
 */
export class CreateHold {
  constructor(
    private readonly holds: HoldRepository,
    private readonly clock: Clock,
    private readonly holdExpire: HoldExpireScheduler,
  ) {}

  async execute(input: CreateHoldInput): Promise<Hold> {
    const hold: Hold = {
      id: input.id,
      barberId: input.barberId,
      serviceId: input.serviceId,
      clientId: input.clientId,
      channel: input.channel,
      timeRange: input.timeRange,
      holdExpiresAt: this.clock.addMinutes(this.clock.now(), HOLD_DURATION_MINUTES),
      originOccupancyId: input.originOccupancyId ?? null,
    };
    // Schedule BEFORE persisting, deliberately. The two writes are not
    // actually transactional in production — every Nest module builds
    // `PgBossHoldExpireScheduler` without its optional `currentTransaction`,
    // so the enqueue is an independent network call that can fail on its
    // own. Of the two possible orders only this one is safe: a job for a
    // hold that never committed is an explicit no-op in `ExpireHold` (its
    // `!view` gate), while a committed hold with no job never expires — and
    // for an absence-offer hold that means the origin's settled seña is
    // never refunded and the origin turno never auto-cancels, permanently.
    await this.holdExpire.scheduleExpire({ holdId: hold.id, startAfter: hold.holdExpiresAt });
    await this.holds.create(hold, input.searchWindow);
    return hold;
  }
}
