import type { Role } from '../../access-control/role';
import type { CreateStaffAccountInput, StaffAccount, StaffAccountRepository } from '../staff-account';

/** In-memory `StaffAccountRepository` test double — same role
 *  `FakeClientAccountRepository` plays for `ClientAccountRepository`. */
export class FakeStaffAccountRepository implements StaffAccountRepository {
  private readonly byId = new Map<string, StaffAccount>();
  private readonly otherEmails = new Set<string>();
  private nextId = 1;

  async findByBarberId(barberId: string): Promise<StaffAccount | null> {
    for (const account of this.byId.values()) {
      if (account.barberId === barberId) {
        return account;
      }
    }
    return null;
  }

  async findByEmail(email: string): Promise<StaffAccount | null> {
    for (const account of this.byId.values()) {
      if (account.email === email) {
        return account;
      }
    }
    return null;
  }

  async findById(userId: string): Promise<StaffAccount | null> {
    return this.byId.get(userId) ?? null;
  }

  async isEmailInUse(email: string): Promise<boolean> {
    if (this.otherEmails.has(email)) {
      return true;
    }
    return (await this.findByEmail(email)) !== null;
  }

  /** Test-only: a `users` row that is NOT a staff account — a client
   *  account — already holding this address. Stands in for the half of the
   *  UNIQUE constraint that `listByRole`/`findByEmail` cannot see. */
  seedNonStaffEmail(email: string): void {
    this.otherEmails.add(email);
  }

  async listByRole(role: Role): Promise<StaffAccount[]> {
    return [...this.byId.values()].filter((account) => account.role === role);
  }

  async create(input: CreateStaffAccountInput): Promise<StaffAccount> {
    const account: StaffAccount = { id: `staff-account-${this.nextId++}`, ...input, active: true, activated: false };
    this.byId.set(account.id, account);
    return account;
  }

  async setActive(userId: string, active: boolean): Promise<boolean> {
    const account = this.byId.get(userId);
    if (!account) {
      return false;
    }
    this.byId.set(userId, { ...account, active });
    return true;
  }

  /** Test-only: stands in for the staff member having completed activation,
   *  which in production is `PasswordService.setPassword` writing the hash
   *  through the OTHER port — never this one. */
  markActivated(userId: string): void {
    const account = this.byId.get(userId);
    if (account) {
      this.byId.set(userId, { ...account, activated: true });
    }
  }
}
