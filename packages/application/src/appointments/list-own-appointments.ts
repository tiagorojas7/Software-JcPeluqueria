import type {
  Appointment,
  AppointmentRepository,
  BarberRepository,
  ServiceRepository,
} from '@jc-barberia/domain';

export interface ListOwnAppointmentsInput {
  /** The authenticated client's own id, resolved by the endpoint from the
   *  session (`users.client_id`) — same posture as `SelfCancelInput.clientId`,
   *  never taken from the request body/query. */
  readonly clientId: string;
}

/**
 * One of the client's own turnos, with the two ids already resolved to the
 * names a person can read.
 */
export interface OwnAppointment extends Appointment {
  readonly serviceName: string;
  readonly barberName: string;
}

/** Shown in place of a name that is no longer in the catalogue. A gap where
 *  a name belongs reads as a bug; this reads as history. */
const UNKNOWN_BARBER = 'Barbero del local';
const UNKNOWN_SERVICE = 'Servicio';

/**
 * "Página Mi cuenta: el cliente autenticado ve sus turnos" (cablear-el-mvp,
 * Slice C.3).
 *
 * docs/HUECOS-BACKEND.md #7: this used to hand the endpoint bare
 * `barberId`/`serviceId`, so the client's own screen could show a date, an
 * hour and a status but never WHAT they booked or WITH WHOM — a uuid is not
 * something you can put in front of a person. That is the screen where they
 * decide whether to cancel, and cancelling the wrong turno costs the deposit.
 *
 * The names are resolved here rather than in the controller for the reason
 * this class already existed: the controller stays a pure HTTP/session
 * concern and never authors a query. Both catalogues are read once and
 * indexed, not queried per row, so a client with twenty turnos still costs
 * three reads.
 */
export class ListOwnAppointmentsUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly barbers: BarberRepository,
    private readonly services: ServiceRepository,
  ) {}

  async execute(input: ListOwnAppointmentsInput): Promise<OwnAppointment[]> {
    const own = await this.appointments.findByClientId(input.clientId);
    if (own.length === 0) {
      return [];
    }

    const [barbers, services] = await Promise.all([this.barbers.list(), this.services.list()]);
    const barberNames = new Map(barbers.map((barber) => [barber.id, barber.name]));
    const serviceNames = new Map(services.map((service) => [service.id, service.name]));

    return own.map((appointment) => ({
      ...appointment,
      // A deactivated barber still has past turnos under their name, and
      // `BarberRepository.list()` may not include them any more. Falling back
      // keeps the row readable instead of leaving a hole.
      barberName: barberNames.get(appointment.barberId) ?? UNKNOWN_BARBER,
      serviceName: serviceNames.get(appointment.serviceId) ?? UNKNOWN_SERVICE,
    }));
  }
}
