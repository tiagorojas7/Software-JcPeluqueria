import type { AppointmentSweepRepository, Clock } from '@jc-barberia/domain';

/**
 * The `59 2 * * *` UTC cron handler, as an application-layer use case. At
 * 02:59 UTC the shop's business day (UTC-3) just ended, so the job resolves
 * THAT day — `Clock.calendarDateOf(now())` — turns it into bounds with
 * `Clock.businessDayBounds(date)` and delegates the actual transition to the
 * sweep repository, returning the count transitioned this run.
 *
 * Phase 6 owns the day-end sweep only; the absence step (`sin_registrado` →
 * `ausente`) stays a human-confirmed action (`ConfirmAbsenceUseCase`), so
 * this use case never marks an absence on its own. It also never branches on
 * the existence of a seña: the repository transitions con y sin seña alike,
 * exactly as the appointment-lifecycle spec mandates.
 */
export class DailySweepUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly sweep: AppointmentSweepRepository,
  ) {}

  // RED (6.6) — behaviour lands in GREEN 6.7. This stub proves the suite runs
  // and fails first; committing it red-first keeps the TDD order auditable.
  async execute(): Promise<number> {
    this.clock.businessDayBounds(this.clock.calendarDateOf(this.clock.now()));
    throw new Error('DailySweepUseCase.execute not implemented — fill in 6.7');
  }
}
