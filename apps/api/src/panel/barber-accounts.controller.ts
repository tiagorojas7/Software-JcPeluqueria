import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ManageBarberAccountsUseCase } from '@jc-barberia/application';
import {
  SetBarberAccountActiveRequestSchema,
  type BarberAccountsListResponse,
} from '@jc-barberia/contracts';

import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';

/**
 * The owner's control over who can get in. Every route here sits behind
 * `barber:manage`, which migration `0006_access_control.sql` grants to the
 * owner ALONE — not to the secretary, matching the README's "El alta y baja
 * de barberos... queda solo en manos del dueño" and its follow-up: *"la
 * cuenta de cada barbero y tener todo el control sobre las cuentas"*.
 *
 * What "todo el control" means here, precisely: create, invite, re-invite,
 * revoke, restore. It does NOT mean reading or choosing anyone's password —
 * no route in this file accepts or returns a credential, and the repository
 * behind it has no seam through which one could be written. A barber's
 * password is chosen once, by the barber, through `POST /auth/activate-staff`.
 */
@Controller('panel/barber-accounts')
export class BarberAccountsController {
  constructor(private readonly accounts: ManageBarberAccountsUseCase) {}

  @RequiresPermission('barber:manage')
  @Get()
  async list(): Promise<BarberAccountsListResponse> {
    return { accounts: await this.accounts.list() };
  }

  /**
   * Both "no me llegó el mail" and "me olvidé la contraseña" — deliberately
   * the same route, because they are the same write. See
   * `ManageBarberAccountsUseCase.resendInvite`.
   */
  @RequiresPermission('barber:manage')
  @Post(':userId/resend-invite')
  @HttpCode(200)
  async resendInvite(@Param('userId') userId: string): Promise<{ sent: true }> {
    const result = await this.accounts.resendInvite(userId);
    if (result.outcome !== 'sent') {
      throw new NotFoundException({ message: `No existe la cuenta "${userId}"` });
    }
    return { sent: true };
  }

  @RequiresPermission('barber:manage')
  @Post(':userId/active')
  @HttpCode(200)
  async setActive(@Param('userId') userId: string, @Body() body: unknown): Promise<{ active: boolean }> {
    const parsed = SetBarberAccountActiveRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const updated = await this.accounts.setActive(userId, parsed.data.active);
    if (!updated) {
      throw new NotFoundException({ message: `No existe la cuenta "${userId}"` });
    }
    return { active: parsed.data.active };
  }
}
