import type { Barber, BarberSchedule, BarberTimeOff, DayOfWeek, Service, ShopHours } from './entities';

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
  /**
   * admin-operations spec, "Gestión de clientes y de barberos" — the "baja"
   * half. A single atomic `UPDATE ... SET active=false WHERE id RETURNING`,
   * same "zero rows means not found" idiom as `HoldRepository.confirm()`:
   * `false` means no barber with that id exists, never an exception for a
   * routine "already gone" case.
   */
  deactivate(id: string): Promise<boolean>;
}

export interface ServiceRepository {
  create(service: Service): Promise<void>;
  findById(id: string): Promise<Service | null>;
  list(): Promise<Service[]>;
  /**
   * admin-operations spec, "Gestión de clientes y de barberos" — "la
   * configuración de... precios de servicios". Same atomic
   * `UPDATE ... RETURNING` idiom as `deactivate()`: `false` means no service
   * with that id exists.
   */
  updatePrice(id: string, priceCents: number): Promise<boolean>;
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
  /**
   * admin-operations spec, "Gestión de clientes y de barberos" — "la
   * configuración de horarios base" for a day already on file (the
   * `(barber_id, day_of_week)` `UNIQUE` constraint — horario corrido, Fase 1
   * — means a second `createBarberSchedule` for the same day is invalid
   * data, not an update). `false` means that barber has no row for that day
   * yet — the caller falls back to `createBarberSchedule`, never a
   * duplicate-key exception surfacing as the answer.
   */
  updateBarberSchedule(schedule: BarberSchedule): Promise<boolean>;

  /**
   * docs/HUECOS-BACKEND.md #6, "Apagar un día en Horarios no apaga el día":
   * `configureBarberWeek` treats its incoming array as the barber's WHOLE
   * week, so a day left OUT of it has to stop being a working day — never
   * silently survive because nothing asked to remove it. `keepDaysOfWeek` is
   * the complete set of days the caller is about to (re)write; every OTHER
   * `barber_schedules` row for this barber is deleted. Scoped to `barberId`
   * alone — replacing one barber's week must never touch another's rows.
   */
  deleteBarberScheduleForDaysNotIn(barberId: string, keepDaysOfWeek: readonly DayOfWeek[]): Promise<void>;

  createBarberTimeOff(timeOff: BarberTimeOff): Promise<void>;
  listBarberTimeOff(barberId: string): Promise<BarberTimeOff[]>;
}
