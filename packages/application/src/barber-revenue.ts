import type { Appointment, AppointmentRepository } from '@jc-barberia/domain';
import type { Service, ServiceRepository } from '@jc-barberia/domain';
import { FakeAppointmentRepository, FakeServiceRepository } from '@jc-barberia/domain';

export interface BarberRevenue {
  readonly totalTurns: number;
  readonly realizedTurns: number;
  readonly revenueCents: number;
  readonly revenueLabel: string;
}

export class GetOwnRevenueUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly services: ServiceRepository,
  ) {}

  async execute(barberId: string): Promise<BarberRevenue> {
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
    const revenueCents = realizedItems.reduce(
      (sum, appt) => sum + (servicePriceMap.get(appt.serviceId) ?? 0),
      0,
    );

    const revenueLabel = `${realizedTurns} ${realizedTurns === 1 ? 'corte realizado' : 'cortes realizados'}`;

    return {
      totalTurns,
      realizedTurns,
      revenueCents,
      revenueLabel,
    };
  }
}