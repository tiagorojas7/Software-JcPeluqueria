import type { Service, ServiceRepository } from '@jc-barberia/domain';

export interface ListPublicServicesResult {
  readonly services: readonly Service[];
}

/**
 * client-booking spec, "Exploración sin cuenta". Deliberately a thin
 * pass-through: `Service` already carries the real `priceCents` (integer,
 * never a formatted string) and `durationMinutes` the panel writes via
 * `ManageClientsAndBarbersUseCase.configureServicePrice` — there is no
 * `active` flag on `Service` the way there is on `Barber`, so no filtering
 * rule applies here. Formatting `priceCents` for display is the browser's
 * job, not this use case's.
 */
export class ListPublicServicesUseCase {
  constructor(private readonly services: ServiceRepository) {}

  async execute(): Promise<ListPublicServicesResult> {
    return { services: await this.services.list() };
  }
}
