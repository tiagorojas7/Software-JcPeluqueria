import { Client, ClientRepository, type CreateClientInput } from '@jc-barberia/domain';

export class ClientNotFoundError extends Error {
  constructor(readonly phone: string) {
    super(`No client found with phone "${phone}"`);
    this.name = 'ClientNotFoundError';
  }
}

export interface ClientListItem {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly age: number | null;
}

export interface ClientUseCase {
  list(): Promise<ClientListItem[]>;
  create(input: CreateClientInput): Promise<Client>;
}

export class DrizzleClientUseCase implements ClientUseCase {
  constructor(private readonly clients: ClientRepository) {}

  async list(): Promise<ClientListItem[]> {
    const all = await this.clients.list();
    return all.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      age: c.age,
    }));
  }

  async create(input: CreateClientInput): Promise<Client> {
    return this.clients.create(input);
  }
}