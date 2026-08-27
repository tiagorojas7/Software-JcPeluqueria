import type { Barber, BarberSchedule, BarberTimeOff, DayOfWeek, Service, ShopHours } from '../entities';
import type { BarberRepository, ScheduleRepository, ServiceRepository } from '../ports';

/**
 * In-memory `BarberRepository`/`ServiceRepository`/`ScheduleRepository` test
 * doubles. Phase 1 never needed these (its only application-layer consumer —
 * `GetPublicAvailabilityUseCase`, Phase 9 — did not exist yet); real CRUD
 * semantics are proven against PostgreSQL in
 * `packages/infrastructure/src/availability/repositories.spec.ts`. These
 * three are grouped in one file because nothing outside a shared fixture
 * ever seeds them independently — a working-window computation always needs
 * all three together.
 */
export class FakeBarberRepository implements BarberRepository {
  private readonly byId = new Map<string, Barber>();

  async create(barber: Barber): Promise<void> {
    this.byId.set(barber.id, barber);
  }

  async findById(id: string): Promise<Barber | null> {
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<Barber[]> {
    return [...this.byId.values()];
  }

  async deactivate(id: string): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing) {
      return false;
    }
    this.byId.set(id, { ...existing, active: false });
    return true;
  }
}

export class FakeServiceRepository implements ServiceRepository {
  private readonly byId = new Map<string, Service>();

  async create(service: Service): Promise<void> {
    this.byId.set(service.id, service);
  }

  async findById(id: string): Promise<Service | null> {
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<Service[]> {
    return [...this.byId.values()];
  }

  async updatePrice(id: string, priceCents: number): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing) {
      return false;
    }
    this.byId.set(id, { ...existing, priceCents });
    return true;
  }
}

export class FakeScheduleRepository implements ScheduleRepository {
  private readonly shopHours: ShopHours[] = [];
  private readonly barberSchedules: BarberSchedule[] = [];
  private readonly barberTimeOff: BarberTimeOff[] = [];

  async createShopHours(hours: ShopHours): Promise<void> {
    this.shopHours.push(hours);
  }

  async listShopHours(): Promise<ShopHours[]> {
    return [...this.shopHours];
  }

  async createBarberSchedule(schedule: BarberSchedule): Promise<void> {
    this.barberSchedules.push(schedule);
  }

  async listBarberSchedule(barberId: string): Promise<BarberSchedule[]> {
    return this.barberSchedules.filter((s) => s.barberId === barberId);
  }

  async updateBarberSchedule(schedule: BarberSchedule): Promise<boolean> {
    const index = this.barberSchedules.findIndex(
      (s) => s.barberId === schedule.barberId && s.dayOfWeek === schedule.dayOfWeek,
    );
    if (index === -1) {
      return false;
    }
    this.barberSchedules[index] = schedule;
    return true;
  }

  async deleteBarberScheduleForDaysNotIn(barberId: string, keepDaysOfWeek: readonly DayOfWeek[]): Promise<void> {
    const keep = new Set<DayOfWeek>(keepDaysOfWeek);
    for (let i = this.barberSchedules.length - 1; i >= 0; i--) {
      const row = this.barberSchedules[i]!;
      if (row.barberId === barberId && !keep.has(row.dayOfWeek)) {
        this.barberSchedules.splice(i, 1);
      }
    }
  }

  async createBarberTimeOff(timeOff: BarberTimeOff): Promise<void> {
    this.barberTimeOff.push(timeOff);
  }

  async listBarberTimeOff(barberId: string): Promise<BarberTimeOff[]> {
    return this.barberTimeOff.filter((t) => t.barberId === barberId);
  }
}
