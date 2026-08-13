import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { db, DrizzleRolePermissionRepository } from '@jc-barberia/infrastructure';

import { PermissionsGuard } from './permissions.guard';
import { ROLE_PERMISSION_REPOSITORY } from './tokens';

/**
 * Wires `PermissionsGuard` as the application-wide guard (`APP_GUARD`) and
 * binds the `RolePermissionRepository` port to its real, Postgres-backed
 * adapter. Importing this module is what makes deny-by-default apply to
 * every controller the application will ever gain — a handler added in a
 * later phase is denied from the moment it exists, not from the moment
 * someone remembers to decorate it.
 */
@Module({
  providers: [
    {
      provide: ROLE_PERMISSION_REPOSITORY,
      useFactory: () => new DrizzleRolePermissionRepository(db),
    },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AccessControlModule {}
