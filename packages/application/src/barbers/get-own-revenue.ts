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

/**
 * docs/HUECOS-BACKEND.md #3, "La facturación del barbero no se puede
 * desglosar": one row per service actually performed in the period, never
 * one per appointment — a barber who did five haircuts of the same service
 * needs ONE row saying "5 cortes", not five identical ones. The average
 * ticket per service is deliberately NOT a field here: it is exactly
 * `totalListPriceCents / count`, and the caller already has both numbers to
 * derive it — sending a third, redundant number invites the two to drift.
 */
export interface RevenueByService {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly count: number;
  readonly totalListPriceCents: number;
}

export type OwnRevenueResult =
  | { readonly outcome: 'forbidden' }
  | {
      readonly outcome: 'ok';
      readonly totalListPriceCents: number;
      readonly disclaimer: string;
      readonly byService: readonly RevenueByService[];
    };

/**
 * The barber's own theoretical billing: the sum of list prices of their
 * `realizado` appointments in a caller-chosen period, plus the same total
 * broken down by service. Shares `BarberPerformanceRepository` with
 * `GetOwnStatsUseCase` — one query, two thin aggregations (count vs. sum) —
 * so the narrowing rule and the "`realizado`-only" filter are defined
 * exactly once, in the port, not duplicated per use case.
 */
export class GetOwnRevenueUseCase {
  constructor(private readonly performance: BarberPerformanceRepository) {}

  async execute(barberId: string, range: TimeWindow, actor: ActorContext): Promise<OwnRevenueResult> {
    const result = await this.performance.findCompletedAppointments(barberId, range, actor);
    if (result.outcome === 'forbidden') {
      return { outcome: 'forbidden' };
    }
    const totalListPriceCents = result.appointments.reduce((sum, item) => sum + item.listPriceCents, 0);

    const byServiceId = new Map<string, RevenueByService>();
    for (const appointment of result.appointments) {
      const existing = byServiceId.get(appointment.serviceId);
      byServiceId.set(appointment.serviceId, {
        serviceId: appointment.serviceId,
        serviceName: appointment.serviceName,
        count: (existing?.count ?? 0) + 1,
        totalListPriceCents: (existing?.totalListPriceCents ?? 0) + appointment.listPriceCents,
      });
    }

    return {
      outcome: 'ok',
      totalListPriceCents,
      disclaimer: REVENUE_DISCLAIMER,
      byService: [...byServiceId.values()],
    };
  }
}
