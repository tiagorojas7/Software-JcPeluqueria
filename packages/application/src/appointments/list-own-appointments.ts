import type { Appointment, AppointmentRepository } from '@jc-barberia/domain';

export interface ListOwnAppointmentsInput {
  /** The authenticated client's own id, resolved by the endpoint from the
   *  session (`users.client_id`) — same posture as `SelfCancelInput.clientId`,
   *  never taken from the request body/query. */
  readonly clientId: string;
}

/**
 * "Página Mi cuenta: el cliente autenticado ve sus turnos" (cablear-el-mvp,
 * Slice C.3). Thin orchestration over `AppointmentRepository.findByClientId`
 * — kept as its own use case (rather than a direct repository call from the
 * controller) for the same reason every other self-service action in this
 * codebase is a use case: the controller stays a pure HTTP/session-resolution
 * concern, never a query author.
 */
export class ListOwnAppointmentsUseCase {
  constructor(private readonly appointments: AppointmentRepository) {}

  async execute(input: ListOwnAppointmentsInput): Promise<Appointment[]> {
    return this.appointments.findByClientId(input.clientId);
  }
}
