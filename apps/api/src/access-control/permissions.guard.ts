import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission, RolePermissionRepository } from '@jc-barberia/domain';

import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { REQUIRES_PERMISSION_KEY } from './decorators/requires-permission.decorator';
import type { RequestWithActor } from './request-with-actor';
import { ROLE_PERMISSION_REPOSITORY } from './tokens';

/**
 * Global, deny-by-default authorization guard (design.md's "Autorización:
 * permiso como unidad, rol como configuración", capa 1 — "guard global con
 * deny by default"; access-control spec, "Tres roles con aplicación en el
 * backend"). A handler is let through in exactly two cases:
 *
 * 1. It is explicitly `@Public()`.
 * 2. It declares `@RequiresPermission(...permissions)` AND the request's
 *    resolved actor holds AT LEAST ONE of those permissions in
 *    `role_permissions`, checked fresh on every request.
 *
 * Every other handler — including one that simply forgot both decorators —
 * is rejected with 403. That is the whole point: forgetting the decorator
 * must fail closed, never open.
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(REQUIRES_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions || requiredPermissions.length === 0) {
      // Deny by default: neither @RequiresPermission nor @Public() at all —
      // the exact failure mode this guard exists to close (3b.4).
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
}
