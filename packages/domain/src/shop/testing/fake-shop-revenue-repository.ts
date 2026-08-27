import type { TimeWindow } from '../../availability';
import type { ShopRevenueRecord, ShopRevenueRepository } from '../shop-revenue-repository';

/**
 * In-memory `ShopRevenueRepository` test double. `.seed()` takes the
 * already-in-range `realizado` appointments across every barber — same
 * convention as `FakeBarberPerformanceRepository`: the caller decides what
 * belongs to the period by what it seeds, range/status filtering is
 * PostgreSQL, proved against a real database by
 * `DrizzleShopRevenueRepository`'s own Testcontainers spec.
 */
export class FakeShopRevenueRepository implements ShopRevenueRepository {
  readonly calls: TimeWindow[] = [];
  private records: readonly ShopRevenueRecord[] = [];

  seed(records: readonly ShopRevenueRecord[]): void {
    this.records = records;
  }

  async findCompletedAppointments(range: TimeWindow): Promise<readonly ShopRevenueRecord[]> {
    this.calls.push(range);
    return this.records;
  }
}
