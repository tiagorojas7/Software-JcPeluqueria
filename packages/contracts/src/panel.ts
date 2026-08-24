import { z } from 'zod';

/**
 * Wire contracts for the panel's client/barber management screens
 * (admin-operations spec, "Gestión de clientes y de barberos", tasks
 * 10.14/10.15). Each request maps to exactly one of the four permissions
 * the Fase 3b seed already grants asymmetrically (`client:manage` to owner
 * AND secretary; `barber:manage`/`schedule:configure`/`pricing:configure`
 * to owner only) — see `ManageClientsAndBarbersController`.
 */

const DAY_OF_WEEK = z.number().int().min(0).max(6);
const WALL_CLOCK_TIME = z.string().regex(/^\d{2}:\d{2}$/, 'Formato esperado: HH:mm');

const BarberScheduleDaySchema = z.object({
  dayOfWeek: DAY_OF_WEEK,
  opensAt: WALL_CLOCK_TIME,
  closesAt: WALL_CLOCK_TIME,
});

export const AddBarberRequestSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  schedule: z.array(BarberScheduleDaySchema).min(1, 'El horario base es obligatorio'),
});

export type AddBarberRequest = z.infer<typeof AddBarberRequestSchema>;

export interface BarberResponse {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export interface ClientRecordResponse {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly age: number | null;
}

export interface ClientsListResponse {
  readonly clients: readonly ClientRecordResponse[];
}

export const ConfigureBarberScheduleRequestSchema = BarberScheduleDaySchema;

export type ConfigureBarberScheduleRequest = z.infer<typeof ConfigureBarberScheduleRequestSchema>;

/**
 * panel-usable: the per-day endpoint above (`ConfigureBarberScheduleRequestSchema`,
 * `PUT /panel/barbers/:barberId/schedule`) is what the panel used to call —
 * once per day, five times for a five-day week. Verified against the
 * database: every barber created or scheduled through the panel ended up
 * with exactly ONE `barber_schedules` row no matter how many working days
 * the owner actually meant to configure, because the panel only ever made
 * one call. This lets the panel set a barber's WHOLE week in a single
 * request; the per-day endpoint stays exactly as it was, unremoved, for any
 * other caller that relies on configuring one day at a time.
 */
export const ConfigureBarberWeekRequestSchema = z.object({
  schedule: z.array(BarberScheduleDaySchema).min(1, 'El horario semanal es obligatorio'),
});

export type ConfigureBarberWeekRequest = z.infer<typeof ConfigureBarberWeekRequestSchema>;

export const ConfigureServicePriceRequestSchema = z.object({
  priceCents: z.number().int().positive('El precio debe ser mayor a cero'),
});

export type ConfigureServicePriceRequest = z.infer<typeof ConfigureServicePriceRequestSchema>;
