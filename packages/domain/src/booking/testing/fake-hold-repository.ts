import type { TimeWindow } from '../../availability';
import type { Hold, HoldRepository } from '../hold';

export interface RecordedCreateCall {
  readonly hold: Hold;
  readonly searchWindow: TimeWindow;
}

/**
 * In-memory `HoldRepository` test double for application-layer use case
 * tests — the same role `FakeClock` plays for `Clock`. Real conflict
 * detection only exists against PostgreSQL's `EXCLUDE` constraint (see
 * `DrizzleHoldRepository`'s Testcontainers suite); this fake never rejects,
 * it only records what it was asked to do so a use case's orchestration can
 * be asserted on without a database.
 */
export class FakeHoldRepository implements HoldRepository {
  readonly createCalls: RecordedCreateCall[] = [];
  readonly confirmCalls: string[] = [];

  /** @param confirmResult What every `confirm()` call resolves to. */
  constructor(private readonly confirmResult: boolean = true) {}

  async create(hold: Hold, searchWindow: TimeWindow): Promise<void> {
    this.createCalls.push({ hold, searchWindow });
  }

  async confirm(holdId: string): Promise<boolean> {
    this.confirmCalls.push(holdId);
    return this.confirmResult;
  }
}
