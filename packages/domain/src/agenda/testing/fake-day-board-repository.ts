import type { ActorContext } from '../../access-control';
import type { DayBoardQueryResult, DayBoardRepository } from '../day-board-repository';

/**
 * In-memory `DayBoardRepository` test double. `.seed()` takes the full,
 * unnarrowed board for a date (as an owner/secretary would see it);
 * `findDayBoard` narrows it to `actor.barberId` the same way
 * `DrizzleDayBoardRepository` narrows its query — the same convention
 * `FakeAgendaRepository` already established — so a caller exercising only
 * this fake (e.g. an HTTP contract test with no real database) still
 * observes the real narrowing shape.
 */
export class FakeDayBoardRepository implements DayBoardRepository {
  readonly calls: Array<{ calendarDate: string; actor: ActorContext }> = [];
  private readonly byDate = new Map<string, DayBoardQueryResult>();

  seed(calendarDate: string, result: DayBoardQueryResult): void {
    this.byDate.set(calendarDate, result);
  }

  async findDayBoard(calendarDate: string, actor: ActorContext): Promise<DayBoardQueryResult> {
    this.calls.push({ calendarDate, actor });
    const full = this.byDate.get(calendarDate) ?? { columns: [], slots: [] };
    if (actor.barberId === undefined) {
      return full;
    }
    return {
      columns: full.columns.filter((column) => column.barberId === actor.barberId),
      slots: full.slots.filter((slot) => slot.barberId === actor.barberId),
    };
  }
}
