import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FakeClientContextRepository,
  FakeClock,
  FakeRolePermissionRepository,
  type ActorContext,
  type ClientContext,
  type Permission,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { RequiresClientSession } from './decorators/requires-client-session.decorator';
import { RequiresPermission } from './decorators/requires-permission.decorator';
import { PermissionsGuard } from './permissions.guard';
import { SESSION_COOKIE_NAME } from './session-cookie';

// A throwaway clock only to build a fixed `sessionExpiresAt` fixture — never
// the one any production code reads (same pattern every other spec in this
// suite establishes for date fixtures).
const dateBuilder = new FakeClock();
const SESSION_EXPIRES_AT = dateBuilder.localTimeToUtc('2026-09-01', '12:00');

interface FakeCookieCall {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

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

  @RequiresClientSession()
  clientHandler(): void {}
}

const buildContext = (actor?: ActorContext, handler = DummyController.prototype.protectedHandler): ExecutionContext => {
  const request = actor === undefined ? {} : { actor };
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

/** Same shape `buildContext` builds, but with a real, mutable `request`
 *  object (so a test can assert `request.client` was attached by the guard)
 *  and a raw `Cookie` header — the input `@RequiresClientSession()`'s branch
 *  reads instead of a pre-attached `actor`. Also carries a fake `response`
 *  recording every `res.cookie(...)` call — cuenta-cliente-persistente: the
 *  guard re-issues the session cookie on every successful check, so a test
 *  needs somewhere to observe that. */
const buildClientSessionContext = (
  cookieHeader?: string,
): { context: ExecutionContext; request: { client?: ClientContext }; cookieCalls: FakeCookieCall[] } => {
  const request: { headers: { cookie?: string }; client?: ClientContext } = { headers: { cookie: cookieHeader } };
  const cookieCalls: FakeCookieCall[] = [];
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookieCalls.push({ name, value, options });
    },
    clearCookie: () => {},
  };
  const context = {
    getHandler: () => DummyController.prototype.clientHandler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { context, request, cookieCalls };
};

