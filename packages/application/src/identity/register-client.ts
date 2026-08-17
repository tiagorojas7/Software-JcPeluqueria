import type { ClientAccountRepository, ClientRepository, HoldRepository } from '@jc-barberia/domain';

export interface RegisterClientInput {
  readonly holdId: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly age?: number | null;
}

export type RegisterClientResult =
  | { readonly outcome: 'registered'; readonly clientId: string; readonly userId: string }
  | { readonly outcome: 'hold-expired' };

/**
 * client-booking spec, "Cuenta sin contraseña creada al final del flujo"
 * (Scenario "Registro al confirmar la reserva"): finds-or-creates the
 * `Client` (same find-or-create shape `CreatePhoneAppointmentUseCase`
 * already uses for `ClientRepository`), attaches it to the hold the visitor
 * has been holding since 9.3/9.4, and finds-or-creates the passwordless
 * `ClientAccount`. No password parameter travels through this class at any
 * point — `ClientAccountRepository.create` structurally cannot accept one.
 *
 * `holds.attachClient` is the gate: if the hold already expired (or was
 * consumed by something else), NOTHING that grants account access is
 * created — the account is only ever created for a hold that is still
 * genuinely live. Finding-or-creating the `Client` row itself is harmless
 * either way (it grants no access on its own), so it happens first.
 */
export class RegisterClientUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly accounts: ClientAccountRepository,
    private readonly holds: HoldRepository,
  ) {}

  async execute(input: RegisterClientInput): Promise<RegisterClientResult> {
    const client =
      (await this.clients.findByPhone(input.phone)) ??
      (await this.clients.create({
        name: input.name,
        phone: input.phone,
        email: input.email,
        age: input.age ?? null,
      }));

    const attached = await this.holds.attachClient(input.holdId, client.id);
    if (!attached) {
      return { outcome: 'hold-expired' };
    }

    const account =
      (await this.accounts.findByClientId(client.id)) ??
      (await this.accounts.create({ clientId: client.id, email: input.email }));

    return { outcome: 'registered', clientId: client.id, userId: account.id };
  }
}
