import { Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import {
  GetOwnProfileUseCase,
  ListOwnAppointmentsUseCase,
  SelfCancelAppointmentUseCase,
  type OwnAppointment,
} from '@jc-barberia/application';
import type {
  AccountAppointmentEchoResponse,
  AccountAppointmentResponse,
  AccountProfileResponse,
  ListOwnAppointmentsResponse,
  SelfCancelAppointmentResponseBody,
} from '@jc-barberia/contracts';
import type { Appointment, ClientContext } from '@jc-barberia/domain';

import { rethrowAppointmentErrorAsHttp } from '../appointments/appointment-http-errors';
import { CurrentClient } from '../access-control/decorators/current-client.decorator';
import { RequiresClientSession } from '../access-control/decorators/requires-client-session.decorator';

/** The turno a client just acted on, echoed back. Deliberately WITHOUT the
 *  names: it replaces a row the client already has on screen, and the
 *  frontend merges it onto that row rather than swapping the row out. */
function toEcho(appointment: Appointment): AccountAppointmentEchoResponse {
  return {
    id: appointment.id,
    barberId: appointment.barberId,
    serviceId: appointment.serviceId,
    status: appointment.status,
    startsAt: appointment.timeRange.start.toISOString(),
    endsAt: appointment.timeRange.end.toISOString(),
  };
}

function toAccountAppointmentResponse(appointment: OwnAppointment): AccountAppointmentResponse {
  return {
    id: appointment.id,
    barberId: appointment.barberId,
    serviceId: appointment.serviceId,
    serviceName: appointment.serviceName,
    barberName: appointment.barberName,
    status: appointment.status,
    startsAt: appointment.timeRange.start.toISOString(),
    endsAt: appointment.timeRange.end.toISOString(),
  };
}

/**
 * "Mi cuenta" (cablear-el-mvp Slice C, C.3/C.4): the client's own
 * appointments and self-service cancellation. Every route here is
 * `@RequiresClientSession()` at the CLASS level — there is no legitimate
 * `@Public()` or `@RequiresPermission()` branch on this controller, a client
 * is never in the roles matrix (`RequiresClientSession`'s own doc comment).
 * `clientId` always comes from `@CurrentClient()` — i.e. from the resolved
 * session `PermissionsGuard` already attached — NEVER from a path/body
 * param, which is exactly what keeps `cancel` scoped to the caller's own
 * appointments (see `SelfCancelAppointmentUseCase`'s own doc comment on why
 * that discipline is a security requirement, not a style preference).
 */
@RequiresClientSession()
@Controller('account')
export class AccountController {
  constructor(
    // NEVER name these two the same as their own route handler methods below
    // (`list`/`cancel`) — a same-named instance property SHADOWS the
    // prototype method Nest's router captured during route scanning, which
    // makes `PermissionsGuard` read no metadata off the handler at all (see
    // `AuthController`'s own doc comment — this cost real debugging time
    // once already).
    private readonly listOwnAppointmentsUseCase: ListOwnAppointmentsUseCase,
    private readonly selfCancelAppointmentUseCase: SelfCancelAppointmentUseCase,
    private readonly getOwnProfileUseCase: GetOwnProfileUseCase,
  ) {}

  @Get('appointments')
  async list(@CurrentClient() client: ClientContext): Promise<ListOwnAppointmentsResponse> {
    const appointments = await this.listOwnAppointmentsUseCase.execute({ clientId: client.clientId });
    return { appointments: appointments.map(toAccountAppointmentResponse) };
  }

  /**
   * panel-usable: lets a returning client's booking flow prefill their own
   * stored name/phone/email/age instead of asking them to retype it — see
   * `GetOwnProfileUseCase`'s own doc comment. `null` is a data-integrity
   * edge case (`@RequiresClientSession()` already guarantees "logged in" by
   * the time this handler runs), so it becomes a plain 404 like any other
   * "the id this session names does not resolve" case.
   */
  @Get('profile')
  async profile(@CurrentClient() client: ClientContext): Promise<AccountProfileResponse> {
    const profile = await this.getOwnProfileUseCase.execute({ clientId: client.clientId });
    if (!profile) {
      throw new NotFoundException({ message: 'No se encontró el perfil del cliente autenticado' });
    }
    return { name: profile.name, phone: profile.phone, email: profile.email, age: profile.age };
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') appointmentId: string,
    @CurrentClient() client: ClientContext,
  ): Promise<SelfCancelAppointmentResponseBody> {
    // Cancelling inside the 1h window refunds the deposit, so this reaches
    // MercadoPago. Without this translation a refund the provider rejected
    // surfaced to the client as a bare "Internal server error" — the exact
    // thing the shop owner reported from "Mi cuenta".
    const result = await this.selfCancelAppointmentUseCase
      .execute({ appointmentId, clientId: client.clientId })
      .catch(rethrowAppointmentErrorAsHttp);

    switch (result.outcome) {
      case 'cancelled':
        return {
          outcome: 'cancelled',
          appointment: toEcho(result.appointment),
          refund: result.refund,
        };
      case 'not-yours':
        return { outcome: 'not-yours' };
      case 'not-cancellable':
        return { outcome: 'not-cancellable' };
    }
  }
}
