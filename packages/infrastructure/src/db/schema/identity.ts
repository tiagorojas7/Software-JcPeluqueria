import { boolean, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { roles } from './access-control';
import { barbers } from './availability';

/**
 * Identity model. `client_id` carries no foreign key yet — `clients`
 * (Phase 9/10) doesn't exist yet, the same deferred-FK pattern
 * `slot_occupancies.client_id`/`deposit_id` used in Phase 2. `barber_id`
 * and (as of migration 0006, Phase 3b) `role_id` DO get their FK now that
 * `barbers`/`roles` exist.
 *
 * `password_hash`/`password_changed_at` (added in migration 0005, Phase 3a
 * staff sub-slice) are `NULL` for clients — clients never have a password,
 * see `access-control`'s differentiated-authentication requirement. Only
 * `PasswordService` ever writes `password_hash`, and always as an
 * already-hashed argon2id value — the plaintext never reaches this column.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  roleId: uuid('role_id').references(() => roles.id),
  barberId: uuid('barber_id').references(() => barbers.id),
  clientId: uuid('client_id'),
  active: boolean('active').notNull().default(true),
  passwordHash: varchar('password_hash', { length: 255 }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
});

/**
 * A one-time passwordless credential. `purpose` is `client_login` today;
 * `staff_activation`/`staff_password_reset` reuse this exact table and
 * mechanism starting Phase 3a's later tasks — declaring the full set now
 * costs nothing and keeps the column honest about the table's real shape.
 *
 * `code_hash`/`token_hash` are always both populated: the 6-digit code and
 * the magic-link token are two different secrets derived from the SAME row,
 * and either one consumes it (see `DrizzleAuthChallengeRepository.consume`).
 * Only the SHA-256 hash of each is ever written here — the plaintext exists
 * solely in `ChallengeService.issue()`'s return value, long enough to reach
 * whichever channel delivers it, and is never persisted.
 */
export const authChallenges = pgTable('auth_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  purpose: varchar('purpose', { length: 30 }).notNull(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
});

/**
 * Schema only in this phase — session issuance, differentiated TTLs and
 * revocation are tasks 3a.16-3a.19, a later slice. `id` is the opaque value
 * the session cookie carries (never a JWT — see design.md).
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});
