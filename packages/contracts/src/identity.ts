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
 * cablear-el-mvp Slice C (C.2), narrowed by fix/acceso-cliente-sin-id:
 * `challengeId` travels here for the MAGIC-LINK path only — the query string
 * of the link the client-access-code email sends
 * (`packages/infrastructure/src/notifications/templates/client-access-code.template.ts`),
 * never something a human ever types. A client typing their code by hand
 * goes through `ClientLoginByEmailRequestSchema` below instead — the shop
 * owner was explicit that the client only ever sees the code, never this id
 * ("la idea es que el cliente solo ponga el codigo").
 */
export const ClientLoginRequestSchema = z.object({
  challengeId: z.string().uuid(),
  secret: z.string().min(1, 'El código es obligatorio'),
});

export type ClientLoginRequest = z.infer<typeof ClientLoginRequestSchema>;

/**
 * fix/acceso-cliente-sin-id: what the client-facing login FORM actually
 * submits — the email typed one step earlier on the SAME screen
 * (`RequestClientAccessRequestSchema`) plus the 6-digit code, no
 * `challengeId` in sight. See `ClientLoginByEmailUseCase`'s own doc comment
 * (`packages/application/src/identity`) for how this resolves to the one
 * challenge to check the code against without ever becoming an oracle for
 * which emails are registered customers.
 */
export const ClientLoginByEmailRequestSchema = z.object({
  email: z.string().email('Email inválido'),
  secret: z.string().min(1, 'El código es obligatorio'),
});

export type ClientLoginByEmailRequest = z.infer<typeof ClientLoginByEmailRequestSchema>;

/**
 * Mirrors `ClientLoginResult['outcome']` plus the one field the USE CASE
 * itself deliberately does not return: `clientId`, resolved by the
 * controller via `ClientContextRepository` right after minting the session —
 * the same "resolve immediately after creating the session" shape
 * `AuthController.login` already established for staff, reused here rather
 * than invented twice.
 *
 * Shared by both `POST /auth/client-login` request shapes above. In
 * practice `must-request-new-code` is only ever reachable through the
 * `challengeId` (magic-link) shape — `ClientLoginByEmailUseCase` collapses
 * every dead-challenge case into `rejected` on purpose (fix/acceso-cliente-
 * sin-id, Decision 2: an email-keyed endpoint that distinguished "expired"
 * from "wrong code" would let an attacker learn which emails are
 * customers by requesting a code and waiting it out). The type stays a
 * single union because both request shapes answer through the same
 * response body.
 */
export type ClientLoginResponseBody =
  | { readonly outcome: 'authenticated'; readonly clientId: string }
  | { readonly outcome: 'rejected' }
  | { readonly outcome: 'must-request-new-code'; readonly reason: 'expired' | 'exhausted' | 'consumed' };
