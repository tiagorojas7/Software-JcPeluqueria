import type {
  BarberRepository,
  NotificationOutboxRepository,
  StaffAccount,
  StaffAccountRepository,
} from '@jc-barberia/domain';

import type { ChallengeService } from '../identity/challenge-service';

export interface InviteBarberInput {
  readonly barberId: string;
  readonly email: string;
}

export type InviteBarberResult =
  | { readonly outcome: 'invited'; readonly userId: string }
  | { readonly outcome: 'barber-not-found' }
  | { readonly outcome: 'already-has-account' }
  | { readonly outcome: 'email-taken' };

export type ResendInviteResult = { readonly outcome: 'sent' } | { readonly outcome: 'not-found' };

/** One row of the owner's accounts screen: who the account belongs to, how
 *  they log in, and the only two states the owner can act on. */
export interface BarberAccountView {
  readonly userId: string;
  readonly barberId: string;
  readonly barberName: string;
  readonly email: string;
  readonly active: boolean;
  readonly activated: boolean;
}

/**
 * README section 3.9, "Perfil del barbero": *"No es opcional: es la puerta
 * por la que entra al sistema."* Creating a `Barber` used to stop at the
 * agenda — the person became assignable and appeared in public availability
 * while no `users` row existed for them, so there was nothing to log in as.
 * This is the other half: the account, its invitation, and the owner's
 * control over it.
 *
 * The owner controls the ACCOUNT, never the CREDENTIAL. Every method here
 * routes through `ChallengeService` (a single-use, hashed, expiring secret
 * — the same primitive client login already uses) and the outbox; not one
 * of them accepts, returns or stores a password. `StaffAccountRepository`
 * has no parameter through which one could travel, and the only seam in
 * this codebase that writes a hash stays `PasswordService.setPassword`,
 * reached exclusively by `ActivateStaffUseCase` when the barber themselves
 * picks their password. So "el dueño tiene todo el control de las cuentas"
 * is true in the sense that matters — create, invite, re-invite, revoke,
 * restore — and false in the one that would be a liability: the owner
 * cannot read or choose anybody's password.
 *
 * → access-control: "Contraseñas del personal almacenadas de forma segura"
 */
export class ManageBarberAccountsUseCase {
  constructor(
    private readonly accounts: StaffAccountRepository,
    private readonly barbers: BarberRepository,
    private readonly challenges: ChallengeService,
    private readonly outbox: NotificationOutboxRepository,
  ) {}

  /**
   * Creates the account for a barber already on file and sends the
   * activation link. Both collision checks happen BEFORE the account is
   * created, so a rejected alta leaves nothing half-written: no orphan
   * `users` row, no invite to an account that will never be usable.
   */
  async invite(input: InviteBarberInput): Promise<InviteBarberResult> {
    const barber = await this.barbers.findById(input.barberId);
    if (!barber) {
      return { outcome: 'barber-not-found' };
    }
    if (await this.accounts.findByBarberId(input.barberId)) {
      return { outcome: 'already-has-account' };
    }
    if (await this.accounts.findByEmail(input.email)) {
      return { outcome: 'email-taken' };
    }

    const account = await this.accounts.create({
      email: input.email,
      role: 'barber',
      barberId: input.barberId,
    });
    await this.sendActivation(account);
    return { outcome: 'invited', userId: account.id };
  }

  /**
   * A new activation link for an account that already exists — the answer
   * to both "no me llegó el mail" and "me olvidé la contraseña". Deliberately
   * ONE operation for both: `ChallengeService.issue` invalidates whatever
   * was still alive for this `(userId, purpose)` before writing the new
   * challenge, so the previous link stops working the moment a new one goes
   * out, and an already-activated barber simply picks a new password over
   * the old one. Splitting it into "reenviar" and "resetear" would be two
   * buttons doing the same thing to the database.
   */
  async resendInvite(userId: string): Promise<ResendInviteResult> {
    const account = await this.accounts.findById(userId);
    if (!account) {
      return { outcome: 'not-found' };
    }
    await this.sendActivation(account);
    return { outcome: 'sent' };
  }

  /**
   * Revokes or restores the login. Deliberately separate from
   * `ManageClientsAndBarbersUseCase.deactivateBarber`: taking a barber off
   * the agenda and taking away their password are different decisions, and
   * a barber on holiday is the case where the shop wants one without the
   * other. `false` means no account has this id.
   */
  async setActive(userId: string, active: boolean): Promise<boolean> {
    return this.accounts.setActive(userId, active);
  }

  /**
   * Whether `users.email` is still free. Exists so the alta of a barber can
   * reject a colliding email BEFORE writing the `barbers` row — `invite()`
   * requires the barber to already exist, so without this the alta would
   * have to create the barber first and could then fail the invite, leaving
   * behind exactly the accountless barber this whole use case exists to
   * eliminate.
   */
  async emailAvailable(email: string): Promise<boolean> {
    return (await this.accounts.findByEmail(email)) === null;
  }

  /** Every barber account, activated or not — "invitado y nunca activado" is
   *  exactly the row the owner needs to see in order to chase it. */
  async list(): Promise<BarberAccountView[]> {
    const [accounts, barbers] = await Promise.all([this.accounts.listByRole('barber'), this.barbers.list()]);
    const nameById = new Map(barbers.map((barber) => [barber.id, barber.name]));
    return accounts.map((account) => ({
      userId: account.id,
      barberId: account.barberId ?? '',
      barberName: nameById.get(account.barberId ?? '') ?? '',
      email: account.email,
      active: account.active,
      activated: account.activated,
    }));
  }

  /**
   * The intent goes to the outbox, never straight to a transport — same
   * discipline `RequestClientAccessUseCase` follows. The payload shape is
   * the one `staff_activation`'s template reads: the challenge id and token
   * that together form the link, plus its expiry.
   */
  private async sendActivation(account: StaffAccount): Promise<void> {
    const issued = await this.challenges.issue({ userId: account.id, purpose: 'staff_activation' });
    await this.outbox.enqueue({
      notificationType: 'staff_activation',
      recipientEmail: account.email,
      payload: {
        challengeId: issued.challengeId,
        token: issued.token,
        expiresAt: issued.expiresAt.toISOString(),
      },
    });
  }
}
