import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ListOwnAppointmentsUseCase, SelfCancelAppointmentUseCase } from '@jc-barberia/application';
import type {
  AccountAppointmentResponse,
  ListOwnAppointmentsResponse,
  SelfCancelAppointmentResponseBody,
} from '@jc-barberia/contracts';
import type { Appointment, ClientContext } from '@jc-barberia/domain';

import { CurrentClient } from '../access-control/decorators/current-client.decorator';
import { RequiresClientSession } from '../access-control/decorators/requires-client-session.decorator';

function toAccountAppointmentResponse(appointment: Appointment): AccountAppointmentResponse {
  return {
    id: appointment.id,
    barberId: appointment.barberId,
    serviceId: appointment.serviceId,
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
  ) {}

  @Get('appointments')
  async list(@CurrentClient() client: ClientContext): Promise<ListOwnAppointmentsResponse> {
    const appointments = await this.listOwnAppointmentsUseCase.execute({ clientId: client.clientId });
    return { appointments: appointments.map(toAccountAppointmentResponse) };
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') appointmentId: string,
    @CurrentClient() client: ClientContext,
  ): Promise<SelfCancelAppointmentResponseBody> {
    const result = await this.selfCancelAppointmentUseCase.execute({
      appointmentId,
      clientId: client.clientId,
    });

    switch (result.outcome) {
      case 'cancelled':
        return { outcome: 'cancelled', appointment: toAccountAppointmentResponse(result.appointment) };
      case 'too-late':
        return { outcome: 'too-late', cutoff: result.cutoff.toISOString() };
      case 'not-yours':
        return { outcome: 'not-yours' };
      case 'not-cancellable':
        return { outcome: 'not-cancellable' };
    }
  }
}
