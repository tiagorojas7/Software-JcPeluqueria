import type { Role } from '../access-control/role';

/**
 * A staff `users` row — the one with `roleId` set, and `barberId` set too
 * when the role is `'barber'`. The mirror image of `ClientAccount`: same
 * table, opposite half of the identity model.
 *
 * Notice what is missing here, exactly as in `ClientAccount`: no
 * `passwordHash`, no password parameter, nothing a caller could use to
 * write a credential. Staff DO have passwords, but the only seam in this
 * codebase that may ever write one stays `UserCredentialsRepository.
 * setPassword`, reached solely through `PasswordService` — the owner
 * creating an account structurally cannot set, read or choose the password
 * that account will end up with.
 */
export interface StaffAccount {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  /** The barber this account belongs to; `null` for owner/secretary. */
  readonly barberId: string | null;
  /** `false` once the owner revokes the account — the person keeps existing
   *  as a `Barber`, they just stop being able to get in. */
  readonly active: boolean;
  /**
   * Whether the staff member ever completed activation, i.e. whether
   * `users.password_hash` is set. Derived, never stored twice: an invited
   * account that nobody activated yet is exactly a staff row with no hash,
   * and that is the ONE thing the owner's screen has to be able to see
   * without ever seeing the credential itself.
   */
  readonly activated: boolean;
}

export interface CreateStaffAccountInput {
  readonly email: string;
  readonly role: Role;
  readonly barberId: string | null;
}

export interface StaffAccountRepository {
  /** The account attached to a barber, if the owner already created one —
   *  the find-or-create half that keeps a second alta from producing a
   *  second account for the same person. */
  findByBarberId(barberId: string): Promise<StaffAccount | null>;

  /** The STAFF account with this email, if any. Scoped to staff on purpose —
   *  a client account is not a staff account and must not be returned as
   *  one. Use `isEmailInUse` to answer "can this email be claimed", which is
   *  a different, wider question. */
  findByEmail(email: string): Promise<StaffAccount | null>;

  /**
   * Whether ANY `users` row already claims this email — staff or client.
   *
   * `users.email` carries a single UNIQUE constraint across the whole table,
   * so "is this email free" can never be answered by looking at staff rows
   * alone. It was, and inviting a barber whose address already existed as a
   * CLIENT account passed the check and then died on the constraint with a
   * 23505 — the owner saw a 500 instead of "ese email ya está en uso".
   */
  isEmailInUse(email: string): Promise<boolean>;

  findById(userId: string): Promise<StaffAccount | null>;

  /** Every barber account, activated or not — the owner's screen shows both
   *  states, since "invited and never activated" is precisely the case that
   *  needs chasing. */
  listByRole(role: Role): Promise<StaffAccount[]>;

  create(input: CreateStaffAccountInput): Promise<StaffAccount>;

  /** `false` when no account has this id. */
  setActive(userId: string, active: boolean): Promise<boolean>;
}
