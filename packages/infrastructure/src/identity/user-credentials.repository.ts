import type { UserCredentials, UserCredentialsRepository } from '@jc-barberia/domain';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { users } from '../db/schema/identity';

export class DrizzleUserCredentialsRepository implements UserCredentialsRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findByEmail(email: string): Promise<UserCredentials | null> {
    const rows = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash, active: users.active })
      .from(users)
      .where(eq(users.email, email));
    return rows[0] ?? null;
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, passwordChangedAt: sql`now()` })
      .where(eq(users.id, userId));
  }
}
