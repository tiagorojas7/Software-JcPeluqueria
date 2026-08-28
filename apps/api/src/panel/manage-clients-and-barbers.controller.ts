import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
  type BarbersManagementListResponse,
  type BarberWeekResponse,
  type ClientsListResponse,
  type ConfigureBarberWeekResponseBody,
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

  /**
   * The panel's own "Barberos" table — EVERY barber, active or not, unlike
   * the public `GET /barbers` (`ListPublicBarbersUseCase`), which stays
   * active-only by design and is untouched by this slice. `canDelete` is
   * computed here, server-side, so the panel can decide whether to even
   * OFFER "Eliminar" per row before the owner clicks it.
   */
  @RequiresPermission('barber:manage')
  @Get('barbers')
  async listBarbers(): Promise<BarbersManagementListResponse> {
    return { barbers: await this.manage.listBarbers() };
  }

  /**
   * "Baja temporal"/"baja definitiva"'s way back — undoes either one in the
   * same write: `active=true, permanentLeave=false`. The barber's base
   * schedule needs no reconfiguration; it was never touched by going
   * inactive.
   */
  @RequiresPermission('barber:manage')
  @Post('barbers/:barberId/reactivate')
  @HttpCode(200)
  async reactivateBarber(@Param('barberId') barberId: string): Promise<{ reactivated: true }> {
    const reactivated = await this.manage.reactivateBarber(barberId);
    if (!reactivated) {
      throw new NotFoundException({ message: `No existe el barbero "${barberId}"` });
    }
    return { reactivated: true };
  }

  /**
   * "Baja definitiva" — the barber quit or was fired, for good. Also
   * removes the staff account (see `ManageClientsAndBarbersUseCase.terminateBarber`),
   * which is why this is its own route rather than a flag on `deactivate`.
   */
  @RequiresPermission('barber:manage')
  @Post('barbers/:barberId/terminate')
  @HttpCode(200)
  async terminateBarber(@Param('barberId') barberId: string): Promise<{ terminated: true }> {
    const terminated = await this.manage.terminateBarber(barberId);
    if (!terminated) {
      throw new NotFoundException({ message: `No existe el barbero "${barberId}"` });
    }
    return { terminated: true };
  }

  /**
   * Removes the barber outright — possible ONLY when they have zero rows in
   * `slot_occupancies`, the shop's own appointment history. `409`, not an
   * unhandled 500: the request is well formed, it just collides with
   * history that has to survive, the same "well-formed but refused" shape
   * `addBarber`'s `email-taken` already uses. "Baja definitiva" is the
   * message's own suggested next step for a barber who cannot be deleted.
   */
  @RequiresPermission('barber:manage')
  @Delete('barbers/:barberId')
  @HttpCode(200)
  async deleteBarber(@Param('barberId') barberId: string): Promise<{ deleted: true }> {
    const outcome = await this.manage.deleteBarber(barberId);
    if (outcome === 'not-found') {
      throw new NotFoundException({ message: `No existe el barbero "${barberId}"` });
    }
    if (outcome === 'has-appointments') {
      throw new ConflictException({
        message: 'No se puede eliminar: tiene turnos en el historial del local. Usá "Baja definitiva" en su lugar.',
      });
    }
    return { deleted: true };
  }

  /**
   * The read half the panel never had. TWO permissions, not one, because two
   * different screens need the same answer: "Horarios" (`schedule:configure`,
   * owner) opens on the barber's CURRENT week instead of a blank one, and the
   * phone/walk-in forms (`appointment:create`, owner AND secretary) offer only
   * the days the barber actually works instead of all seven.
   *
   * A barber's working days are not sensitive — they are already observable
   * from public availability — so the wider grant costs nothing and closes a
   * real gap: without `appointment:create` here the secretary, who is exactly
   * who books by phone, could not read the days she is booking into.
   */
  @RequiresPermission('schedule:configure', 'appointment:create')
  @Get('barbers/:barberId/schedule')
  async getBarberWeek(@Param('barberId') barberId: string): Promise<BarberWeekResponse> {
    return { days: await this.manage.getBarberWeek(barberId) };
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
  /**
   * docs/HUECOS-BACKEND.md #6, segunda parte: turning off a day here can
   * orphan a turno that is still `reservado` on it, so this no longer
   * always writes. Without `confirm: true`, a day removal that would orphan
   * a turno answers `{ configured: false, affectedAppointmentIds }` and
   * writes NOTHING — the panel is expected to show that count and let the
   * owner retry the exact same request with `confirm: true` once they
   * accept it.
   */
  @RequiresPermission('schedule:configure')
  @Put('barbers/:barberId/schedule/week')
  @HttpCode(200)
  async configureBarberWeek(
    @Param('barberId') barberId: string,
    @Body() body: unknown,
  ): Promise<ConfigureBarberWeekResponseBody> {
    const parsed = ConfigureBarberWeekRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const result = await this.manage.configureBarberWeek(
      barberId,
      parsed.data.schedule.map((day) => ({ ...day, dayOfWeek: asDayOfWeek(day.dayOfWeek) })),
      { confirm: parsed.data.confirm },
    );
    return result.outcome === 'configured'
      ? { configured: true }
      : { configured: false, affectedAppointmentIds: result.affectedAppointmentIds };
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
