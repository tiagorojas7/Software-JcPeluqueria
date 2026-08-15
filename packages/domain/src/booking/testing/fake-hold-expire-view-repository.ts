import type { ExpiredHoldView, HoldExpireViewRepository } from '../expired-hold-view';

/**
 * In-memory `HoldExpireViewRepository` test double — records every
 * `loadForExpire` call and returns exactly the seeded view (or `null`), so a
 * unit test can stand up the `hold.expire` decision inputs (isHeld /
 * paymentPending / originOccupancyId / email) without a database, and assert
 * whether the use case looked the hold up at all.
 */
export class FakeHoldExpireViewRepository implements HoldExpireViewRepository {
  private readonly views = new Map<string, ExpiredHoldView>();
  readonly loadCalls: string[] = [];

  seed(view: ExpiredHoldView): void {
    this.views.set(view.holdId, view);
  }

  async loadForExpire(holdId: string): Promise<ExpiredHoldView | null> {
    this.loadCalls.push(holdId);
    return this.views.get(holdId) ?? null;
  }
}
