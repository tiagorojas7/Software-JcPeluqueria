import {
  createBarber,
  type Barber,
  type BarberRepository,
  type BarberSchedule,
  type Client,
  type ClientRepository,
  type ScheduleRepository,
  type ServiceRepository,
} from '@jc-barberia/domain';

import type { ManageBarberAccountsUseCase } from './manage-barber-accounts';

export interface AddBarberInput {
  readonly id: string;
  readonly name: string;
  /** Where the activation invite goes, and the barber's login identity from
   *  then on (`users.email`, UNIQUE). Not optional: README section 3.9 makes
   *  the profile the door the barber walks in through, and an alta with no
   *  email produces someone who can be assigned turnos but can never open
   *  the panel — which is exactly the gap this parameter closes. */
  readonly email: string;
  /** The barber's base weekly schedule — one row per working day. Without
   *  at least one row, `AvailabilityService.workingWindows()` can never
   *  produce a working window for them, no matter how `active` they are. */
  readonly schedule: readonly Omit<BarberSchedule, 'barberId'>[];
}

export type AddBarberResult =
  | { readonly outcome: 'added'; readonly barber: Barber; readonly userId: string }
  | { readonly outcome: 'email-taken' };

/**
 * admin-operations spec, "Gestión de clientes y de barberos":
 *
 *   El sistema MUST poder ver y administrar los registros de clientes. El
 *   alta y baja de barberos, y la configuración de horarios base y precios
 *   de servicios, MUST quedar restringidas a los roles autorizados según
 *   access-control.
 *
 * No actor/permission check happens in here — same pattern every other
 * panel use case in this codebase follows (`CreatePhoneAppointmentUseCase`,
 * `EditAppointmentUseCase`): the HTTP boundary's `@RequiresPermission(...)`
 * is the one place that decides who may call which method, matching the
 * FOUR distinct permissions the 3b seed already grants asymmetrically
 * (`client:manage` to owner AND secretary; `barber:manage`/
 * `schedule:configure`/`pricing:configure` to owner only) — this class does
 * not re-decide that split, it only supplies the capabilities the split
 * gates.
 */
export class ManageClientsAndBarbersUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly barbers: BarberRepository,
    private readonly schedules: ScheduleRepository,
    private readonly services: ServiceRepository,
    /** The alta owns the account too — see `addBarber`. Injected as a use
     *  case rather than as raw ports so that "dar de alta un barbero" and
     *  "invitar a un barbero" cannot drift into two different meanings of
     *  the same act. */
    private readonly accounts: ManageBarberAccountsUseCase,
  ) {}

  /** "ver... los registros de clientes." */
  async listClients(): Promise<Client[]> {
    return this.clients.list();
  }

  /**
   * Scenario "Alta de un nuevo barbero":
   *   GIVEN un rol autorizado para configuración
   *   WHEN da de alta un nuevo barbero con su horario base
   *   THEN el barbero queda disponible para asignación de turnos
   *
   * "Disponible para asignación" is not a status flag this method sets — it
   * is the observable consequence of two things together: `Barber.active
   * === true` (so `GetPublicAvailabilityUseCase` never filters them out)
   * and at least one `BarberSchedule` row (so
   * `AvailabilityService.workingWindows()` produces a non-empty window).
   * Both happen in the same call, never one without the other.
   *
   * A THIRD thing happens in that same call now: the barber's login account
   * and its activation invite (README 3.9, "es la puerta por la que entra al
   * sistema"). It used to be missing entirely, which produced barbers who
   * were assignable but had no way in. The email is checked for collision
   * BEFORE anything is written, because the only failure mode left —
   * `users.email` is UNIQUE — must not be discovered halfway through, with
   * the `barbers` row already committed and the account impossible: that is
   * the very state this method exists to make unreachable.
   */
  async addBarber(input: AddBarberInput): Promise<AddBarberResult> {
    if (!(await this.accounts.emailAvailable(input.email))) {
      return { outcome: 'email-taken' };
    }

    const barber = createBarber({ id: input.id, name: input.name, active: true });
    await this.barbers.create(barber);
    for (const day of input.schedule) {
      await this.schedules.createBarberSchedule({ barberId: barber.id, ...day });
    }

    const invited = await this.accounts.invite({ barberId: barber.id, email: input.email });
    if (invited.outcome !== 'invited') {
      // Unreachable through this path: the barber was just created, has no
      // account, and the email was free a moment ago. Surfaced rather than
      // swallowed so a future caller cannot quietly reintroduce the
      // accountless barber.
      throw new Error(`No se pudo crear la cuenta del barbero "${barber.id}": ${invited.outcome}`);
    }
    return { outcome: 'added', barber, userId: invited.userId };
  }

  /** "baja de barberos" — `false` means no barber with that id exists. */
  async deactivateBarber(barberId: string): Promise<boolean> {
    return this.barbers.deactivate(barberId);
  }

  /**
   * "la configuración de horarios base" for a day already on file. Falls
   * back to `createBarberSchedule` when the barber has no row yet for that
   * day — the `(barber_id, day_of_week)` uniqueness (Fase 1, horario
   * corrido) makes the two operations mutually exclusive for the same day,
   * never both valid.
   */
  async configureBarberSchedule(schedule: BarberSchedule): Promise<void> {
    const updated = await this.schedules.updateBarberSchedule(schedule);
    if (!updated) {
      await this.schedules.createBarberSchedule(schedule);
    }
  }

  /**
   * panel-usable: lets the panel set a barber's WHOLE week in one call —
   * configuring day-by-day through `configureBarberSchedule` used to be the
   * panel's only option, and it only ever made ONE such call, which is why
   * every barber created or rescheduled through the panel ended up with a
   * single `barber_schedules` row. Loops the exact same create-or-update
   * fallback `configureBarberSchedule` already applies, one day at a time,
   * so this is not a second way of writing a schedule row — it is that same
   * write, repeated for every day the caller sends.
   *
   * Never deletes a day's row for a day left OUT of `days` — neither this
   * method nor `configureBarberSchedule` has ever been able to remove a
   * working day, only create or update one.
   */
  async configureBarberWeek(barberId: string, days: readonly Omit<BarberSchedule, 'barberId'>[]): Promise<void> {
    for (const day of days) {
      await this.configureBarberSchedule({ barberId, ...day });
    }
  }

  /** "precios de servicios" — `false` means no service with that id exists. */
  async configureServicePrice(serviceId: string, priceCents: number): Promise<boolean> {
    return this.services.updatePrice(serviceId, priceCents);
  }
}