describe('PermissionsGuard — permission-check branch', () => {
  it('denies when no actor is attached to the request — no identity, no access', async () => {
    const repo = new FakeRolePermissionRepository();
    const guard = new PermissionsGuard(new Reflector(), repo, new FakeClientContextRepository());

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.hasPermissionCalls).toHaveLength(0);
  });

  it('denies when the actor role lacks the required permission, after consulting the repository', async () => {
    const repo = new FakeRolePermissionRepository(new Map([['barber', new Set<Permission>()]]));
    const guard = new PermissionsGuard(new Reflector(), repo, new FakeClientContextRepository());

    await expect(
      guard.canActivate(buildContext({ userId: 'u1', role: 'barber' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.hasPermissionCalls).toEqual([{ role: 'barber', permission: 'finance:read:shop' }]);
  });

  it('allows when the actor role holds the required permission, read fresh from the repository', async () => {
    const repo = new FakeRolePermissionRepository(
      new Map([['owner', new Set<Permission>(['finance:read:shop'])]]),
    );
    const guard = new PermissionsGuard(new Reflector(), repo, new FakeClientContextRepository());

    const result = await guard.canActivate(buildContext({ userId: 'u1', role: 'owner' }));

    expect(result).toBe(true);
    expect(repo.hasPermissionCalls).toEqual([{ role: 'owner', permission: 'finance:read:shop' }]);
  });

  it('allows when the actor holds only the SECOND of several declared permissions (ANY semantics)', async () => {
    const repo = new FakeRolePermissionRepository(
      new Map([['barber', new Set<Permission>(['agenda:read:own'])]]),
    );
    const guard = new PermissionsGuard(new Reflector(), repo, new FakeClientContextRepository());

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
    const guard = new PermissionsGuard(new Reflector(), repo, new FakeClientContextRepository());

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
    const guard = new PermissionsGuard(new Reflector(), repo, new FakeClientContextRepository());
    const context = buildContext({ userId: 'u1', role: 'secretary' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);

    repo.grant('secretary', 'finance:read:shop');

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });
});

// cablear-el-mvp Slice C (C.4): the client counterpart of the permission-check
// branch above. A client has no `role` (access-control spec, "Autenticación
// diferenciada según tipo de usuario"), so `@RequiresClientSession()` cannot
// reuse `RolePermissionRepository` — it resolves the session cookie straight
// through `ClientContextRepository` instead, still inside the SAME
// deny-by-default guard (never a second, bypassable one).
describe('PermissionsGuard — @RequiresClientSession() branch', () => {
  it('denies when the request carries no session cookie at all', async () => {
    const clientContexts = new FakeClientContextRepository();
    const guard = new PermissionsGuard(new Reflector(), new FakeRolePermissionRepository(), clientContexts);
    const { context } = buildClientSessionContext(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when the session cookie does not resolve to a client (expired, revoked, or a staff session)', async () => {
    const clientContexts = new FakeClientContextRepository();
    const guard = new PermissionsGuard(new Reflector(), new FakeRolePermissionRepository(), clientContexts);
    const { context } = buildClientSessionContext(`${SESSION_COOKIE_NAME}=not-a-client-session`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows and attaches request.client when the session cookie resolves to a client', async () => {
    const clientContexts = new FakeClientContextRepository();
    clientContexts.seed('client-session-1', { userId: 'user-1', clientId: 'client-1', sessionExpiresAt: SESSION_EXPIRES_AT });
    const guard = new PermissionsGuard(new Reflector(), new FakeRolePermissionRepository(), clientContexts);
    const { context, request } = buildClientSessionContext(`${SESSION_COOKIE_NAME}=client-session-1`);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.client).toEqual({ userId: 'user-1', clientId: 'client-1', sessionExpiresAt: SESSION_EXPIRES_AT });
  });

  it('never consults RolePermissionRepository for a @RequiresClientSession() route — the two checks are independent', async () => {
    const rolePermissions = new FakeRolePermissionRepository();
    const clientContexts = new FakeClientContextRepository();
    clientContexts.seed('client-session-1', { userId: 'user-1', clientId: 'client-1', sessionExpiresAt: SESSION_EXPIRES_AT });
    const guard = new PermissionsGuard(new Reflector(), rolePermissions, clientContexts);
    const { context } = buildClientSessionContext(`${SESSION_COOKIE_NAME}=client-session-1`);

    await guard.canActivate(context);

    expect(rolePermissions.hasPermissionCalls).toHaveLength(0);
  });

  // cuenta-cliente-persistente: the guard is the ONLY place a rolling
  // renewal reaches the browser — see `checkClientSession`'s own doc
  // comment for why the cookie is re-issued on every successful check, not
  // only when the DB row actually moved.
  it('re-issues the session cookie with the resolved sessionExpiresAt on every successful check', async () => {
    const clientContexts = new FakeClientContextRepository();
    clientContexts.seed('client-session-1', { userId: 'user-1', clientId: 'client-1', sessionExpiresAt: SESSION_EXPIRES_AT });
    const guard = new PermissionsGuard(new Reflector(), new FakeRolePermissionRepository(), clientContexts);
    const { context, cookieCalls } = buildClientSessionContext(`${SESSION_COOKIE_NAME}=client-session-1`);

    await guard.canActivate(context);

    expect(cookieCalls).toHaveLength(1);
    expect(cookieCalls[0]).toMatchObject({
      name: SESSION_COOKIE_NAME,
      value: 'client-session-1',
      options: { expires: SESSION_EXPIRES_AT, httpOnly: true, sameSite: 'lax' },
    });
  });

  it('never re-issues a cookie when the session does not resolve to a client', async () => {
    const clientContexts = new FakeClientContextRepository();
    const guard = new PermissionsGuard(new Reflector(), new FakeRolePermissionRepository(), clientContexts);
    const { context, cookieCalls } = buildClientSessionContext(`${SESSION_COOKIE_NAME}=not-a-client-session`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);

    expect(cookieCalls).toHaveLength(0);
  });
});
