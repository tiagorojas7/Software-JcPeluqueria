import type { UserCredentials, UserCredentialsRepository } from '../user-credentials';

export interface FakeUser extends UserCredentials {
  readonly email: string;
}

/**
 * In-memory `UserCredentialsRepository` test double — the same role
 * `FakeAuthChallengeRepository` plays for `AuthChallengeRepository`. Tests
 * seed users directly (there is no `CreateUserUseCase` in this slice; see
 * `packages/infrastructure` Testcontainers specs for how real rows get
 * created via raw SQL instead).
 */
export class FakeUserCredentialsRepository implements UserCredentialsRepository {
  readonly setPasswordCalls: { userId: string; passwordHash: string }[] = [];
  private readonly users = new Map<string, FakeUser>();

  seed(user: FakeUser): void {
    this.users.set(user.id, user);
  }

  async findByEmail(email: string): Promise<UserCredentials | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    this.setPasswordCalls.push({ userId, passwordHash });
    const existing = this.users.get(userId);
    if (existing) {
      this.users.set(userId, { ...existing, passwordHash });
    }
  }
}
