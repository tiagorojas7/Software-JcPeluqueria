import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeRolePermissionRepository, type ActorContext, type Permission } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { RequiresPermission } from './decorators/requires-permission.decorator';
import { PermissionsGuard } from './permissions.guard';

// Test-only handlers — exercise the guard's actor-resolution and DB-backed
// permission-check branches in isolation, without needing any real
// HTTP/session wiring (see apps/api/test/authorization.contract.spec.ts for
// the deny-by-default, @Public() and end-to-end narrowing cases, proven
// through a real Nest app instead).
class DummyController {
  @RequiresPermission('finance:read:shop')
  protectedHandler(): void {}

  @RequiresPermission('agenda:read:any', 'agenda:read:own')
  eitherPermissionHandler(): void {}
}

const buildContext = (actor?: ActorContext, handler = DummyController.prototype.protectedHandler): ExecutionContext => {
  const request = actor === undefined ? {} : { actor };
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('PermissionsGuard — permission-check branch', () => {
  it('denies when no actor is attached to the request — no identity, no access', async () => {
    const repo = new FakeRolePermissionRepository();
    const guard = new PermissionsGuard(new Reflector(), repo);

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.hasPermissionCalls).toHaveLength(0);
  });

  it('denies when the actor role lacks the required permission, after consulting the repository', async () => {
    const repo = new FakeRolePermissionRepository(new Map([['barber', new Set<Permission>()]]));
    const guard = new PermissionsGuard(new Reflector(), repo);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1', role: 'barber' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.hasPermissionCalls).toEqual([{ role: 'barber', permission: 'finance:read:shop' }]);
  });

  it('allows when the actor role holds the required permission, read fresh from the repository', async () => {
    const repo = new FakeRolePermissionRepository(
      new Map([['owner', new Set<Permission>(['finance:read:shop'])]]),
    );
    const guard = new PermissionsGuard(new Reflector(), repo);

    const result = await guard.canActivate(buildContext({ userId: 'u1', role: 'owner' }));

    expect(result).toBe(true);
    expect(repo.hasPermissionCalls).toEqual([{ role: 'owner', permission: 'finance:read:shop' }]);
  });

  it('allows when the actor holds only the SECOND of several declared permissions (ANY semantics)', async () => {
    const repo = new FakeRolePermissionRepository(
      new Map([['barber', new Set<Permission>(['agenda:read:own'])]]),
    );
    const guard = new PermissionsGuard(new Reflector(), repo);

    const result = await guard.canActivate(
      buildContext({ userId: 'u1', role: 'barber' }, DummyController.prototype.eitherPermissionHandler),
    );

    expect(result).toBe(true);
    expect(repo.hasPermissionCalls).toEqual([
      { role: 'barber', permission: 'agenda:read:any' },
      { role: 'barber', permission: 'agenda:read:own' },
    ]);
  });

  it('denies when the actor holds NEITHER of several declared permissions', async () => {
    const repo = new FakeRolePermissionRepository();
    const guard = new PermissionsGuard(new Reflector(), repo);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1', role: 'barber' }, DummyController.prototype.eitherPermissionHandler)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // access-control: "Permisos de secretaria ajustables sin cambio de
  // código" (3b.12/3b.13) — the guard-level half of this proof.
  // role-permission.repository.spec.ts proves the REPOSITORY re-reads
  // role_permissions on every call; this proves the GUARD adds no caching
  // of its own on top of that repository. Same guard instance, same
  // repository instance, no re-construction between the two checks — only
  // `.grant()` (the fake's equivalent of "insert a row") happens in
  // between.
  it('reflects a permission granted to the repository after construction, on the guard’s very next check', async () => {
    const repo = new FakeRolePermissionRepository();
    const guard = new PermissionsGuard(new Reflector(), repo);
    const context = buildContext({ userId: 'u1', role: 'secretary' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);

    repo.grant('secretary', 'finance:read:shop');

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });
});
