import type { ActorContext, BarberPerformanceRepository, TimeWindow } from '@jc-barberia/domain';

export type OwnStatsResult =
  | { readonly outcome: 'forbidden' }
  | {
      readonly outcome: 'ok';
      readonly count: number;
      /**
       * docs/HUECOS-BACKEND.md #4, "El barbero no puede ver cómo cerraron sus
       * turnos": today's screen shows a bare `realizado` count with no
       * context — five `ausente` this month explains a low number, and is
       * exactly the visibility README's absence-tracking story depends on.
       */
      readonly cancelledCount: number;
      readonly absentCount: number;
      readonly unresolvedCount: number;
    };

/**
 * barber-profile spec, "Estadísticas de cortes propios": the barber's own
 * count of `realizado` appointments in a caller-chosen period ("agrupada por
 * día, mes y un período seleccionable" — day, month and any custom period
 * are all just different `range` values, not three separate code paths).
 * Shares `BarberPerformanceRepository` with `GetOwnRevenueUseCase` — see
 * that port's own doc comment for why: one query, two thin aggregations.
 *
 * Reads `countByStatus` rather than `findCompletedAppointments().length`:
 * one grouped query answers about EVERY status this barber's turnos in
 * `range` resolved to, which is what the cancelled/absent/unresolved counts
 * need too — a second, `realizado`-only query would answer only the
 * question this use case used to ask.
 */
export class GetOwnStatsUseCase {
  constructor(private readonly performance: BarberPerformanceRepository) {}

  async execute(barberId: string, range: TimeWindow, actor: ActorContext): Promise<OwnStatsResult> {
    const result = await this.performance.countByStatus(barberId, range, actor);
    if (result.outcome === 'forbidden') {
      return { outcome: 'forbidden' };
    }
    return {
      outcome: 'ok',
      count: result.counts.realizado,
      cancelledCount: result.counts.cancelado,
      absentCount: result.counts.ausente,
      unresolvedCount: result.counts.sin_registrado,
    };
  }
}
