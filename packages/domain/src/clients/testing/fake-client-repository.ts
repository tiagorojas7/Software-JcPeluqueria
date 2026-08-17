import type { Client, ClientRepository, CreateClientInput } from '../client';

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
    return this.byPhone.get(phone) ?? null;
  }

  async findById(id: string): Promise<Client | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: CreateClientInput): Promise<Client> {
    const client: Client = { id: `client-${this.nextId++}`, ...input };
    this.byPhone.set(client.phone, client);
    this.byId.set(client.id, client);
    return client;
  }

  /** Test-only seam so a spec can make `findById` resolve a client it never
   *  went through `create()` for (e.g. one already seeded on an appointment). */
  seed(client: Client): void {
    this.byPhone.set(client.phone, client);
    this.byId.set(client.id, client);
  }
}
