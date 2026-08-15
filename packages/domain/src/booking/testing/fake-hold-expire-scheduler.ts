import type { HoldExpireScheduler } from '../hold-expire-scheduler';

export interface RecordedScheduleExpireCall {
  readonly holdId: string;
  readonly startAfter: Date;
}

/** In-memory `HoldExpireScheduler` test double — records every enqueue call,
 *  never runs one, so a unit test can assert `hold.expire` was (or was not)
 *  scheduled with the right `startAfter` without a real queue. */
export class FakeHoldExpireScheduler implements HoldExpireScheduler {
  readonly scheduleCalls: RecordedScheduleExpireCall[] = [];

  async scheduleExpire(input: { holdId: string; startAfter: Date }): Promise<void> {
    this.scheduleCalls.push({ holdId: input.holdId, startAfter: input.startAfter });
  }
}