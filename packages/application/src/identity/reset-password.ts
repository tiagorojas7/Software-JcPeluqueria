import {
  assertValidPassword,
  type AuthChallengePurpose,
  type NotificationPort,
  type UserCredentialsRepository,
} from '@jc-barberia/domain';

import type { ChallengeService } from './challenge-service';
import type { PasswordService } from './password-service';

export type ResetPasswordRequestResult = { readonly outcome: 'requested' };

export interface ResetPasswordCompleteInput {
  readonly challengeId: string;
  /** The 32-byte token from the reset link. */
  readonly secret: string;
  readonly newPassword: string;
}

export type ResetPasswordCompleteResult =
  | { readonly outcome: 'reset'; readonly userId: string }
  | { readonly outcome: 'rejected' };

const PASSWORD_RESET_PURPOSE: AuthChallengePurpose = 'staff_password_reset';

/**
 * Lets a staff member who forgot their password recover access without ever
 * exposing the old one. Reuses the same `auth_challenges` mechanism as
 * client login and staff activation, scoped to `staff_password_reset` (30-
 * minute lifetime — see `EXPIRY_MINUTES_BY_PURPOSE`).
 * → access-control: Contraseñas del personal almacenadas de forma segura
 *   (Restablecimiento de contraseña vía el puerto de notificación)
 */
export class ResetPasswordUseCase {
  constructor(
    private readonly credentials: UserCredentialsRepository,
    private readonly challenges: ChallengeService,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationPort,
  ) {}

  /**
   * Always resolves to the same `{ outcome: 'requested' }` shape whether or
   * not `email` belongs to a real account — and issues a challenge /
   * dispatches a notification ONLY when it does. A caller (a future HTTP
   * layer) can safely show the same "if this email exists, check your
   * inbox" message either way, so this step cannot be used to enumerate
   * which emails have staff accounts.
   */
  async request(email: string): Promise<ResetPasswordRequestResult> {
    const user = await this.credentials.findByEmail(email);
    if (!user) {
      return { outcome: 'requested' };
    }

    const issued = await this.challenges.issue({ userId: user.id, purpose: PASSWORD_RESET_PURPOSE });
    await this.notifications.send({
      to: email,
      template: 'staff_password_reset',
      data: { token: issued.token, expiresAt: issued.expiresAt.toISOString() },
    });
    return { outcome: 'requested' };
  }

  async complete(input: ResetPasswordCompleteInput): Promise<ResetPasswordCompleteResult> {
    // Validate BEFORE consuming, same reasoning as ActivateStaffUseCase: a
    // weak password must not burn the single-use reset link.
    assertValidPassword(input.newPassword);

    const result = await this.challenges.consume({
      challengeId: input.challengeId,
      purpose: PASSWORD_RESET_PURPOSE,
      secret: input.secret,
    });
    if (!result.consumed) {
      return { outcome: 'rejected' };
    }

    await this.passwords.setPassword(result.userId, input.newPassword);
    return { outcome: 'reset', userId: result.userId };
  }
}
