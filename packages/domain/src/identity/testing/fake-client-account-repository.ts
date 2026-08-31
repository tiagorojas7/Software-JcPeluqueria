import type { ClientAccount, ClientAccountRepository, CreateClientAccountInput } from '../client-account';

/** In-memory `ClientAccountRepository` test double — same role
 *  `FakeClientRepository` plays for `ClientRepository`. */
export class FakeClientAccountRepository implements ClientAccountRepository {
  private readonly byClientId = new Map<string, ClientAccount>();
  private nextId = 1;
  /** Every account actually created — a spec asserts on its LENGTH to prove
   *  a returning client did not get a second account (the collision that
   *  used to surface as a raw 500). */
  readonly created: ClientAccount[] = [];

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
    this.created.push(account);
    return account;
  }
}
