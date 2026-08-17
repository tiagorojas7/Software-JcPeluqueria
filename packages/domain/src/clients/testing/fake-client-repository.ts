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
  private nextId = 1;

  async findByPhone(phone: string): Promise<Client | null> {
    return this.byPhone.get(phone) ?? null;
  }

  async create(input: CreateClientInput): Promise<Client> {
    const client: Client = { id: `client-${this.nextId++}`, ...input };
    this.byPhone.set(client.phone, client);
    return client;
  }

  async list(): Promise<Client[]> {
    return [...this.byPhone.values()];
  }
}
