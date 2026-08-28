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
   *
   * "Baja temporal" — leaves `permanentLeave` exactly as it was (`false` for
   * every barber that ever reaches this method today, since nothing else
   * sets it `true`). The owner's report: a barber out sick for a day had to
   * be deactivated so nobody could book them, and there was no way back —
   * `reactivate()` below is that way back.
   */
  deactivate(id: string): Promise<boolean>;

  /**
   * Undoes EITHER `deactivate()` (baja temporal) or `setPermanentLeave()`
   * (baja definitiva) in one write: `active=true, permanentLeave=false`,
   * unconditionally — a barber can only ever come back into the single
   * "activo" state, regardless of which baja they were in. `barber_schedules`
   * rows are never touched by any of `deactivate`/`setPermanentLeave`/
   * `reactivate` — they survive `active=false` on their own, since nothing
   * in this schema cascades off it — so reactivating restores the barber's
   * whole week for free, with nothing left to reconfigure.
   *
   * `false` means no barber with that id exists.
   */
  reactivate(id: string): Promise<boolean>;

  /**
   * "Baja definitiva" — the barber quit or was fired, for good. Sets
   * `active=false` (the same effect on availability `deactivate()` already
   * has) AND `permanentLeave` in the SAME write, because
   * `barbers_active_permanent_leave_check` (migration 0013) makes
   * `active=true, permanentLeave=true` unrepresentable — the two columns can
   * never be written independently once `permanentLeave` turns `true`.
   *
   * `false` means no barber with that id exists.
   */
  setPermanentLeave(id: string, permanentLeave: boolean): Promise<boolean>;

  /**
   * Whether this barber has ANY row in `slot_occupancies` — the shop's OWN
   * appointment history, not the barber's. This is the one thing that makes
   * `delete()` unsafe: everything else a barber owns (`barber_schedules`,
   * `barber_time_off`, the staff account) is configuration, and disappears
   * with them by design. Exposed as its own read so the panel can decide
   * whether to even OFFER "Eliminar" before the owner tries it, not only
   * discover the refusal after clicking.
   */
  hasAppointments(id: string): Promise<boolean>;

  /**
   * Deletes the barber outright: the staff account (if any — reusing the
   * exact deletion logic `StaffAccountRepository.deleteAccount` already
   * uses), `barber_time_off`, `barber_schedules`, then the `barbers` row
   * itself, all inside ONE transaction, in that order.
   *
   * `'has-appointments'` refuses the whole operation, before touching
   * anything, whenever the barber has a single row in `slot_occupancies` —
   * deleting them would delete the shop's own appointment history along
   * with the login. `setPermanentLeave` (baja definitiva) is the correct
   * action for that barber instead: it keeps the history and removes them
   * from every future selector.
   *
   * `'not-found'` for an id with no matching row — the routine "already
   * gone" case, never an exception.
   */
  delete(id: string): Promise<'deleted' | 'not-found' | 'has-appointments'>;
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
