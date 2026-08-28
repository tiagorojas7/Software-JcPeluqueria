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
} from '@nestjs/common';
import { ManageBarberAccountsUseCase } from '@jc-barberia/application';
import {
  InviteBarberAccountRequestSchema,
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
   * Gives an account to a barber who already exists. The alta does this in
   * one step for a NEW barber; this is the same act for everyone who was
   * already on file before the alta started creating one — without it, the
   * shop's existing barbers could be listed on this screen and never given
   * access, which is the state that made the screen useless in practice.
   */
  @RequiresPermission('barber:manage')
  @Post()
  @HttpCode(201)
  async invite(@Body() body: unknown): Promise<{ userId: string }> {
    const parsed = InviteBarberAccountRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const result = await this.accounts.invite(parsed.data);
    switch (result.outcome) {
      case 'invited':
        return { userId: result.userId };
      case 'barber-not-found':
        throw new NotFoundException({ message: `No existe el barbero "${parsed.data.barberId}"` });
      case 'already-has-account':
        throw new ConflictException({ message: 'Ese barbero ya tiene cuenta. Reenviale la invitación.' });
      case 'email-taken':
        throw new ConflictException({ message: `Ya hay una cuenta con el email "${parsed.data.email}"` });
    }
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

  /**
   * Removes the account for good. `DELETE`, not another `POST`, because it
   * is the one operation here that destroys something rather than flipping
   * a flag — and the difference deserves to be visible in the method.
   *
   * The BARBER survives: they stay on the agenda and their turnos stay in
   * the shop's history (minus the attribution — see the repository). What
   * disappears is the login, so the row goes back to being "un barbero sin
   * cuenta", which the same screen already knows how to invite again.
   */
  @RequiresPermission('barber:manage')
  @Delete(':userId')
  @HttpCode(200)
  async deleteAccount(@Param('userId') userId: string): Promise<{ deleted: true }> {
    const deleted = await this.accounts.deleteAccount(userId);
    if (!deleted) {
      throw new NotFoundException({ message: `No existe la cuenta "${userId}"` });
    }
    return { deleted: true };
  }
}
