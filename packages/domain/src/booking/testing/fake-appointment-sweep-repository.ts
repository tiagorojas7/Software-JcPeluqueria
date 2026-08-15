import type { BusinessDayBounds } from '../../shared/ports/clock.port';
import type { AppointmentSweepRepository } from '../appointment-sweep-repository';

/**
 * In-memory `AppointmentSweepRepository` test double. Records exactly the
 * bounds it was asked to sweep and returns a configurable count, so a
 * `DailySweepUseCase` unit test can assert the cron's wiring — the day the
 * job resolved, and that the count it returns is the repo's — without a
 * database. The deposit-agnostic + range-filter contract lives in the real
 * `DrizzleAppointmentSweepRepository` (its Testcontainers suite, 6.8/6.9);
 * this double only stands in for the orchestration.
 */
export class FakeAppointmentSweepRepository implements AppointmentSweepRepository {
  readonly receivedBounds: BusinessDayBounds[] = [];
  /** What `transitionUnmarked` resolves to — tests set this before running. */
  returnCount = 0;

  async transitionUnmarked(bounds: BusinessDayBounds): Promise<number> {
    this.receivedBounds.push(bounds);
    return this.returnCount;
  }
}
