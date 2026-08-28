import type { CreateStaffAccountInput, Role, StaffAccount, StaffAccountRepository } from '@jc-barberia/domain';
import { and, eq, isNotNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { roles } from '../db/schema/access-control';
import { clientAbsences } from '../db/schema/client-absences';
import { authChallenges, sessions, users } from '../db/schema/identity';
import { slotOccupancies } from '../db/schema/slot-occupancy';

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

  /**
   * One transaction, and the ORDER of its statements is the whole point —
   * see `deleteStaffAccountRows` below, which does the actual work. Split
   * out so `DrizzleBarberRepository.delete()` can run the exact same
   * statements as ONE step of its OWN larger transaction (barber deletion
   * needs the staff account gone before the barber row itself, atomically —
   * see that method's own doc comment) instead of nesting a second,
   * independent transaction inside the first.
   */
  async deleteAccount(userId: string): Promise<boolean> {
    return this.db.transaction((tx) => deleteStaffAccountRows(tx, userId));
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

/** Whatever `db.transaction`'s callback hands back, or `db` itself — this
 *  function only ever `.update()`s/`.delete()`s, so it does not need the
 *  full query-builder surface, just the two methods it actually calls. That
 *  narrow a type is what lets `DrizzleBarberRepository.delete()` pass its
 *  OWN transaction handle here without either file importing the other's
 *  concrete transaction type. */
type DeletableDb = Pick<PostgresJsDatabase, 'update' | 'delete'>;

/**
 * The actual work `deleteAccount` does, factored out so it can run as one
 * step of a LARGER transaction instead of always opening its own.
 *
 * Five tables reference `users`, and they fall into two groups. Sessions
 * and auth challenges ARE the access — they die with the account. The
 * other three (the turnos this person created, the turnos they marked, the
 * ausencias they confirmed) are the SHOP's records: they must survive the
 * account, so their reference is released rather than the row deleted.
 * That is the trade the owner accepts when choosing to delete — the turno
 * stays in the agenda, minus the "who did it".
 *
 * Without that release the `DELETE` dies on a foreign key in the single
 * most common case there is: a barber who actually worked.
 */
export async function deleteStaffAccountRows(tx: DeletableDb, userId: string): Promise<boolean> {
  // The shop's own history: keep the record, drop the attribution.
  await tx
    .update(slotOccupancies)
    .set({ createdByUserId: null })
    .where(eq(slotOccupancies.createdByUserId, userId));
  await tx
    .update(slotOccupancies)
    .set({ markedByUserId: null })
    .where(eq(slotOccupancies.markedByUserId, userId));
  await tx
    .update(clientAbsences)
    .set({ confirmedByUserId: null })
    .where(eq(clientAbsences.confirmedByUserId, userId));

  // The access itself: goes with the account.
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(authChallenges).where(eq(authChallenges.userId, userId));

  // `isNotNull(roleId)` keeps this from ever reaching a CLIENT account —
  // same guard every other write in this staff-scoped repository uses.
  const deleted = await tx
    .delete(users)
    .where(and(eq(users.id, userId), isNotNull(users.roleId)))
    .returning({ id: users.id });
  return deleted.length > 0;
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
