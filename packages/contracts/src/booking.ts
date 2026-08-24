import { z } from 'zod';

/**
 * client-booking spec, "Exploración sin cuenta": query params for the public
 * availability endpoint. No session, no account field anywhere in this
 * schema — an anonymous visitor is the only caller this contract describes.
 */
export const GetAvailabilityQuerySchema = z.object({
  barberId: z.string().uuid(),
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
});

export type GetAvailabilityQuery = z.infer<typeof GetAvailabilityQuerySchema>;

export interface AvailabilitySlot {
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface AvailabilityResponse {
  readonly slots: readonly AvailabilitySlot[];
}

/**
 * client-booking spec, "Cuenta sin contraseña creada al final del flujo":
 * `holdId` ties the hold created when the visitor picked a schedule (see
 * `CreateHoldRequestSchema`) to the account being registered at the end of
 * the flow. `email` is required here — unlike the phone-appointment contract
 * — because web access without a password depends on it to deliver the
 * access code/link.
 */
export const CreateHoldRequestSchema = z.object({
  barberId: z.string().uuid(),
  serviceId: z.string().uuid(),
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm'),
});

export type CreateHoldRequest = z.infer<typeof CreateHoldRequestSchema>;

export interface HoldResponse {
  readonly holdId: string;
  readonly expiresAt: string;
}

export const ConfirmReservationRequestSchema = z.object({
  holdId: z.string().uuid(),
  client: z.object({
    name: z.string().min(1, 'El nombre es obligatorio'),
    phone: z.string().min(1, 'El teléfono es obligatorio'),
    // Required (not `.optional()`/`.nullable()` like the phone-appointment
    // contract): client-booking spec says access without a password depends
    // on it, so the web flow cannot accept a missing email the way a phone
    // booking can.
    email: z.string().min(1, 'El email es obligatorio').email('Email inválido'),
    age: z.number().int().positive().nullable().optional(),
  }),
});

export type ConfirmReservationRequest = z.infer<typeof ConfirmReservationRequestSchema>;

export interface ConfirmReservationResponse {
  readonly clientId: string;
}

export const CheckoutRequestSchema = z.object({
  holdId: z.string().uuid(),
});

export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export type CheckoutResponseBody =
  | { readonly outcome: 'created'; readonly initPoint: string }
  | { readonly outcome: 'hold-expired' };

/**
 * client-booking spec, "Exploración sin cuenta". `priceCents` is the real,
 * integer value the panel writes (`configureServicePrice`) — never a
 * formatted string baked in server-side. Formatting for display is the
 * browser's job, not this contract's.
 */
export interface PublicBarberResponse {
  readonly id: string;
  readonly name: string;
}

export interface PublicBarbersResponse {
  readonly barbers: readonly PublicBarberResponse[];
}

export interface PublicServiceResponse {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number;
}

export interface PublicServicesResponse {
  readonly services: readonly PublicServiceResponse[];
}
