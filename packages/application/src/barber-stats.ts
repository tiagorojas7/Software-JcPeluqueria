import type { Appointment, AppointmentRepository } from '@jc-barberia/domain';
import type { Service, ServiceRepository } from '@jc-barberia/domain';

export interface BarberStats {
  readonly totalTurns: number;
  readonly realizedTurns: number;
  readonly ownIncomeCents: number;
}

export class GetOwnStatsUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly services: ServiceRepository,
  ) {}

  async execute(barberId: string): Promise<BarberStats> {
    const items = await this.appointments.findByBarberId(barberId);

    const totalTurns = items.length;
    const realizedItems = items.filter(
      (appt) => appt.status === 'realizado',
    );
    const realizedTurns = realizedItems.length;
    const servicePriceMap = new Map(
      await this.services.list().then((services) =>
        services.map((s) => [s.id, s.priceCents]),
      ),
    );
    const ownIncomeCents = realizedItems.reduce(
      (sum, appt) => sum + (servicePriceMap.get(appt.serviceId) ?? 0),
      0,
    );

    return {
      totalTurns,
      realizedTurns,
      ownIncomeCents,
    };
  }
}