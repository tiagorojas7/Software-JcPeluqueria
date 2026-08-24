import type { Client, ClientRepository } from '@jc-barberia/domain';

export interface GetOwnProfileInput {
  /** The authenticated client's own id, resolved by the endpoint from the
   *  session (`users.client_id`) — same posture as `ListOwnAppointmentsInput.clientId`/
   *  `SelfCancelInput.clientId`, never taken from the request body/query. */
  readonly clientId: string;
}

/**
 * panel-usable: "the owner wants their stored details filled in
 * automatically, confirmed once, and then straight to paying the deposit"
 * for a returning client. Lets the booking flow (and "Mi cuenta") read back
 * the client's own stored name/phone/email/age instead of asking them to
 * retype it on every booking — the same information `RegisterClientUseCase`
 * already wrote the first time they confirmed a reservation.
 *
 * `null` only if the session's `clientId` somehow no longer resolves to a
 * client row — a data-integrity edge case, not the ordinary "not logged in"
 * case (that is rejected earlier, by `@RequiresClientSession()` itself,
 * before this use case ever runs).
 */
export class GetOwnProfileUseCase {
  constructor(private readonly clients: ClientRepository) {}

  async execute(input: GetOwnProfileInput): Promise<Client | null> {
    return this.clients.findById(input.clientId);
  }
}
