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

/**
 * cuenta-cliente-persistente: the email-only input `RequestClientAccessUseCase`
 * needs. A web booking always captures the client's email
 * (`ConfirmReservationRequestSchema`) and creates the passwordless account at
 * that exact moment, so the email the client just typed is the reliable key
 * — never phone, which was the original (now superseded) key for this
 * endpoint (see the use case's own doc comment for why phone does not cover
 * this flow).
 */
export const RequestClientAccessRequestSchema = z.object({
  email: z.string().email('Email inválido'),
});

export type RequestClientAccessRequest = z.infer<typeof RequestClientAccessRequestSchema>;

/**
 * A single, outcome-invariant shape (client-booking spec, "Código de acceso
 * vencido" + `RequestClientAccessUseCase`'s own doc comment): whether the
 * email is on file, and whether it belongs to a client who completed web
 * registration, must never be observable from this response.
 */
export interface RequestClientAccessResponseBody {
  readonly outcome: 'requested';
}

/**
 * cablear-el-mvp Slice C (C.2): `challengeId` travels here because the
 * client's access link/code always carries it (see
 * `RequestClientAccessUseCase`'s own doc comment on why) — never a bare
 * 6-digit code alone, which could not disambiguate between two outstanding
 * challenges.
 */
export const ClientLoginRequestSchema = z.object({
  challengeId: z.string().uuid(),
  secret: z.string().min(1, 'El código es obligatorio'),
});

export type ClientLoginRequest = z.infer<typeof ClientLoginRequestSchema>;

/**
 * Mirrors `ClientLoginResult['outcome']` plus the one field the USE CASE
 * itself deliberately does not return: `clientId`, resolved by the
 * controller via `ClientContextRepository` right after minting the session —
 * the same "resolve immediately after creating the session" shape
 * `AuthController.login` already established for staff, reused here rather
 * than invented twice.
 */
export type ClientLoginResponseBody =
  | { readonly outcome: 'authenticated'; readonly clientId: string }
  | { readonly outcome: 'rejected' }
  | { readonly outcome: 'must-request-new-code'; readonly reason: 'expired' | 'exhausted' | 'consumed' };
