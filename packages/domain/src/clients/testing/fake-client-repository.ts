import type { Client, ClientRepository, CreateClientInput } from '../client';
import { phoneKey } from '../phone-key';

/**
 * In-memory `ClientRepository` test double — same role `FakeHoldRepository`
 * plays for `HoldRepository`. Real uniqueness/lookup semantics only exist
 * against PostgreSQL (see `DrizzleClientRepository`'s Testcontainers suite);
 * this fake only has to support the two application-layer flows that
 * consume it: find-or-create.
 */
export class FakeClientRepository implements ClientRepository {
  private readonly byPhone = new Map<string, Client>();
  private readonly byId = new Map<string, Client>();
  private nextId = 1;

  async findByPhone(phone: string): Promise<Client | null> {
    return this.byPhone.get(phoneKey(phone)) ?? null;
  }

  async findByEmail(email: string): Promise<Client | null> {
    const wanted = email.trim().toLowerCase();
    for (const client of this.byId.values()) {
      if (client.email && client.email.toLowerCase() === wanted) {
        return client;
      }
    }
    return null;
  }

  async findById(id: string): Promise<Client | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: CreateClientInput): Promise<Client> {
    const client: Client = { id: `client-${this.nextId++}`, ...input };
    this.byPhone.set(phoneKey(client.phone), client);
    this.byId.set(client.id, client);
    return client;
  }

  async list(): Promise<Client[]> {
    return [...this.byPhone.values()];
  }

  /** Test-only seam so a spec can make `findById` resolve a client it never
   *  went through `create()` for (e.g. one already seeded on an appointment). */
  seed(client: Client): void {
    this.byPhone.set(phoneKey(client.phone), client);
    this.byId.set(client.id, client);
  }
}
