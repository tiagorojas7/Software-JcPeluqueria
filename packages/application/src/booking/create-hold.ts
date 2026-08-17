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
 * Per design.md "Encolado transaccional", the `hold.expire` job is enqueued
 * in the SAME transaction that persists the hold, so a rollback discards
 * both — no orphan expiry jobs that would refund + notify for a hold that
 * never committed. The transactional binding is the pg-boss adapter's
 * responsibility; here the contract is "after the hold commits, ask the
 * scheduler to fire its expiry no earlier than the hold's own `holdExpiresAt`",
 * which the same `Clock` computed — never a fresh wall-clock read.
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
    await this.holds.create(hold, input.searchWindow);
    await this.holdExpire.scheduleExpire({ holdId: hold.id, startAfter: hold.holdExpiresAt });
    return hold;
  }
}
