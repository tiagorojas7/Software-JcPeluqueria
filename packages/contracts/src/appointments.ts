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
