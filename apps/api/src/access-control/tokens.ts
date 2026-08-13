/** DI token for the `RolePermissionRepository` port — a plain interface has
 *  no runtime representation, so Nest cannot resolve it by type alone (see
 *  `PermissionsGuard`'s constructor). */
export const ROLE_PERMISSION_REPOSITORY = Symbol('ROLE_PERMISSION_REPOSITORY');

/** DI token for the `ActorContextRepository` port (see
 *  `ActorContextMiddleware`'s constructor) — same reason as above. */
export const ACTOR_CONTEXT_REPOSITORY = Symbol('ACTOR_CONTEXT_REPOSITORY');
