import type { Barber, BarberSchedule, BarberTimeOff, Service, ShopHours } from './entities';

/**
 * Repository ports for the availability model. Phase 1 is read-only from
 * `AvailabilityService`'s point of view, but the data still has to get
 * into the database somehow — these cover the basic CRUD the panel's
 * configuration screens (later phases) and test fixtures need. No
 * update/delete yet: nothing in Phase 1 requires editing a row after
 * creation.
 */

export interface BarberRepository {
  create(barber: Barber): Promise<void>;
  findById(id: string): Promise<Barber | null>;
  list(): Promise<Barber[]>;
}

export interface ServiceRepository {
  create(service: Service): Promise<void>;
  findById(id: string): Promise<Service | null>;
  list(): Promise<Service[]>;
}

/**
 * Read/write access to shop hours, barber schedules and barber time off —
 * together, the exact inputs `AvailabilityService.workingWindows()` needs.
 */
export interface ScheduleRepository {
  createShopHours(hours: ShopHours): Promise<void>;
  listShopHours(): Promise<ShopHours[]>;

  createBarberSchedule(schedule: BarberSchedule): Promise<void>;
  listBarberSchedule(barberId: string): Promise<BarberSchedule[]>;

  createBarberTimeOff(timeOff: BarberTimeOff): Promise<void>;
  listBarberTimeOff(barberId: string): Promise<BarberTimeOff[]>;
}
