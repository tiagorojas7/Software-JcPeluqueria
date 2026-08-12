import type { Barber, BarberRepository } from '@jc-barberia/domain';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { barbers } from '../db/schema/availability';

export class DrizzleBarberRepository implements BarberRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async create(barber: Barber): Promise<void> {
    await this.db.insert(barbers).values(barber);
  }

  async findById(id: string): Promise<Barber | null> {
    const rows = await this.db.select().from(barbers).where(eq(barbers.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async list(): Promise<Barber[]> {
    return this.db.select().from(barbers);
  }
}
