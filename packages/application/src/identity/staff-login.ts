import type { PasswordService } from './password-service';

export interface StaffLoginInput {
  readonly email: string;
  readonly password: string;
}

export type StaffLoginResult =
  | { readonly outcome: 'authenticated'; readonly userId: string }
  | { readonly outcome: 'rejected' };

/**
 * Authenticates staff (owner, secretary, barber) with email + password —
 * the counterpart to `ClientLoginUseCase`'s passwordless challenge, same
 * thinness: every timing/enumeration guarantee is `PasswordService.verify`'s
 * responsibility, this only maps its outcome.
 * → access-control: Autenticación diferenciada según tipo de usuario
 *   (staff scenario).
 */
export class StaffLoginUseCase {
  constructor(private readonly passwords: PasswordService) {}

  async execute(input: StaffLoginInput): Promise<StaffLoginResult> {
    const result = await this.passwords.verify(input.email, input.password);
    if (result.outcome !== 'valid') {
      return { outcome: 'rejected' };
    }
    return { outcome: 'authenticated', userId: result.userId };
  }
}
