import type { Permission } from '../permission';
import type { Role } from '../role';
import type { RolePermissionRepository } from '../role-permission-repository';

/** In-memory `RolePermissionRepository` test double. Records every
 *  `hasPermission` call so a test can prove a caller (e.g. `PermissionsGuard`)
 *  actually consults the port per check, rather than caching or shortcutting
 *  it — the property that matters for this port (see its own doc comment). */
export class FakeRolePermissionRepository implements RolePermissionRepository {
  readonly hasPermissionCalls: Array<{ role: Role; permission: Permission }> = [];

  constructor(private readonly granted: ReadonlyMap<Role, ReadonlySet<Permission>> = new Map()) {}

  async hasPermission(role: Role, permission: Permission): Promise<boolean> {
    this.hasPermissionCalls.push({ role, permission });
    return this.granted.get(role)?.has(permission) ?? false;
  }
}
