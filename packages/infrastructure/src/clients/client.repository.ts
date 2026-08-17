import type { Client, ClientRepository, CreateClientInput } from '@jc-barberia/domain';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { clients } from '../db/schema/clients';

export class DrizzleClientRepository implements ClientRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findByPhone(phone: string): Promise<Client | null> {
    const rows = await this.db.select().from(clients).where(eq(clients.phone, phone)).limit(1);
    return rows[0] ?? null;
  }

  async list(): Promise<Client[]> {
    return this.db.select().from(clients);
  }

  async create(input: CreateClientInput): Promise<Client> {
    const rows = await this.db.insert(clients).values(input).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('Insert into "clients" returned no row');
    }
    return created;
  }
}
