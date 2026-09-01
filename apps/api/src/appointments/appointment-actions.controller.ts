import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  AdminCancelAppointmentUseCase,
  AdminConfirmAbsenceUseCase,
  AdminMarkCompletedUseCase,
  AdminUndoWalkInUseCase,
  BarberConfirmAbsenceUseCase,
  BarberMarkCompletedUseCase,
  CreateWalkInUseCase,
  EditAppointmentServiceNotFoundError,
  EditAppointmentUseCase,
  WalkInServiceNotFoundError,
} from '@jc-barberia/application';
import {
  CreateWalkInRequestSchema,
  EditAppointmentRequestSchema,
  type AppointmentResponse,
  type ConfirmAbsenceResponseBody,
  type WalkInResponse,
} from '@jc-barberia/contracts';
import type {
  ActorContext,
  Appointment,
  ConfirmAbsenceResult,
  Clock,
} from '@jc-barberia/domain';
import type { WalkIn } from '@jc-barberia/application';

import { CurrentActor } from '../access-control/decorators/current-actor.decorator';
import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';
import { rethrowAppointmentErrorAsHttp } from './appointment-http-errors';
import { CLOCK } from './tokens';

function toResponse(appointment: Appointment): AppointmentResponse {
  return {
    id: appointment.id,
    barberId: appointment.barberId,
    serviceId: appointment.serviceId,
    clientId: appointment.clientId,
    status: appointment.status,
    startsAt: appointment.timeRange.start.toISOString(),
    endsAt: appointment.timeRange.end.toISOString(),
  };
}

function toConfirmAbsenceResponse(result: ConfirmAbsenceResult): ConfirmAbsenceResponseBody {
  return {
    appointment: toResponse(result.appointment),
    absence: {
      appointmentId: result.absence.appointmentId,
      clientId: result.absence.clientId,
      confirmedByUserId: result.absence.confirmedByUserId,
      confirmedAt: result.absence.confirmedAt.toISOString(),
      depositForfeited: result.absence.depositForfeited,
    },
  };
}

function toWalkInResponse(walkIn: WalkIn): WalkInResponse {
  return {
    id: walkIn.id,
    barberId: walkIn.barberId,
    serviceId: walkIn.serviceId,
    clientId: walkIn.clientId,
    channel: walkIn.channel,
    status: walkIn.status,
    startsAt: walkIn.timeRange.start.toISOString(),
    endsAt: walkIn.timeRange.end.toISOString(),
  };
}

/** Cancelling reaches the same refund path the client's own route does, so
 *  the translation lives in one place both share — see
 *  `appointment-http-errors.ts`.
 *
 *  The `=> never` annotation is not decoration: without it TypeScript widens
 *  the alias to `=> void` and every handler that ends in this call stops
 *  type-checking as exhaustive. */
const rethrowAsHttp: (error: unknown) => never = rethrowAppointmentErrorAsHttp;

/**
 * Slice B (cablear-el-mvp, B.1-B.5): the controller task 10.11 said existed
 * and never did — "conectar el panel a MarkCompleted/ConfirmAbsence" closed
 * a checklist item without a single HTTP route behind it. Every use case
 * here was already written and unit-tested against a fake repository; this
 * file is ONLY the wiring, no new business logic.
 *
 * `mark-completed` and `confirm-absence` are reachable through EITHER
 * `appointment:mark-completed:any` (owner/secretary — any barber's turno)
 * OR `:own` (barber — exactly the same dual-permission-on-one-route shape
 * `DayBoardController` already uses for `agenda:read:any`/`:own`). Which
 * concrete use case runs is decided by `actor.barberId` presence — never by
 * `actor.role` — mirroring `DrizzleAgendaRepository.findScheduleFor`: a
 * barber-shaped actor is ALWAYS routed to the barber-scoped use case, whose
 * OWN `existing.barberId !== actor.barberId` check (on the row already
 * fetched by id, before any write) is what actually rejects a colleague's
 * turno. This handler never re-implements that comparison, it only decides
 * which class performs it.
 */
