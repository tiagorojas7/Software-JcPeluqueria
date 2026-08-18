import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  AdminCancelAppointmentUseCase,
  AdminConfirmAbsenceUseCase,
  AdminMarkCompletedUseCase,
  BarberConfirmAbsenceUseCase,
  BarberMarkCompletedUseCase,
  CreateWalkInUseCase,
  EditAppointmentUseCase,
} from '@jc-barberia/application';
import {
  CreateWalkInRequestSchema,
  EditAppointmentRequestSchema,
  type AppointmentResponse,
  type ConfirmAbsenceResponseBody,
  type WalkInResponse,
} from '@jc-barberia/contracts';
import {
  AppointmentNotFoundError,
  SlotUnavailableError,
  type ActorContext,
  type Appointment,
  type ConfirmAbsenceResult,
  type Clock,
} from '@jc-barberia/domain';
import type { WalkIn } from '@jc-barberia/application';

import { CurrentActor } from '../access-control/decorators/current-actor.decorator';
import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';
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

/** Translates the two errors these use cases can throw into ordinary HTTP
 *  responses, the same pattern `HoldController` already established for
 *  `SlotUnavailableError` — never a bare 500 for an expected outcome. */
function rethrowAsHttp(error: unknown): never {
  if (error instanceof AppointmentNotFoundError) {
    throw new NotFoundException(`No existe un turno con id "${error.appointmentId}"`);
  }
  if (error instanceof SlotUnavailableError) {
    throw new ConflictException({
      message: 'El horario ya no está disponible',
      alternatives: error.alternatives.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
    });
  }
  throw error;
}

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
    const { barberId, serviceId, calendarDate, startTime, endTime } = parsed.data;

    try {
      const appointment = await this.editAppointmentUseCase.execute({
        appointmentId: id,
        barberId,
        serviceId,
        timeRange: {
          start: this.clock.localTimeToUtc(calendarDate, startTime),
          end: this.clock.localTimeToUtc(calendarDate, endTime),
        },
        searchWindow: this.clock.businessDayBounds(calendarDate),
      });
      return toResponse(appointment);
    } catch (error) {
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

  @RequiresPermission('walkin:create')
  @Post('walk-in')
  @HttpCode(201)
  async createWalkIn(@Body() body: unknown): Promise<WalkInResponse> {
    const parsed = CreateWalkInRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { barberId, serviceId, clientId, calendarDate, startTime, endTime } = parsed.data;

    try {
      const walkIn = await this.createWalkInUseCase.execute({
        id: crypto.randomUUID(),
        barberId,
        serviceId,
        clientId: clientId ?? null,
        timeRange: {
          start: this.clock.localTimeToUtc(calendarDate, startTime),
          end: this.clock.localTimeToUtc(calendarDate, endTime),
        },
        searchWindow: this.clock.businessDayBounds(calendarDate),
      });
      return toWalkInResponse(walkIn);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }
}
