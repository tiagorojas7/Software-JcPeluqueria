import type { ActorContext, ClientContext } from '@jc-barberia/domain';

/**
 * The two fields carrying resolved identity across this app's request
 * pipeline — mutually exclusive in practice, since a session belongs to
 * either a staff user or a client, never both (see `ClientContextRepository`'s
 * own doc comment). `actor` is populated by `ActorContextMiddleware` (or left
 * undefined) before any guard runs; `client` is populated lazily, only for a
 * route that actually declares `@RequiresClientSession()`, by
 * `PermissionsGuard` itself — unlike `actor`, resolving a client session on
 * EVERY request via a global middleware would be a wasted query on every
 * staff/public route, so it happens only when the guard already knows it is
 * needed. `PermissionsGuard` and any handler needing row-level narrowing
 * (via `@CurrentActor()`/`@CurrentClient()`) read from here — one shape per
 * identity kind, written in exactly one place, never a field that could
 * drift out of sync with what actually authenticated the request.
 */
export interface RequestWithActor {
  actor?: ActorContext;
  client?: ClientContext;
}
