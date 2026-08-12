import type { PasswordHasher } from '../password-hasher';

/**
 * Deterministic `PasswordHasher` test double — the same role `FakeClock`
 * plays for `Clock`. Round-trips predictably (`hash` then `verify` with the
 * SAME password always matches) without paying real argon2id cost, so
 * application-layer tests stay fast. Every call is recorded, so a test can
 * assert exactly which path (`verify` vs `verifyDummy`) production code
 * took — the entire point of `PasswordService`'s nonexistent-user branch.
 */
export class FakePasswordHasher implements PasswordHasher {
  readonly hashCalls: string[] = [];
  readonly verifyCalls: { hash: string; password: string }[] = [];
  readonly verifyDummyCalls: string[] = [];

  async hash(password: string): Promise<string> {
    this.hashCalls.push(password);
    return `fake-hash:${password}`;
  }

  async verify(hash: string, password: string): Promise<boolean> {
    this.verifyCalls.push({ hash, password });
    return hash === `fake-hash:${password}`;
  }

  async verifyDummy(password: string): Promise<boolean> {
    this.verifyDummyCalls.push(password);
    return false;
  }
}
