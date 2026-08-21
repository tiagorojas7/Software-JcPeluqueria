import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { CreatePhoneAppointmentUseCase, PhoneAppointmentServiceNotFoundError } from '@jc-barberia/application';
import { CreatePhoneAppointmentRequestSchema, type PhoneAppointmentResponse } from '@jc-barberia/contracts';
import type { Appointment, Clock } from '@jc-barberia/domain';

import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';
import { CLOCK } from './tokens';

function toResponse(appointment: Appointment): PhoneAppointmentResponse {
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

/**
 * Task 10.1/10.2's "formulario del panel" endpoint. Time travels as
 * `calendarDate` + local `HH:mm` (see `CreatePhoneAppointmentRequestSchema`)
 * so `Clock.localTimeToUtc` is the only place a concrete instant is built —
 * this handler never constructs a `Date` itself.
 */
@Controller('appointments')
export class PhoneAppointmentController {
  constructor(
    private readonly createPhoneAppointment: CreatePhoneAppointmentUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @RequiresPermission('appointment:create')
  @Post('phone')
  async create(@Body() body: unknown): Promise<PhoneAppointmentResponse> {
    const parsed = CreatePhoneAppointmentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { barberId, serviceId, calendarDate, startTime, client } = parsed.data;

    try {
      const appointment = await this.createPhoneAppointment.execute({
        id: crypto.randomUUID(),
        barberId,
        serviceId,
        // No endTime here on purpose: the use case derives it itself from the
        // selected service's durationMinutes, never from the request body.
        startsAt: this.clock.localTimeToUtc(calendarDate, startTime),
        // Bounds alternatives on conflict; the shop's actual per-barber working
        // window (Phase 1's AvailabilityService) is a refinement left for when
        // this endpoint grows a real availability lookup.
        searchWindow: this.clock.businessDayBounds(calendarDate),
        client,
      });

      return toResponse(appointment);
    } catch (error) {
      if (error instanceof PhoneAppointmentServiceNotFoundError) {
        throw new BadRequestException(`No existe el servicio "${error.serviceId}"`);
      }
      throw error;
    }
  }
}
