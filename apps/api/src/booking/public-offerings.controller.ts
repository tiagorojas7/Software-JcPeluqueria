import { Controller, Get, Inject } from '@nestjs/common';
import { ListPublicBarbersUseCase, ListPublicServicesUseCase } from '@jc-barberia/application';
import type { PublicBarbersResponse, PublicServicesResponse } from '@jc-barberia/contracts';

import { Public } from '../access-control/decorators/public.decorator';

/**
 * datos-reales-en-ui: the public site (`HomePage`, `BookingPage`,
 * `PhoneAppointmentPage`) had no endpoint to ask for real barbers/services
 * and imported hardcoded demo data instead — a deactivated barber stayed
 * visible, a new one stayed invisible, a changed price stayed stale.
 * client-booking spec, "Exploración sin cuenta": a visitor MUST be able to
 * consult barbers and services without an account — same `@Public()`, no
 * `ActorContext` shape as `AvailabilityController`. Two separate classes,
 * not one, because `ListPublicBarbersController` sits at `barbers` (already
 * shared with `BarberPerformanceController`'s `:barberId/stats` and
 * `MarkBarberAbsentController`'s `:barberId/mark-absent` — a bare `GET` at
 * the same prefix does not collide with either) and
 * `ListPublicServicesController` sits at `services`, a prefix nothing else
 * in this app has claimed yet.
 */
@Controller('barbers')
export class ListPublicBarbersController {
  constructor(@Inject(ListPublicBarbersUseCase) private readonly listBarbers: ListPublicBarbersUseCase) {}

  @Public()
  @Get()
  async index(): Promise<PublicBarbersResponse> {
    const { barbers } = await this.listBarbers.execute();
    return { barbers: barbers.map((barber) => ({ id: barber.id, name: barber.name })) };
  }
}

@Controller('services')
export class ListPublicServicesController {
  constructor(@Inject(ListPublicServicesUseCase) private readonly listServices: ListPublicServicesUseCase) {}

  @Public()
  @Get()
  async index(): Promise<PublicServicesResponse> {
    const { services } = await this.listServices.execute();
    return {
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
      })),
    };
  }
}
