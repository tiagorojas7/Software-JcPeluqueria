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
  readonly beginCheckoutCalls: { holdId: string; paymentExpiresAt: Date }[] = [];
  readonly attachClientCalls: { holdId: string; clientId: string }[] = [];
  private readonly byId = new Map<string, Hold>();

  /**
   * @param confirmResult What every `confirm()` call resolves to.
   * @param beginCheckoutResult What every `beginCheckout()` call resolves to.
   * @param attachClientResult What every `attachClient()` call resolves to.
   */
  constructor(
    private readonly confirmResult: boolean = true,
    private readonly beginCheckoutResult: boolean = true,
    private readonly attachClientResult: boolean = true,
  ) {}

  /** Test-only seam so a spec can make `findById` resolve a hold it never
   *  went through `create()` for. */
  seed(hold: Hold): void {
    this.byId.set(hold.id, hold);
  }

  async create(hold: Hold, searchWindow: TimeWindow): Promise<void> {
    this.createCalls.push({ hold, searchWindow });
    this.byId.set(hold.id, hold);
  }

  async findById(holdId: string): Promise<Hold | null> {
    return this.byId.get(holdId) ?? null;
  }

  async confirm(holdId: string): Promise<boolean> {
    this.confirmCalls.push(holdId);
    return this.confirmResult;
  }

  async beginCheckout(holdId: string, paymentExpiresAt: Date): Promise<boolean> {
    this.beginCheckoutCalls.push({ holdId, paymentExpiresAt });
    return this.beginCheckoutResult;
  }

  async attachClient(holdId: string, clientId: string): Promise<boolean> {
    this.attachClientCalls.push({ holdId, clientId });
    if (this.attachClientResult) {
      const existing = this.byId.get(holdId);
      if (existing) {
        this.byId.set(holdId, { ...existing, clientId });
      }
    }
    return this.attachClientResult;
  }
}
