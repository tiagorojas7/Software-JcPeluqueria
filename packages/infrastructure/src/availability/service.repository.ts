import type { Service, ServiceRepository } from '@jc-barberia/domain';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { services } from '../db/schema/availability';

export class DrizzleServiceRepository implements ServiceRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async create(service: Service): Promise<void> {
    await this.db.insert(services).values(service);
  }

  async findById(id: string): Promise<Service | null> {
    const rows = await this.db.select().from(services).where(eq(services.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async list(): Promise<Service[]> {
    return this.db.select().from(services);
  }
}
