import {
  assertValidPassword,
  type PasswordHasher,
  type UserCredentialsRepository,
} from '@jc-barberia/domain';

export type VerifyStaffPasswordResult =
  | { readonly outcome: 'valid'; readonly userId: string }
  | { readonly outcome: 'invalid' };

/**
 * Owns every path a staff plaintext password ever travels: hashing it for
 * storage (`setPassword`, used by activation and reset) and checking a login
 * attempt against the stored hash (`verify`, used by `StaffLoginUseCase`).
 * Centralizing both here means the nonexistent-user/deactivated-user
 * constant-cost guarantee only has to be built once, not once per caller.
 */
export class PasswordService {
  constructor(
    private readonly hasher: PasswordHasher,
    private readonly credentials: UserCredentialsRepository,
  ) {}

  /** Hashes and persists a new password. Used by both `ActivateStaffUseCase`
   *  (first-ever password) and `ResetPasswordUseCase` (replacing a lost
   *  one) — the plaintext is never persisted, only ever hashed here. */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    assertValidPassword(newPassword);
    const passwordHash = await this.hasher.hash(newPassword);
    await this.credentials.setPassword(userId, passwordHash);
  }

  /**
   * Looks up the user by email and verifies the password. When no active
   * user with a password matches — nonexistent email, deactivated account,
   * or a client account with no password at all — `verifyDummy` still runs
   * so the response takes comparable time either way, and every one of
   * those cases returns the exact same `{ outcome: 'invalid' }` shape.
   */
  async verify(email: string, password: string): Promise<VerifyStaffPasswordResult> {
    const user = await this.credentials.findByEmail(email);
    if (!user || !user.active || !user.passwordHash) {
      await this.hasher.verifyDummy(password);
      return { outcome: 'invalid' };
    }
    const valid = await this.hasher.verify(user.passwordHash, password);
    return valid ? { outcome: 'valid', userId: user.id } : { outcome: 'invalid' };
  }
}
