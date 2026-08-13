import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeRolePermissionRepository, type Permission, type Role } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { RequiresPermission } from './decorators/requires-permission.decorator';
import { PermissionsGuard } from './permissions.guard';

// Test-only handler carrying `@RequiresPermission(...)` — exercises the
// guard's DB-backed permission-check branch in isolation, without needing
// any real HTTP/session wiring (see apps/api/test/authorization.contract.spec.ts
// for the deny-by-default and @Public() cases, proven through a real Nest
// app instead).
class DummyController {
  @RequiresPermission('finance:read:shop')
  protectedHandler(): void {}
}

const buildContext = (actorRole?: Role): ExecutionContext => {
  const request = actorRole === undefined ? {} : { actorRole };
  return {
    getHandler: () => DummyController.prototype.protectedHandler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('PermissionsGuard — permission-check branch', () => {
  it('denies when no actor role is attached to the request — no identity, no access', async () => {
    const repo = new FakeRolePermissionRepository();
    const guard = new PermissionsGuard(new Reflector(), repo);

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.hasPermissionCalls).toHaveLength(0);
  });

  it('denies when the actor role lacks the required permission, after consulting the repository', async () => {
    const repo = new FakeRolePermissionRepository(new Map([['barber', new Set<Permission>()]]));
    const guard = new PermissionsGuard(new Reflector(), repo);

    await expect(guard.canActivate(buildContext('barber'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.hasPermissionCalls).toEqual([{ role: 'barber', permission: 'finance:read:shop' }]);
  });

  it('allows when the actor role holds the required permission, read fresh from the repository', async () => {
    const repo = new FakeRolePermissionRepository(
      new Map([['owner', new Set<Permission>(['finance:read:shop'])]]),
    );
    const guard = new PermissionsGuard(new Reflector(), repo);

    const result = await guard.canActivate(buildContext('owner'));

    expect(result).toBe(true);
    expect(repo.hasPermissionCalls).toEqual([{ role: 'owner', permission: 'finance:read:shop' }]);
  });
});
