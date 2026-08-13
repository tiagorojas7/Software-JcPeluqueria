import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@jc-barberia/domain';

export const REQUIRES_PERMISSION_KEY = 'access-control:requires-permission';

/**
 * Declares the exact permission `PermissionsGuard` must find granted (via
 * `role_permissions`, read fresh on every request) to the requesting
 * actor's role before this handler runs.
 */
export const RequiresPermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_PERMISSION_KEY, permission);
