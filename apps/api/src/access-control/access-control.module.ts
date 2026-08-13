import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { db, DrizzleActorContextRepository, DrizzleRolePermissionRepository } from '@jc-barberia/infrastructure';

import { ActorContextMiddleware } from './actor-context.middleware';
import { PermissionsGuard } from './permissions.guard';
import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from './tokens';

/**
 * Wires `PermissionsGuard` as the application-wide guard (`APP_GUARD`),
 * binds `RolePermissionRepository`/`ActorContextRepository` to their real,
 * Postgres-backed adapters, and runs `ActorContextMiddleware` ahead of every
 * route so the guard always sees a resolved (or absent) `request.actor`.
 * Importing this module is what makes deny-by-default apply to every
 * controller the application will ever gain — a handler added in a later
 * phase is denied from the moment it exists, not from the moment someone
 * remembers to decorate it.
 */
@Module({
  providers: [
    {
      provide: ROLE_PERMISSION_REPOSITORY,
      useFactory: () => new DrizzleRolePermissionRepository(db),
    },
    {
      provide: ACTOR_CONTEXT_REPOSITORY,
      useFactory: () => new DrizzleActorContextRepository(db),
    },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AccessControlModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActorContextMiddleware).forRoutes('*');
  }
}
