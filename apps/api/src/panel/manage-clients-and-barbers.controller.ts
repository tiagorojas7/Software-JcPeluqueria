import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ManageClientsAndBarbersUseCase } from '@jc-barberia/application';
import {
  AddBarberRequestSchema,
  ConfigureBarberScheduleRequestSchema,
  ConfigureBarberWeekRequestSchema,
  ConfigureServicePriceRequestSchema,
  type BarberResponse,
  type ClientsListResponse,
} from '@jc-barberia/contracts';
import type { DayOfWeek } from '@jc-barberia/domain';

import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';

/**
 * zod validates `dayOfWeek` is an integer 0-6 but can only ever type it as
 * plain `number` — the domain's `DayOfWeek` literal union only exists at
 * the type level. Same cast `DrizzleScheduleRepository` already uses for
 * the identical problem reading a Postgres `smallint` back: safe here
 * specifically because `safeParse` already range-checked it above.
 */
function asDayOfWeek(value: number): DayOfWeek {
  return value as DayOfWeek;
}

/**
 * admin-operations spec, "Gestión de clientes y de barberos" (tasks
 * 10.14/10.15). Each route maps to exactly ONE of the four permissions the
 * Fase 3b seed grants asymmetrically: `client:manage` reaches owner AND
 * secretary; `barber:manage`/`schedule:configure`/`pricing:configure` reach
 * owner only. `ManageClientsAndBarbersUseCase` itself never checks a role —
 * this controller, via `@RequiresPermission`, is the single place that
 * split is enforced (same division of responsibility as every other
 * controller in this app).
 */
@Controller('panel')
export class ManageClientsAndBarbersController {
  constructor(private readonly manage: ManageClientsAndBarbersUseCase) {}

  @RequiresPermission('client:manage')
  @Get('clients')
  async listClients(): Promise<ClientsListResponse> {
    const clients = await this.manage.listClients();
    return { clients };
  }

  @RequiresPermission('barber:manage')
  @Post('barbers')
  @HttpCode(201)
  async addBarber(@Body() body: unknown): Promise<BarberResponse> {
    const parsed = AddBarberRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const result = await this.manage.addBarber({
      id: crypto.randomUUID(),
      name: parsed.data.name,
      email: parsed.data.email,
      schedule: parsed.data.schedule.map((day) => ({ ...day, dayOfWeek: asDayOfWeek(day.dayOfWeek) })),
    });
    if (result.outcome === 'email-taken') {
      // 409, not 400: the request is perfectly well formed, it just collides
      // with an account that already exists — and the panel shows that as a
      // field-level message on the email, not as a validation failure.
      throw new ConflictException({ message: `Ya hay una cuenta con el email "${parsed.data.email}"` });
    }
    return result.barber;
  }

  @RequiresPermission('barber:manage')
  @Post('barbers/:barberId/deactivate')
  @HttpCode(200)
  async deactivateBarber(@Param('barberId') barberId: string): Promise<{ deactivated: true }> {
    const deactivated = await this.manage.deactivateBarber(barberId);
    if (!deactivated) {
      throw new NotFoundException({ message: `No existe el barbero "${barberId}"` });
    }
    return { deactivated: true };
  }

  @RequiresPermission('schedule:configure')
  @Put('barbers/:barberId/schedule')
  @HttpCode(200)
  async configureBarberSchedule(
    @Param('barberId') barberId: string,
    @Body() body: unknown,
  ): Promise<{ configured: true }> {
    const parsed = ConfigureBarberScheduleRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    await this.manage.configureBarberSchedule({
      barberId,
      ...parsed.data,
      dayOfWeek: asDayOfWeek(parsed.data.dayOfWeek),
    });
    return { configured: true };
  }

  /**
   * panel-usable: lets the panel set a barber's whole week in one request
   * instead of one PUT per day — the per-day route above stays untouched for
   * any other caller.
   */
  @RequiresPermission('schedule:configure')
  @Put('barbers/:barberId/schedule/week')
  @HttpCode(200)
  async configureBarberWeek(
    @Param('barberId') barberId: string,
    @Body() body: unknown,
  ): Promise<{ configured: true }> {
    const parsed = ConfigureBarberWeekRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    await this.manage.configureBarberWeek(
      barberId,
      parsed.data.schedule.map((day) => ({ ...day, dayOfWeek: asDayOfWeek(day.dayOfWeek) })),
    );
    return { configured: true };
  }

  @RequiresPermission('pricing:configure')
  @Put('services/:serviceId/price')
  @HttpCode(200)
  async configureServicePrice(
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ): Promise<{ configured: true }> {
    const parsed = ConfigureServicePriceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const configured = await this.manage.configureServicePrice(serviceId, parsed.data.priceCents);
    if (!configured) {
      throw new NotFoundException({ message: `No existe el servicio "${serviceId}"` });
    }
    return { configured: true };
  }
}
