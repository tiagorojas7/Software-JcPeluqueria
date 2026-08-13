import type { Permission, Role, RolePermissionRepository } from '@jc-barberia/domain';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { rolePermissions, roles } from '../db/schema/access-control';

export class DrizzleRolePermissionRepository implements RolePermissionRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  /** One query per call, straight against `role_permissions` joined to
   *  `roles` — deliberately never cached in memory. Rows in that table are
   *  the authority (see the port's own doc comment): a row the owner adds
   *  or removes must take effect on the very next request. */
  async hasPermission(role: Role, permission: Permission): Promise<boolean> {
    const rows = await this.db
      .select({ id: rolePermissions.id })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .where(and(eq(roles.name, role), eq(rolePermissions.permission, permission)))
      .limit(1);
    return rows.length > 0;
  }
}
