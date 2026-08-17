import type { ClientAccount, ClientAccountRepository, CreateClientAccountInput } from '@jc-barberia/domain';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { users } from '../db/schema/identity';

/**
 * A passwordless client account IS a `users` row with `client_id` set and
 * `password_hash` left `NULL` — no separate table. `create()` never sets
 * `password_hash`, `role_id` or `barber_id`: those three columns simply
 * never appear in this file, the same structural absence
 * `ClientAccountRepository`'s own doc comment describes.
 */
export class DrizzleClientAccountRepository implements ClientAccountRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findByClientId(clientId: string): Promise<ClientAccount | null> {
    const rows = await this.db
      .select({ id: users.id, clientId: users.clientId, email: users.email })
      .from(users)
      .where(eq(users.clientId, clientId));
    const row = rows[0];
    if (!row || !row.clientId) {
      return null;
    }
    return { id: row.id, clientId: row.clientId, email: row.email };
  }

  async create(input: CreateClientAccountInput): Promise<ClientAccount> {
    const rows = await this.db
      .insert(users)
      .values({ email: input.email, clientId: input.clientId })
      .returning({ id: users.id, clientId: users.clientId, email: users.email });
    const created = rows[0];
    if (!created || !created.clientId) {
      throw new Error('Insert into "users" for a client account returned no row');
    }
    return { id: created.id, clientId: created.clientId, email: created.email };
  }
}
