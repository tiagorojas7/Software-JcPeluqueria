import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@jc-barberia/domain';

export const REQUIRES_PERMISSION_KEY = 'access-control:requires-permission';

/**
 * Declares the permission(s) `PermissionsGuard` checks (via
 * `role_permissions`, read fresh on every request) before this handler
 * runs. The actor's role must hold AT LEAST ONE of the listed permissions —
 * most routes need exactly one, but a route like "read a barber's
 * schedule" is legitimately reachable by two different permissions
 * (`agenda:read:any` for owner/secretary, `agenda:read:own` for the barber
 * themselves), each with a different row-level scope the repository layer
 * narrows afterwards (see access-control spec, "El barbero queda acotado a
 * sus propios datos"). The tuple type requires at least one argument —
 * `@RequiresPermission()` with zero permissions does not compile.
 */
export const RequiresPermission = (
  ...permissions: [Permission, ...Permission[]]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRES_PERMISSION_KEY, permissions);