@Controller('appointments')
export class AppointmentActionsController {
  constructor(
    private readonly adminMarkCompletedUseCase: AdminMarkCompletedUseCase,
    private readonly adminConfirmAbsenceUseCase: AdminConfirmAbsenceUseCase,
    private readonly barberMarkCompletedUseCase: BarberMarkCompletedUseCase,
    private readonly barberConfirmAbsenceUseCase: BarberConfirmAbsenceUseCase,
    private readonly editAppointmentUseCase: EditAppointmentUseCase,
    private readonly adminCancelAppointmentUseCase: AdminCancelAppointmentUseCase,
    private readonly createWalkInUseCase: CreateWalkInUseCase,
    private readonly adminUndoWalkInUseCase: AdminUndoWalkInUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @RequiresPermission('appointment:mark-completed:any', 'appointment:mark-completed:own')
  @Post(':id/mark-completed')
  @HttpCode(200)
  async markCompleted(@Param('id') id: string, @CurrentActor() actor: ActorContext): Promise<AppointmentResponse> {
    try {
      if (actor.barberId !== undefined) {
        const result = await this.barberMarkCompletedUseCase.execute(id, actor);
        if (result.outcome === 'forbidden') {
          throw new ForbiddenException('No podés resolver un turno de otro barbero.');
        }
        return toResponse(result.appointment);
      }
      const appointment = await this.adminMarkCompletedUseCase.execute(id);
      return toResponse(appointment);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @RequiresPermission('appointment:mark-completed:any', 'appointment:mark-completed:own')
  @Post(':id/confirm-absence')
  @HttpCode(200)
  async confirmAbsence(
    @Param('id') id: string,
    @CurrentActor() actor: ActorContext,
  ): Promise<ConfirmAbsenceResponseBody> {
    try {
      if (actor.barberId !== undefined) {
        const result = await this.barberConfirmAbsenceUseCase.execute(id, actor);
        if (result.outcome === 'forbidden') {
          throw new ForbiddenException('No podés resolver un turno de otro barbero.');
        }
        return toConfirmAbsenceResponse(result);
      }
      const result = await this.adminConfirmAbsenceUseCase.execute(id, actor);
      return toConfirmAbsenceResponse(result);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @RequiresPermission('appointment:update')
  @Put(':id')
  async edit(@Param('id') id: string, @Body() body: unknown): Promise<AppointmentResponse> {
    const parsed = EditAppointmentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { barberId, serviceId, calendarDate, startTime } = parsed.data;

    try {
      const appointment = await this.editAppointmentUseCase.execute({
        appointmentId: id,
        barberId,
        serviceId,
        // No endTime here on purpose: the use case derives it itself from the
        // target service's durationMinutes, never from the request body.
        startsAt: this.clock.localTimeToUtc(calendarDate, startTime),
        searchWindow: this.clock.businessDayBounds(calendarDate),
      });
      return toResponse(appointment);
    } catch (error) {
      if (error instanceof EditAppointmentServiceNotFoundError) {
        throw new BadRequestException(`No existe el servicio "${error.serviceId}"`);
      }
      rethrowAsHttp(error);
    }
  }

  @RequiresPermission('appointment:cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string): Promise<AppointmentResponse> {
    try {
      const appointment = await this.adminCancelAppointmentUseCase.execute(id);
      return toResponse(appointment);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  /**
   * Undoes a walk-in loaded by mistake (see `UndoWalkInUseCase` in
   * `@jc-barberia/domain`). Gated on the SAME `walkin:create` permission
   * that creates one, never a new permission name — only whoever could have
   * made the mistake may correct it. A normal `realizado` appointment (any
   * other channel) is rejected by the domain use case with
   * `NotAWalkInError`, translated to a 409 below — this route can never
   * reopen finished business.
   */
  @RequiresPermission('walkin:create')
  @Post(':id/undo-walk-in')
  @HttpCode(200)
  async undoWalkIn(@Param('id') id: string): Promise<AppointmentResponse> {
    try {
      const appointment = await this.adminUndoWalkInUseCase.execute(id);
      return toResponse(appointment);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @RequiresPermission('walkin:create')
  @Post('walk-in')
  @HttpCode(201)
  async createWalkIn(@Body() body: unknown): Promise<WalkInResponse> {
    const parsed = CreateWalkInRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { barberId, serviceId, clientPhone, calendarDate, startTime } = parsed.data;

    try {
      const walkIn = await this.createWalkInUseCase.execute({
        id: crypto.randomUUID(),
        barberId,
        serviceId,
        clientPhone: clientPhone ?? null,
        // No endTime here on purpose: the use case derives it itself from the
        // selected service's durationMinutes, never from the request body.
        startsAt: this.clock.localTimeToUtc(calendarDate, startTime),
        searchWindow: this.clock.businessDayBounds(calendarDate),
      });
      return toWalkInResponse(walkIn);
    } catch (error) {
      if (error instanceof WalkInServiceNotFoundError) {
        throw new BadRequestException(`No existe el servicio "${error.serviceId}"`);
      }
      rethrowAsHttp(error);
    }
  }
}
