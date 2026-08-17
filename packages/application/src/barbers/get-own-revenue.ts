import type { ActorContext, BarberPerformanceRepository, TimeWindow } from '@jc-barberia/domain';

/**
 * barber-profile spec, "Facturación teórica por precio de lista" — every
 * clause of this string is a separate MUST in that requirement, not
 * decoration: (1) explicitly named "precio de lista", (2) explicitly NOT
 * profit, (3) explicitly NOT money actually collected, (4) explicitly
 * discloses that the other 50%, collected in cash at the counter, is never
 * tracked by the system. The rejected first attempt at this phase showed a
 * bare "N cortes realizados" — technically a number, but none of these four
 * claims — which is exactly the gap this constant closes. Spanish because
 * this is the literal user-facing label, not a code identifier.
 */
export const REVENUE_DISCLAIMER =
  'Facturación teórica según precio de lista: no es tu ganancia ni la plata efectivamente cobrada. ' +
  'El sistema no registra el 50% restante que se cobra en efectivo en el mostrador.';

export type OwnRevenueResult =
  | { readonly outcome: 'forbidden' }
  | { readonly outcome: 'ok'; readonly totalListPriceCents: number; readonly disclaimer: string };

/**
 * The barber's own theoretical billing: the sum of list prices of their
 * `realizado` appointments in a caller-chosen period. Shares
 * `BarberPerformanceRepository` with `GetOwnStatsUseCase` — one query, two
 * thin aggregations (count vs. sum) — so the narrowing rule and the
 * "`realizado`-only" filter are defined exactly once, in the port, not
 * duplicated per use case.
 */
export class GetOwnRevenueUseCase {
  constructor(private readonly performance: BarberPerformanceRepository) {}

  async execute(barberId: string, range: TimeWindow, actor: ActorContext): Promise<OwnRevenueResult> {
    const result = await this.performance.findCompletedAppointments(barberId, range, actor);
    if (result.outcome === 'forbidden') {
      return { outcome: 'forbidden' };
    }
    const totalListPriceCents = result.appointments.reduce((sum, item) => sum + item.listPriceCents, 0);
    return { outcome: 'ok', totalListPriceCents, disclaimer: REVENUE_DISCLAIMER };
  }
}
