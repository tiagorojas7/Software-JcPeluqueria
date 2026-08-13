import type { ActorContext } from '@jc-barberia/domain';

/**
 * The single field carrying resolved identity across this app's request
 * pipeline. `ActorContextMiddleware` populates it (or leaves it undefined,
 * for an anonymous request or a session that didn't resolve) before any
 * guard runs; `PermissionsGuard` and any handler needing row-level
 * narrowing (via `@CurrentActor()`) read it from here — one shape, written
 * in exactly one place, never two overlapping fields that could drift out
 * of sync.
 */
export interface RequestWithActor {
  actor?: ActorContext;
}
