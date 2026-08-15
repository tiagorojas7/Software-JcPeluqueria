import type { BusinessDayBounds } from '../shared/ports/clock.port';

/**
 * The nightly sweep's persistence contract (appointment-lifecycle spec,
 * "Barrido diario de las 23:59"). Cron `59 2 * * *` UTC fires at the END of
 * the shop's business day (02:59 UTC == 23:59 UTC-3); the job resolves that
 * day with `Clock.calendarDateOf(now())`, turns it into bounds with
 * `Clock.businessDayBounds(date)` and hands them HERE.
 *
 * The repository MUST transition every `reservado` whose `time_range` starts
 * inside `bounds` to `sin_registrado` — with and without seña ALIKE: the seña
 * (a non-null `deposit_id`) stays untouched ("MUST permanecer retenida sin
 * cambios"), and a phone booking (`deposit_id` NULL) transitions just the
 * same. Appointments outside the bounds (a future day, or an earlier day
 * already swept) MUST NOT be touched. The returned number is the count of
 * rows transitioned this run — an audit signal, not money.
 *
 * Only `status` moves; never `deposit_id`, never `marked_by_user_id`. The
 * absence path (`sin_registrado` → `ausente`) stays a separate, human-confirmed
 * step (`ConfirmAbsenceUseCase`), so this job never marks an absence on its
 * own.
 */
export interface AppointmentSweepRepository {
  /**
   * @returns how many `reservado` rows within `bounds` became
   *   `sin_registrado` this call. Zero is a legit outcome: the day had none
   *   to sweep, or a prior run already did.
   */
  transitionUnmarked(bounds: BusinessDayBounds): Promise<number>;
}
