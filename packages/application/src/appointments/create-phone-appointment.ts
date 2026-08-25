import {
  type Appointment,
  type BarberRepository,
  type Clock,
  type ClientRepository,
  type HoldRepository,
  type NotificationOutboxRepository,
  type ServiceRepository,
  type TimeWindow,
} from '@jc-barberia/domain';

import type { CreateHold } from '../booking/create-hold';
import type { ScheduleAppointmentReminder } from '../booking/appointment-reminder';

export class PhoneAppointmentConfirmationFailedError extends Error {
  constructor(readonly holdId: string) {
    super(`Could not confirm the phone appointment hold "${holdId}" right after creating it`);
    this.name = 'PhoneAppointmentConfirmationFailedError';
  }
}

/**
 * The end time is not information the secretary has on the phone — it is a
 * property of the service she picked (admin-operations spec). This use case
 * derives it itself from `Service.durationMinutes` rather than trusting a
 * caller-supplied one, so a `serviceId` that does not exist fails loudly
 * instead of silently producing a turno with no duration to derive.
 */
export class PhoneAppointmentServiceNotFoundError extends Error {
  constructor(readonly serviceId: string) {
    super(`No service found with id "${serviceId}"`);
    this.name = 'PhoneAppointmentServiceNotFoundError';
  }
}

export interface CreatePhoneAppointmentInput {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  /** Shop-local instant the turno starts. The end is never supplied by the
   *  caller — it is always derived from the selected service's
   *  `durationMinutes` (see `PhoneAppointmentServiceNotFoundError`'s doc
   *  comment), so no caller can create a turno whose duration disagrees
   *  with its service. */
  readonly startsAt: Date;
  /** Where alternatives are searched if the slot turns out to be taken. */
  readonly searchWindow: TimeWindow;
  /**
   * Only `name`/`phone` are required (admin-operations spec, "Creación de
   * turnos telefónicos sin seña"). `email`/`age` stay `null | undefined`
   * without ever blocking the booking or the client record.
   */
  readonly client: {
    readonly name: string;
    readonly phone: string;
    readonly email?: string | null;
    readonly age?: number | null;
  };
}

/**
 * Books a phone appointment directly into `reservado`, with no deposit
 * (design.md: "la secretaria inserta channel='telefono', status='reservado',
 * deposit_id NULL"). Reuses `HoldRepository`'s existing create+confirm
 * primitive rather than a separate direct-insert path: a hold immediately
 * confirmed by the same request is exactly what a phone booking is — there
 * is no payment step to wait for, so the two steps collapse into one call.
 *
 * E.2 (cablear-el-mvp Slice E): this IS a confirmation path — the appointment
 * is `reservado` from the instant this method returns, never a later async
 * step — so it is one of the two producers `ScheduleAppointmentReminder`
 * needs (`ProcessPaymentUseCase` is the other, for web bookings whose
 * confirmation waits on a settled deposit instead).
 */
export class CreatePhoneAppointmentUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly holds: HoldRepository,
    private readonly createHold: CreateHold,
    private readonly scheduleReminder: ScheduleAppointmentReminder,
    private readonly services: ServiceRepository,
    private readonly clock: Clock,
    private readonly outbox: NotificationOutboxRepository,
    private readonly barbers: BarberRepository,
  ) {}

  async execute(input: CreatePhoneAppointmentInput): Promise<Appointment> {
    const service = await this.services.findById(input.serviceId);
    if (!service) {
      throw new PhoneAppointmentServiceNotFoundError(input.serviceId);
    }

    const client =
      (await this.clients.findByPhone(input.client.phone)) ??
      (await this.clients.create({
        name: input.client.name,
        phone: input.client.phone,
        email: input.client.email ?? null,
        age: input.client.age ?? null,
      }));

    const timeRange: TimeWindow = {
      start: input.startsAt,
      end: this.clock.addMinutes(input.startsAt, service.durationMinutes),
    };

    const hold = await this.createHold.execute({
      id: input.id,
      barberId: input.barberId,
      serviceId: input.serviceId,
      clientId: client.id,
      channel: 'telefonico',
      timeRange,
      searchWindow: input.searchWindow,
    });

    const confirmed = await this.holds.confirm(hold.id);
    if (!confirmed) {
      throw new PhoneAppointmentConfirmationFailedError(hold.id);
    }

    await this.scheduleReminder.execute({
      appointmentId: hold.id,
      appointmentStart: hold.timeRange.start,
    });

    await this.notifyBookingConfirmed({
      appointmentId: hold.id,
      barberId: hold.barberId,
      serviceName: service.name,
      startsAt: hold.timeRange.start,
      email: client.email,
    });

    return {
      id: hold.id,
      barberId: hold.barberId,
      serviceId: hold.serviceId,
      clientId: client.id,
      channel: 'telefonico',
      timeRange: hold.timeRange,
      status: 'reservado',
      deposit: { kind: 'not_applicable' },
    };
  }

  /**
   * A phone booking is `reservado` the moment this returns, exactly like a web
   * one once its deposit settles — so it earns the same `booking_confirmed`
   * message, which until now it never got.
   *
   * Same email gate the rest of the system already applies
   * (`ProcessPaymentUseCase`, `AppointmentReminder`): no email on file, no
   * dispatch, and never a crash. A phone client without an email is ordinary,
   * not an error — admin-operations' "Consecuencias de un turno telefónico sin
   * email" says so outright.
   *
   * Written to the outbox, never to `NotificationPort` directly: the worker's
   * consumer owns delivery and retries, so a mail server having a bad minute
   * can never fail the booking the secretary just took over the phone.
   */
  private async notifyBookingConfirmed(input: {
    appointmentId: string;
    barberId: string;
    serviceName: string;
    startsAt: Date;
    email: string | null;
  }): Promise<void> {
    if (!input.email) {
      return;
    }
    const barber = await this.barbers.findById(input.barberId);
    await this.outbox.enqueue({
      notificationType: 'booking_confirmed',
      recipientEmail: input.email,
      payload: {
        appointmentId: input.appointmentId,
        barberName: barber?.name ?? '',
        serviceName: input.serviceName,
        appointmentTime: input.startsAt.toISOString(),
      },
    });
  }
}
