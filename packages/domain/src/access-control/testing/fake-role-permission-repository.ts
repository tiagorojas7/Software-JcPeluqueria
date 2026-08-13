import type { Permission } from '../permission';
import type { Role } from '../role';
import type { RolePermissionRepository } from '../role-permission-repository';

/** In-memory `RolePermissionRepository` test double. Records every
 *  `hasPermission` call so a test can prove a caller (e.g. `PermissionsGuard`)
 *  actually consults the port per check, rather than caching or shortcutting
 *  it — the property that matters for this port (see its own doc comment). */
export class FakeRolePermissionRepository implements RolePermissionRepository {
  readonly hasPermissionCalls: Array<{ role: Role; permission: Permission }> = [];
  private readonly granted: Map<Role, Set<Permission>>;

  constructor(granted: ReadonlyMap<Role, ReadonlySet<Permission>> = new Map()) {
    // Deep-copied into an owned, mutable structure so `.grant()` below never
    // mutates a map some other test still holds a reference to.
    this.granted = new Map([...granted].map(([role, permissions]) => [role, new Set(permissions)]));
  }

  async hasPermission(role: Role, permission: Permission): Promise<boolean> {
    this.hasPermissionCalls.push({ role, permission });
    return this.granted.get(role)?.has(permission) ?? false;
  }

  /** Mutates the in-memory grant table after construction — the fake's
   *  equivalent of "adding a row to role_permissions". Exists so a test can
   *  prove a caller (`PermissionsGuard`) re-reads this port on every call
   *  rather than snapshotting it once at construction time (access-control
   *  spec, "Permisos de secretaria ajustables sin cambio de código"). */
  grant(role: Role, permission: Permission): void {
    const permissions = this.granted.get(role) ?? new Set<Permission>();
    permissions.add(permission);
    this.granted.set(role, permissions);
  }
}
