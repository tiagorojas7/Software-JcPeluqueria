import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ClientContextRepository, Permission, RolePermissionRepository } from '@jc-barberia/domain';

import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { REQUIRES_CLIENT_SESSION_KEY } from './decorators/requires-client-session.decorator';
import { REQUIRES_PERMISSION_KEY } from './decorators/requires-permission.decorator';
import type { RequestWithActor } from './request-with-actor';
import { readSessionCookie, writeSessionCookie, type CookieResponse } from './session-cookie';
import { CLIENT_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from './tokens';

interface MinimalRequestWithCookie extends RequestWithActor {
  readonly headers: { readonly cookie?: string };
}

/**
 * Global, deny-by-default authorization guard (design.md's "Autorización:
 * permiso como unidad, rol como configuración", capa 1 — "guard global con
 * deny by default"; access-control spec, "Tres roles con aplicación en el
 * backend"). A handler is let through in exactly three cases:
 *
 * 1. It is explicitly `@Public()`.
 * 2. It declares `@RequiresClientSession()` AND the request's session cookie
 *    resolves to a `ClientContext` — the client counterpart of case 3, for
 *    the population access-control never governs by role (a client has no
 *    `role`, see `ClientContextRepository`'s own doc comment). Resolved
 *    LAZILY, here, only for a route that actually declares it — unlike
 *    `ActorContext`, resolving a client session on every single request via
 *    a global middleware would be a wasted query on every staff/public
 *    route.
 * 3. It declares `@RequiresPermission(...permissions)` AND the request's
 *    resolved actor holds AT LEAST ONE of those permissions in
 *    `role_permissions`, checked fresh on every request.
 *
 * Every other handler — including one that simply forgot all three
 * decorators — is rejected with 403. That is the whole point: forgetting
 * the decorator must fail closed, never open.
 *
 * Metadata is read handler-first then class-level (`getAllAndOverride`),
 * Nest's own convention: a method-level decorator overrides its class's.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ROLE_PERMISSION_REPOSITORY)
    private readonly rolePermissions: RolePermissionRepository,
    @Inject(CLIENT_CONTEXT_REPOSITORY)
    private readonly clientContexts: ClientContextRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiresClientSession = this.reflector.getAllAndOverride<boolean>(REQUIRES_CLIENT_SESSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresClientSession) {
      return this.checkClientSession(context);
    }

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(REQUIRES_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions || requiredPermissions.length === 0) {
      // Deny by default: none of @RequiresClientSession, @RequiresPermission
      // or @Public() at all — the exact failure mode this guard exists to
      // close (3b.4).
      throw new ForbiddenException('This route declares no access-control decorator.');
    }

    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = request.actor;
    if (!actor) {
      throw new ForbiddenException('No authenticated actor for this request.');
    }

    // ANY of the declared permissions suffices — see RequiresPermission's
    // own doc comment on why a route may legitimately be reachable through
    // more than one permission (e.g. agenda:read:any vs agenda:read:own).
    // This is still only the coarse layer: which specific rows the actor
    // may see within an "allowed" role is the repository's job, informed
    // by the same `actor` a handler reads via @CurrentActor().
    const grants = await Promise.all(
      requiredPermissions.map((permission) => this.rolePermissions.hasPermission(actor.role, permission)),
    );
    if (!grants.some(Boolean)) {
      throw new ForbiddenException(
        `Role "${actor.role}" lacks permission "${requiredPermissions.join('" / "')}".`,
      );
    }
    return true;
  }

  /**
   * cablear-el-mvp Slice C: resolves the session cookie straight through
   * `ClientContextRepository` — never `RolePermissionRepository`, a client
   * is not in the roles matrix. Attaches the resolved `ClientContext` onto
   * `request.client` on success, the same seam `@CurrentClient()` reads
   * (mirrors `ActorContextMiddleware` attaching `request.actor`, just
   * resolved lazily here instead of on every request).
   *
   * cuenta-cliente-persistente: `resolveBySessionId` may have just renewed
   * this session (see its own doc comment for the half-life rule) — this is
   * the ONLY place that decision reaches the browser, so the cookie is
   * re-issued with `client.sessionExpiresAt` on EVERY successful check, not
   * only when a renewal happened. That is deliberately cheap: writing the
   * response header costs nothing extra (no DB access here), while skipping
   * it on the "no renewal" branch would risk a stale cookie surviving a
   * renewal this method decided NOT to report. The actual Postgres write
   * already only happens conditionally, inside the repository's query.
   */
  private async checkClientSession(context: ExecutionContext): Promise<boolean> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<MinimalRequestWithCookie>();
    const sessionId = readSessionCookie(request.headers.cookie);
    if (!sessionId) {
      throw new ForbiddenException('No authenticated client session for this request.');
    }
    const client = await this.clientContexts.resolveBySessionId(sessionId);
    if (!client) {
      throw new ForbiddenException('No authenticated client session for this request.');
    }
    request.client = client;
    writeSessionCookie(httpContext.getResponse<CookieResponse>(), sessionId, client.sessionExpiresAt);
    return true;
  }
}
