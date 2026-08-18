import { z } from 'zod';

/**
 * Wire contract for the panel's phone-appointment form (admin-operations
 * spec, "Creación de turnos telefónicos sin seña"). Time travels as
 * `calendarDate` + local `HH:mm` wall-clock strings, never a raw ISO
 * instant — the same shape `ShopClock.localTimeToUtc` expects, so the only
 * place a `Date` is ever constructed from this payload is the shop's Clock
 * adapter, never the controller.
 *
 * Only `client.name`/`client.phone` are required — `email`/`age` are
 * `nullable().optional()` on purpose: a missing email is a valid, expected
 * value here, never a validation failure (admin-operations spec,
 * "Consecuencias de un turno telefónico sin email").
 */
export const CreatePhoneAppointmentRequestSchema = z.object({
  barberId: z.string().uuid(),
  serviceId: z.string().uuid(),
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
  client: z.object({
    name: z.string().min(1, 'El nombre es obligatorio'),
    phone: z.string().min(1, 'El teléfono es obligatorio'),
    email: z.string().email('Email inválido').nullable().optional(),
    age: z.number().int().positive().nullable().optional(),
  }),
});

export type CreatePhoneAppointmentRequest = z.infer<typeof CreatePhoneAppointmentRequestSchema>;

export interface PhoneAppointmentResponse {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string;
  readonly status: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * cablear-el-mvp Slice B: the shared appointment DTO for every panel action
 * that returns the appointment it just changed (mark-completed, edit,
 * cancel) — same field shape as `PhoneAppointmentResponse`, kept as its own
 * type because those actions are not tied to the phone-booking flow.
 */
export interface AppointmentResponse {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string;
  readonly status: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * B.3's "Editar turno (servicio, barbero, horario)". Time travels as
 * `calendarDate` + local `HH:mm`, same shape every other wire contract in
 * this codebase uses.
 */
export const EditAppointmentRequestSchema = z.object({
  barberId: z.string().uuid(),
  serviceId: z.string().uuid(),
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
});

export type EditAppointmentRequest = z.infer<typeof EditAppointmentRequestSchema>;

/**
 * B.1/B.2's "resolver sin_registrado a ausente" — mirrors the domain
 * `ConfirmAbsenceResult` (appointment + the absence-history record just
 * written), never just the appointment alone: the panel needs to know the
 * seña was forfeited or not without a second round-trip.
 */
export interface ConfirmAbsenceResponseBody {
  readonly appointment: AppointmentResponse;
  readonly absence: {
    readonly appointmentId: string;
    readonly clientId: string;
    readonly confirmedByUserId: string;
    readonly confirmedAt: string;
    readonly depositForfeited: boolean;
  };
}

/**
 * B.5's "Carga de walk-ins" — only `barberId`/`serviceId` are required
 * (admin-operations spec, "servicio y barbero" only); `clientId` stays
 * `nullable().optional()` for the unidentified-customer case, the same
 * shape `CreateWalkInInput.clientId` already expects.
 */
export const CreateWalkInRequestSchema = z.object({
  barberId: z.string().uuid(),
  serviceId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
});

export type CreateWalkInRequest = z.infer<typeof CreateWalkInRequestSchema>;

export interface WalkInResponse {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string | null;
  readonly channel: 'walk_in';
  readonly status: 'realizado';
  readonly startsAt: string;
  readonly endsAt: string;
}
