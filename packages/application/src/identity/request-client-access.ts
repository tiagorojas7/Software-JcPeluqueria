import type { ClientAccountRepository, NotificationOutboxRepository } from '@jc-barberia/domain';

import type { ChallengeService } from './challenge-service';

export interface RequestClientAccessInput {
  /**
   * cuenta-cliente-persistente: keyed by EMAIL, not phone. A web booking
   * always captures the client's email (`ConfirmReservationRequestSchema`)
   * and creates the passwordless account at that exact moment, so the email
   * the client just typed — and will remember — is a reliable, single-hop
   * key straight to `ClientAccountRepository` (`users.email`, UNIQUE). The
   * original phone key stays correct for `CreatePhoneAppointmentUseCase`'s
   * own world (a phone-booked client may have no email at all — see
   * `ClientRepository`'s own doc comment), but that reasoning never covered
   * THIS entrypoint, which only a web booking ever reaches.
   */
  readonly email: string;
}

/**
 * Deliberately has ONE shape, with no variant. Whether an email is on file,
 * and whether it belongs to a client who ever completed web registration,
 * must not be discoverable by probing this endpoint — the same stance
 * `ResetPasswordUseCase.request` takes.
 */
export type RequestClientAccessResult = { readonly outcome: 'requested' };

const REQUESTED: RequestClientAccessResult = { outcome: 'requested' };

/**
 * Issues the passwordless access code a client uses to reach their web
 * account (client-booking spec, "Cuenta sin contraseña creada al final del
 * flujo": access happens through a one-time code or link, never a password).
 *
 * This is the producing half that `ClientLoginUseCase` consumes. Looks the
 * account up by email in ONE hop via `ClientAccountRepository.findByEmail`
 * — the exact idiom `ResetPasswordUseCase.request` already uses via
 * `UserCredentialsRepository.findByEmail` — rather than the two-hop
 * phone -> client -> account lookup this use case used before
 * cuenta-cliente-persistente. A phone-booked client with no email simply has
 * no account to find (`ClientAccountRepository.create` only ever runs at the
 * end of a WEB booking), so that population is structurally unreachable
 * here, same conclusion as before, reached without ever touching
 * `ClientRepository` at all now.
 */
export class RequestClientAccessUseCase {
  constructor(
    private readonly accounts: ClientAccountRepository,
    private readonly challenges: ChallengeService,
    private readonly outbox: NotificationOutboxRepository,
  ) {}

  async execute(input: RequestClientAccessInput): Promise<RequestClientAccessResult> {
    const account = await this.accounts.findByEmail(input.email);
    if (!account) {
      return REQUESTED;
    }

    const issued = await this.challenges.issue({
      userId: account.id,
      purpose: 'client_login',
    });

    // The intent goes to the outbox, never straight to a transport: delivery
    // and its retries belong to the outbox consumer (6.12/6.13), exactly like
    // `AppointmentReminder` does it. `challengeId` travels here (never in
    // this use case's own return value, which must stay outcome-identical
    // across every branch) because `ClientLoginUseCase.execute` needs it to
    // scope a guess to ONE specific challenge — the same id the legitimate
    // recipient of this notification is the only one who ever sees.
    await this.outbox.enqueue({
      notificationType: 'client_access_code',
      recipientEmail: account.email,
      payload: {
        challengeId: issued.challengeId,
        code: issued.code,
        token: issued.token,
        expiresAt: issued.expiresAt.toISOString(),
      },
    });

    return REQUESTED;
  }
}
