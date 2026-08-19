import {
  type Appointment,
  type ClientRepository,
  type HoldRepository,
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

export interface CreatePhoneAppointmentInput {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly timeRange: TimeWindow;
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
  ) {}

  async execute(input: CreatePhoneAppointmentInput): Promise<Appointment> {
    const client =
      (await this.clients.findByPhone(input.client.phone)) ??
      (await this.clients.create({
        name: input.client.name,
        phone: input.client.phone,
        email: input.client.email ?? null,
        age: input.client.age ?? null,
      }));

    const hold = await this.createHold.execute({
      id: input.id,
      barberId: input.barberId,
      serviceId: input.serviceId,
      clientId: client.id,
      channel: 'telefonico',
      timeRange: input.timeRange,
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
}
