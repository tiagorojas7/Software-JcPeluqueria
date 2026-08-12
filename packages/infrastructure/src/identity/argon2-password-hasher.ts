import type { PasswordHasher } from '@jc-barberia/domain';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * OWASP Password Storage Cheat Sheet's second recommended argon2id option:
 * m=19456 KiB (19 MiB), t=2, p=1. design.md pins this exact option
 * deliberately — not the highest-memory option — because it is the one
 * meant for services that cannot dedicate 46+ MiB per concurrent login.
 */
const OWASP_ARGON2ID_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

/** Never a real user's password — exists solely so `verifyDummy()` has a
 *  valid, fixed hash to run a real argon2id verification against. Nothing
 *  about this string is ever exposed through `PasswordHasher`'s public API. */
const DUMMY_PASSWORD_FOR_COST_EQUALIZATION = 'never-a-real-user-password-just-pays-argon2-cost';

export class Argon2PasswordHasher implements PasswordHasher {
  private dummyHashPromise: Promise<string> | null = null;

  async hash(password: string): Promise<string> {
    return hash(password, OWASP_ARGON2ID_OPTIONS);
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    return verify(storedHash, password);
  }

  async verifyDummy(password: string): Promise<boolean> {
    const dummyHash = await this.getDummyHash();
    // Discard the result on purpose: verifyDummy has no real user to
    // authenticate, so it must always report failure regardless of what
    // verify() against the fixed dummy hash happens to return.
    await this.verify(dummyHash, password);
    return false;
  }

  private getDummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = this.hash(DUMMY_PASSWORD_FOR_COST_EQUALIZATION);
    }
    return this.dummyHashPromise;
  }
}
