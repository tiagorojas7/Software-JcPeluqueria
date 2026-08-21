import type { ClientAccount, ClientAccountRepository, CreateClientAccountInput } from '../client-account';

/** In-memory `ClientAccountRepository` test double — same role
 *  `FakeClientRepository` plays for `ClientRepository`. */
export class FakeClientAccountRepository implements ClientAccountRepository {
  private readonly byClientId = new Map<string, ClientAccount>();
  private nextId = 1;

  async findByClientId(clientId: string): Promise<ClientAccount | null> {
    return this.byClientId.get(clientId) ?? null;
  }

  async findByEmail(email: string): Promise<ClientAccount | null> {
    for (const account of this.byClientId.values()) {
      if (account.email === email) {
        return account;
      }
    }
    return null;
  }

  async create(input: CreateClientAccountInput): Promise<ClientAccount> {
    const account: ClientAccount = { id: `client-account-${this.nextId++}`, ...input };
    this.byClientId.set(account.clientId, account);
    return account;
  }
}
