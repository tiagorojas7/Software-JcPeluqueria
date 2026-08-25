import type { CreateStaffAccountInput, Role, StaffAccount, StaffAccountRepository } from '@jc-barberia/domain';
import { and, eq, isNotNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { roles } from '../db/schema/access-control';
import { users } from '../db/schema/identity';

/**
 * A staff account IS a `users` row with `role_id` set — the mirror image of
 * `DrizzleClientAccountRepository`, which is the same row with `client_id`
 * set instead. The join to `roles` is what turns the stored `role_id` into
 * the `Role` name the domain speaks in; the seed in migration
 * `0006_access_control.sql` is the one place those three rows come from, so
 * `create()` looks the id up by name rather than carrying a hardcoded uuid.
 *
 * `password_hash` is READ here — as the boolean `activated`, "did this
 * person ever finish activation" — and never written. Writing it stays
 * `DrizzleUserCredentialsRepository.setPassword`, the single seam
 * `PasswordService` reaches; this file has no `set`/`insert` touching that
 * column at all, which is what makes "el dueño controla la cuenta, nunca la
 * contraseña" structural rather than a convention.
 */
export class DrizzleStaffAccountRepository implements StaffAccountRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findByBarberId(barberId: string): Promise<StaffAccount | null> {
    return this.selectOne(eq(users.barberId, barberId));
  }

  /** `users.email` is UNIQUE, so at most one row ever matches.
   *  `role_id IS NOT NULL` excludes a CLIENT account sharing the address —
   *  the mirror of the `client_id IS NOT NULL` guard its sibling applies. */
  async findByEmail(email: string): Promise<StaffAccount | null> {
    return this.selectOne(eq(users.email, email));
  }

  async findById(userId: string): Promise<StaffAccount | null> {
    return this.selectOne(eq(users.id, userId));
  }

  /**
   * Deliberately NOT joined to `roles` — this is the only query in this file
   * that asks about the `users` table as a whole, because it answers a
   * question about the whole table: `users.email` is UNIQUE across staff and
   * client rows alike. Joining here would reproduce the bug it exists to
   * prevent (a client's address passing the check and dying on 23505).
   */
  async isEmailInUse(email: string): Promise<boolean> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return rows.length > 0;
  }

  async listByRole(role: Role): Promise<StaffAccount[]> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        role: roles.name,
        barberId: users.barberId,
        active: users.active,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(roles.name, role))
      .orderBy(users.email);
    return rows.map((row) => toStaffAccount(row));
  }

  async create(input: CreateStaffAccountInput): Promise<StaffAccount> {
    const roleRows = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.name, input.role));
    const roleRow = roleRows[0];
    if (!roleRow) {
      throw new Error(`No existe el rol "${input.role}" (lo siembra 0006_access_control.sql)`);
    }

    const rows = await this.db
      .insert(users)
      .values({ email: input.email, roleId: roleRow.id, barberId: input.barberId })
      .returning({
        id: users.id,
        email: users.email,
        barberId: users.barberId,
        active: users.active,
        passwordHash: users.passwordHash,
      });
    const created = rows[0];
    if (!created) {
      throw new Error('Insert into "users" for a staff account returned no row');
    }
    return toStaffAccount({ ...created, role: input.role });
  }

  async setActive(userId: string, active: boolean): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({ active })
      .where(and(eq(users.id, userId), isNotNull(users.roleId)))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  private async selectOne(condition: SQL): Promise<StaffAccount | null> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        role: roles.name,
        barberId: users.barberId,
        active: users.active,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(condition);
    const row = rows[0];
    return row ? toStaffAccount(row) : null;
  }
}

interface StaffRow {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly barberId: string | null;
  readonly active: boolean;
  readonly passwordHash: string | null;
}

/** `activated` is derived from the hash's PRESENCE, never from its value —
 *  the credential itself never leaves this function. */
function toStaffAccount(row: StaffRow): StaffAccount {
  return {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    barberId: row.barberId,
    active: row.active,
    activated: row.passwordHash !== null,
  };
}
