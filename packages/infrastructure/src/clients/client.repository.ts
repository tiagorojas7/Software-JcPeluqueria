import { phoneKey, type Client, type ClientRepository, type CreateClientInput } from '@jc-barberia/domain';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { clients } from '../db/schema/clients';

export class DrizzleClientRepository implements ClientRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  /**
   * Compares the phone's NORMALISED form, not the stored string: the same
   * number typed "351 506-9498", "+54 351 5069498" or "0351 15 5069498"
   * used to produce a different client every time. The stored value stays
   * exactly as the person typed it — normalisation decides matching, never
   * what is shown back to them.
   *
   * `regexp_replace(phone, '\D', '', 'g')` strips the punctuation in SQL so
   * the comparison happens in the database instead of pulling every client
   * into memory; the remaining Argentine prefixes (54 / leading 0 / mobile
   * 15) are stripped on both sides by `phoneKey`, which is why the candidate
   * set is narrowed by the last 8 digits first — enough to be selective,
   * short enough to survive every prefix variant.
   */
  async findByPhone(phone: string): Promise<Client | null> {
    const key = phoneKey(phone);
    if (!key) {
      return null;
    }
    const tail = key.slice(-8);
    const candidates = await this.db
      .select()
      .from(clients)
      .where(sql`regexp_replace(${clients.phone}, '\D', '', 'g') LIKE ${'%' + tail}`);
    return candidates.find((candidate) => phoneKey(candidate.phone) === key) ?? null;
  }

  /** The client who already claimed this email. Case-insensitive because
   *  `emailField` normalises on the way in but rows created before it
   *  existed may still carry mixed case. */
  async findByEmail(email: string): Promise<Client | null> {
    const wanted = email.trim().toLowerCase();
    if (!wanted) {
      return null;
    }
    const rows = await this.db
      .select()
      .from(clients)
      .where(sql`lower(${clients.email}) = ${wanted}`)
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<Client | null> {
    const rows = await this.db.select().from(clients).where(eq(clients.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async create(input: CreateClientInput): Promise<Client> {
    const rows = await this.db.insert(clients).values(input).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('Insert into "clients" returned no row');
    }
    return created;
  }

  async list(): Promise<Client[]> {
    return this.db.select().from(clients);
  }
}
