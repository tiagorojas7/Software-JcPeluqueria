import type { Permission } from './permission';
import type { Role } from './role';

/**
 * `PermissionsGuard`'s only source of truth for "does this role have this
 * permission". Deliberately a per-call read, never a hardcoded map compiled
 * into the binary: rows in `role_permissions` ARE the authority, so the
 * owner can widen the secretary's permissions by editing a row — never by
 * shipping code (see access-control spec, "Permisos de secretaria
 * ajustables sin cambio de código"; the guard reading this on every request,
 * rather than caching it, is wired end-to-end in a later slice, 3b.13).
 */
export interface RolePermissionRepository {
  hasPermission(role: Role, permission: Permission): Promise<boolean>;
}
