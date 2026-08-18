import { SetMetadata } from '@nestjs/common';

export const REQUIRES_CLIENT_SESSION_KEY = 'access-control:requires-client-session';

/**
 * The client counterpart of `@RequiresPermission(...)` — declares that a
 * handler needs an authenticated CLIENT session (`ClientContextRepository`,
 * `users.client_id`), never a staff `ActorContext`/role. A client is not in
 * the roles matrix (access-control spec, "Autenticación diferenciada según
 * tipo de usuario"), so `@RequiresPermission` structurally cannot express
 * this: `PermissionsGuard` checks `actor.role` against `role_permissions`,
 * and a client session never resolves an `ActorContext` at all (see
 * `ClientContextRepository`'s own doc comment).
 *
 * Still enforced by the SAME global, deny-by-default `PermissionsGuard` —
 * this is a third explicit route classification alongside `@Public()` and
 * `@RequiresPermission(...)`, not a second, bypassable guard. A handler
 * carrying none of the three is still rejected with 403 (cablear-el-mvp,
 * Slice C: "el guard es deny-by-default y un handler pelado es un 403
 * muerto").
 */
export const RequiresClientSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_CLIENT_SESSION_KEY, true);
