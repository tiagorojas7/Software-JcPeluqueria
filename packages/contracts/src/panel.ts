import { z } from 'zod';

import { emailField } from './email-field';

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

/**
 * `opensAt < closesAt` is enforced HERE, not only in the domain.
 *
 * `createBarberSchedule` (packages/domain) has always asserted it, but that
 * runs when a schedule is READ. Validating only the `HH:mm` shape on the way
 * in let the panel store `13:00 → 00:00`, and the row then threw every time
 * anyone asked for availability — and because `GetPublicAvailabilityUseCase`
 * fans out over all barbers at once, a single bad row left the WHOLE shop
 * with no bookable times, not just that barber.
 *
 * Comparing the strings is correct precisely because they are zero-padded
 * `HH:mm`: lexicographic order and clock order agree. A shift that ends at
 * midnight cannot be expressed in this model (`00:00` sorts before
 * everything), so it is refused with an explanation rather than accepted and
 * broken later — the shop can close at `23:59`.
 */
const BarberScheduleDaySchema = z
  .object({
    dayOfWeek: DAY_OF_WEEK,
    opensAt: WALL_CLOCK_TIME,
    closesAt: WALL_CLOCK_TIME,
  })
  .refine((day) => day.opensAt < day.closesAt, {
    message: 'El horario de cierre tiene que ser posterior al de apertura (por ejemplo 09:00 a 18:00)',
    path: ['closesAt'],
  });

export const AddBarberRequestSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  /** README 3.9: the profile is the door the barber walks in through, so the
   *  alta captures where the activation invite goes and what they will log
   *  in as. Required — an alta without it produced a barber who could be
   *  assigned turnos and could never open the panel. */
  email: emailField('Email inválido'),
  schedule: z.array(BarberScheduleDaySchema).min(1, 'El horario base es obligatorio'),
});

export type AddBarberRequest = z.infer<typeof AddBarberRequestSchema>;

/**
 * One row of the owner's "Cuentas de barberos" screen — one per BARBER, not
 * one per account. `userId`/`email` are `null` for a barber who has no
 * account yet: the barbers already on file from before the alta started
 * creating one, who would otherwise be invisible on the only screen that can
 * give them access.
 *
 * `activated` is the state that matters operationally — an account invited
 * and never activated is the one that needs chasing — and it is derived from
 * whether a password hash exists, never from the hash itself. No credential
 * appears in this contract, in either direction: the owner controls the
 * account, not the password (see `ManageBarberAccountsUseCase`).
 */
export interface BarberAccountResponse {
  readonly userId: string | null;
  readonly barberId: string;
  readonly barberName: string;
  readonly email: string | null;
  readonly active: boolean;
  readonly activated: boolean;
}

/** Giving an account to a barber who already exists — the alta does this in
 *  one step for new barbers, and this is the same act for everyone else. */
export const InviteBarberAccountRequestSchema = z.object({
  barberId: z.string().min(1, 'Falta el barbero'),
  email: emailField('Email inválido'),
});

export type InviteBarberAccountRequest = z.infer<typeof InviteBarberAccountRequestSchema>;

export interface BarberAccountsListResponse {
  readonly accounts: readonly BarberAccountResponse[];
}

/** Whether the account may log in at all. Deliberately separate from the
 *  barber's own `active` flag: taking someone off the agenda and taking away
 *  their access are different decisions. */
export const SetBarberAccountActiveRequestSchema = z.object({
  active: z.boolean(),
});

export type SetBarberAccountActiveRequest = z.infer<typeof SetBarberAccountActiveRequestSchema>;

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
  /**
   * docs/HUECOS-BACKEND.md #6, segunda parte: turning off a day here can
   * orphan a turno that is still `reservado` on it. Omitted (or `false`)
   * means "ask first" — if any turno would be orphaned, nothing is written
   * and the response names them instead. Only a second call with
   * `confirm: true`, from a panel screen that already showed the owner that
   * count, performs the write.
   */
  confirm: z.boolean().optional(),
});

export type ConfigureBarberWeekRequest = z.infer<typeof ConfigureBarberWeekRequestSchema>;

/**
 * `configured: true` is the same success shape this endpoint always
 * returned. `configured: false` is new: the write did NOT happen, and
 * `affectedAppointmentIds` names every turno that a day being turned off
 * would leave without a working schedule under it — the number the owner
 * needs before deciding to retry with `confirm: true`.
 */
export type ConfigureBarberWeekResponseBody =
  | { readonly configured: true }
  | { readonly configured: false; readonly affectedAppointmentIds: readonly string[] };

export const ConfigureServicePriceRequestSchema = z.object({
  priceCents: z.number().int().positive('El precio debe ser mayor a cero'),
});

export type ConfigureServicePriceRequest = z.infer<typeof ConfigureServicePriceRequestSchema>;
