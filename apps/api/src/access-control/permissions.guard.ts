import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission, Role, RolePermissionRepository } from '@jc-barberia/domain';

import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { REQUIRES_PERMISSION_KEY } from './decorators/requires-permission.decorator';
import { ROLE_PERMISSION_REPOSITORY } from './tokens';

/**
 * The seam a session-resolving guard (Phase 3b.6+, `ActorContext`) will
 * populate once it exists. Nothing sets this yet — there is no HTTP-to-session
 * wiring anywhere in this codebase — so today every `@RequiresPermission(...)`
 * handler denies by construction: no verifiable actor, no access. That is
 * the same deny-by-default posture as a missing decorator, just one layer
 * deeper, not a workaround. Deliberately just a role, not the richer
 * `ActorContext { userId, role, barberId, permissions }` design.md
 * describes for row-level narrowing — that shape, and who populates it, is
 * 3b.6+ scope.
 */
interface RequestWithActorRole {
  actorRole?: Role;
}

/**
 * Global, deny-by-default authorization guard (design.md's "Autorización:
 * permiso como unidad, rol como configuración", capa 1 — "guard global con
 * deny by default"; access-control spec, "Tres roles con aplicación en el
 * backend"). A handler is let through in exactly two cases:
 *
 * 1. It is explicitly `@Public()`.
 * 2. It declares `@RequiresPermission(permission)` AND the request's actor
 *    role currently holds that permission in `role_permissions`.
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

    const requiredPermission = this.reflector.getAllAndOverride<Permission>(REQUIRES_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermission) {
      // Deny by default: neither @RequiresPermission nor @Public() at all —
      // the exact failure mode this guard exists to close (3b.4).
      throw new ForbiddenException('This route declares no access-control decorator.');
    }

    const request = context.switchToHttp().getRequest<RequestWithActorRole>();
    if (!request.actorRole) {
      throw new ForbiddenException('No authenticated actor for this request.');
    }

    const granted = await this.rolePermissions.hasPermission(request.actorRole, requiredPermission);
    if (!granted) {
      throw new ForbiddenException(
        `Role "${request.actorRole}" lacks permission "${requiredPermission}".`,
      );
    }
    return true;
  }
}
