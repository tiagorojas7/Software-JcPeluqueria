import type { ActorContext, BarberPerformanceRepository, TimeWindow } from '@jc-barberia/domain';

export type OwnStatsResult =
  | { readonly outcome: 'forbidden' }
  | { readonly outcome: 'ok'; readonly count: number };

/**
 * barber-profile spec, "Estadísticas de cortes propios": the barber's own
 * count of `realizado` appointments in a caller-chosen period ("agrupada por
 * día, mes y un período seleccionable" — day, month and any custom period
 * are all just different `range` values, not three separate code paths).
 * Shares `BarberPerformanceRepository` with `GetOwnRevenueUseCase` — see
 * that port's own doc comment for why: one query, two thin aggregations.
 */
export class GetOwnStatsUseCase {
  constructor(private readonly performance: BarberPerformanceRepository) {}

  async execute(barberId: string, range: TimeWindow, actor: ActorContext): Promise<OwnStatsResult> {
    const result = await this.performance.findCompletedAppointments(barberId, range, actor);
    if (result.outcome === 'forbidden') {
      return { outcome: 'forbidden' };
    }
    return { outcome: 'ok', count: result.appointments.length };
  }
}
