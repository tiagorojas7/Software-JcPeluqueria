import {
  createBarber,
  dayOfWeekOf,
  type AppointmentRepository,
  type Barber,
  type BarberRepository,
  type BarberSchedule,
  type Clock,
  type Client,
  type ClientRepository,
  type DayOfWeek,
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

/** docs/HUECOS-BACKEND.md #6 — `configureBarberWeek`'s answer. */
export type ConfigureBarberWeekResult =
  | { readonly outcome: 'configured' }
  | { readonly outcome: 'needs-confirmation'; readonly affectedAppointmentIds: readonly string[] };

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
    /** `configureBarberWeek`'s orphan-turno check — see that method's own
     *  doc comment. */
    private readonly appointments: AppointmentRepository,
    private readonly clock: Clock,
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
   * single `barber_schedules` row.
   *
   * docs/HUECOS-BACKEND.md #6, "Apagar un día en Horarios no apaga el día":
   * `days` is now treated as the barber's COMPLETE week, not a set of
   * additions. It used to only ever create or update — a day the owner
   * unchecked in the panel simply vanished from the outgoing payload, and
   * the backend left the old row exactly as it was: the operator saw a
   * success message and the barber kept working a day the screen said was
   * off.
   *
   * The doc's own "segunda parte" is this method's second half: turning off
   * a day can orphan an already-`reservado` turno that still sits on it.
   * Rather than silently deleting the day out from under that turno, this
   * checks FIRST — every future `reservado` appointment whose day of week is
   * about to lose its schedule row — and, unless the caller already passed
   * `confirm: true`, refuses to write anything at all, returning exactly
   * which appointments would be orphaned. The owner decides with that number
   * in hand; a second call with `confirm: true` performs the exact same
   * write this method always did. No affected turnos means no question to
   * ask, so the write proceeds immediately either way.
   */
  async configureBarberWeek(
    barberId: string,
    days: readonly Omit<BarberSchedule, 'barberId'>[],
    options?: { readonly confirm?: boolean },
  ): Promise<ConfigureBarberWeekResult> {
    const keptDaysOfWeek = new Set<DayOfWeek>(days.map((day) => day.dayOfWeek));

    if (!options?.confirm) {
      const currentSchedule = await this.schedules.listBarberSchedule(barberId);
      const removedDaysOfWeek = new Set(
        currentSchedule.map((day) => day.dayOfWeek).filter((dayOfWeek) => !keptDaysOfWeek.has(dayOfWeek)),
      );
      if (removedDaysOfWeek.size > 0) {
        const futureAppointments = await this.appointments.findReservedByBarberFrom(barberId, this.clock.now());
        const affectedAppointmentIds = futureAppointments
          .filter((appointment) => removedDaysOfWeek.has(dayOfWeekOf(this.clock.calendarDateOf(appointment.timeRange.start))))
          .map((appointment) => appointment.id);
        if (affectedAppointmentIds.length > 0) {
          return { outcome: 'needs-confirmation', affectedAppointmentIds };
        }
      }
    }

    await this.schedules.deleteBarberScheduleForDaysNotIn(barberId, [...keptDaysOfWeek]);
    for (const day of days) {
      await this.configureBarberSchedule({ barberId, ...day });
    }
    return { outcome: 'configured' };
  }

  /**
   * The read half `configureBarberWeek` never had. The panel could WRITE a
   * barber's week but nothing could ask what it currently is, so "Horarios"
   * always opened blank — the secretary had to remember each barber's days
   * from memory, and saving wiped whatever she failed to recall. The
   * phone/walk-in forms had the same hole from the other side: they offered
   * all seven days as if every one of them were bookable.
   *
   * `barberId` is dropped from each row on purpose: whoever asks already
   * supplied it, and the shape then matches `configureBarberWeek`'s own
   * input exactly, so a screen can read the week, edit it, and send it back
   * without translating between two shapes.
   *
   * Ordered by day of week — a week is read as a week, not in whatever
   * order rows happen to come back.
   */
  async getBarberWeek(barberId: string): Promise<Omit<BarberSchedule, 'barberId'>[]> {
    const schedule = await this.schedules.listBarberSchedule(barberId);
    return schedule
      .map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  }

  /** "precios de servicios" — `false` means no service with that id exists. */
  async configureServicePrice(serviceId: string, priceCents: number): Promise<boolean> {
    return this.services.updatePrice(serviceId, priceCents);
  }
}
