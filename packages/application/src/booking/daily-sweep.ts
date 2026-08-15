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

  // `59 2 * * *` UTC fires at the END of the shop business day (02:59 UTC
  // == 23:59 UTC-3). The job resolves THAT day from now(), turns it into
  // bounds and delegates the transition+count to the repository — the
  // only place that knows about reservado rows, seña presence or range
  // filtering, so this use case never branches on any of them.
  async execute(): Promise<number> {
    const day = this.clock.calendarDateOf(this.clock.now());
    const bounds = this.clock.businessDayBounds(day);
    return this.sweep.transitionUnmarked(bounds);
  }
}
