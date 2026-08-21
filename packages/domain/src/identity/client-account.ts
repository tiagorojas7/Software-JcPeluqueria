/**
 * A passwordless client account — a `users` row with `clientId` set and
 * nothing else identity-shaped about it (no `role`, no `barberId`). Notice
 * what is missing from this shape: no `passwordHash`, no password field of
 * any kind, anywhere. That absence is the whole point (client-booking spec,
 * "Cuenta sin contraseña creada al final del flujo") — the same technique
 * `ClientRepository`/`CreateClientInput` already uses, and the mirror image
 * of `UserCredentialsRepository.setPassword` being the ONLY seam in this
 * codebase that may ever write a password hash. Nothing that implements
 * `ClientAccountRepository` can persist a client credential, because there
 * is no parameter here through which one could travel.
 */
export interface ClientAccount {
  readonly id: string;
  readonly clientId: string;
  readonly email: string;
}

export interface CreateClientAccountInput {
  readonly clientId: string;
  readonly email: string;
}

export interface ClientAccountRepository {
  /** The account already linked to this client, if the client registered
   *  for web access before (find-or-create half of "Registro al confirmar
   *  la reserva" — a repeat client is reused, never duplicated, same as
   *  `ClientRepository.findByPhone`). */
  findByClientId(clientId: string): Promise<ClientAccount | null>;

  /**
   * cuenta-cliente-persistente: the lookup `RequestClientAccessUseCase` uses
   * — a web booking always captures an email and always creates the account
   * at that moment, so `email` is a reliable, single-hop key straight to the
   * account, the same idiom `UserCredentialsRepository.findByEmail` already
   * uses for `ResetPasswordUseCase.request`. `email` is `users.email`, which
   * carries a UNIQUE constraint, so at most one account can ever match.
   */
  findByEmail(email: string): Promise<ClientAccount | null>;

  create(input: CreateClientAccountInput): Promise<ClientAccount>;
}
