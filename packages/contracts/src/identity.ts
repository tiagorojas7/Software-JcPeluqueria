import { z } from 'zod';

/**
 * Wire contract for the staff login entrypoint (`apps/api/src/identity`).
 * `StaffLoginUseCase` and `SessionService` were both built and tested in
 * Phase 3a, but no HTTP route ever turned them into a reachable endpoint —
 * this is the arranque slice's addition, not one of the 40 tracked
 * requirements, so there is no spec file this schema traces back to. Kept
 * to the exact same shape/idiom every other contract in this package uses.
 */
export const StaffLoginRequestSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});

export type StaffLoginRequest = z.infer<typeof StaffLoginRequestSchema>;

/**
 * Outcome-discriminated body, same idiom `CheckoutResponseBody` already
 * established (design.md precedent: a rejected login is an ordinary branch
 * the browser handles, never a raw 401 the frontend has to special-case).
 * `role`/`barberId` come straight from `ActorContext` — never re-derived —
 * so the web app can route to the right screen immediately after login.
 */
export type StaffLoginResponseBody =
  | {
      readonly outcome: 'authenticated';
      readonly userId: string;
      readonly role: 'owner' | 'secretary' | 'barber';
      readonly barberId: string | null;
    }
  | { readonly outcome: 'rejected' };
