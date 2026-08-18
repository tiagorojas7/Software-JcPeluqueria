import type {
  ClientAccountRepository,
  ClientRepository,
  NotificationOutboxRepository,
} from '@jc-barberia/domain';

import type { ChallengeService } from './challenge-service';

export interface RequestClientAccessInput {
  /** The phone number is the only key a phone-originated client reliably has
   *  — the same natural key `ClientRepository.findByPhone` exists for. */
  readonly phone: string;
}

/**
 * Deliberately has ONE shape, with no variant. Whether a phone is on file, and
 * whether it carries an email, must not be discoverable by probing this
 * endpoint — the same stance `ResetPasswordUseCase.request` takes.
 */
export type RequestClientAccessResult = { readonly outcome: 'requested' };

const REQUESTED: RequestClientAccessResult = { outcome: 'requested' };

/**
 * Issues the passwordless access code a client uses to reach their web
 * account (client-booking spec, "Cuenta sin contraseña creada al final del
 * flujo": access happens through a one-time code or link, never a password).
 *
 * This is the producing half that `ClientLoginUseCase` consumes, and the place
 * admin-operations' "Consecuencias de un turno telefónico sin email" becomes
 * real: a client whose only record came from a phone booking with no email
 * cannot be reached, so no code is ever issued for them. That is a structural
 * consequence, not a check someone remembered to write — there is no address
 * to deliver to, so nothing is created that could later be leaked or guessed.
 *
 * The shop accepts this gap knowingly for the MVP (see the spec's own note):
 * it resolves with the move to WhatsApp, where the notification channel
 * becomes the phone number the secretary already collects. Forcing an email at
 * phone-booking time would reintroduce exactly the registration friction the
 * passwordless account was built to remove.
 */
export class RequestClientAccessUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly accounts: ClientAccountRepository,
    private readonly challenges: ChallengeService,
    private readonly outbox: NotificationOutboxRepository,
  ) {}

  async execute(input: RequestClientAccessInput): Promise<RequestClientAccessResult> {
    const client = await this.clients.findByPhone(input.phone);
    if (!client) {
      return REQUESTED;
    }

    // A phone booking records the email when there is one, but never creates
    // the passwordless account — that only happens at the end of a web
    // booking (9.7/9.8). Without a `users` row there is nothing to attach a
    // challenge to, so `client.email` alone is not enough.
    const account = await this.accounts.findByClientId(client.id);
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
