/** DI token for the `RolePermissionRepository` port — a plain interface has
 *  no runtime representation, so Nest cannot resolve it by type alone (see
 *  `PermissionsGuard`'s constructor). */
export const ROLE_PERMISSION_REPOSITORY = Symbol('ROLE_PERMISSION_REPOSITORY');

/** DI token for the `ActorContextRepository` port (see
 *  `ActorContextMiddleware`'s constructor) — same reason as above. */
export const ACTOR_CONTEXT_REPOSITORY = Symbol('ACTOR_CONTEXT_REPOSITORY');

/** DI token for the `ClientContextRepository` port (see `PermissionsGuard`'s
 *  `@RequiresClientSession()` branch) — same reason as above. */
export const CLIENT_CONTEXT_REPOSITORY = Symbol('CLIENT_CONTEXT_REPOSITORY');

/** DI token for the `Clock` port. `DrizzleClientContextRepository` needs it
 *  to parse the raw timestamp `db.execute()` hands back for the rolling
 *  client-session renewal (cuenta-cliente-persistente) — its OWN instance,
 *  not `identity/tokens.ts`'s `CLOCK`, per this app's one-token-per-module
 *  rule. */
export const CLOCK = Symbol('CLOCK');
