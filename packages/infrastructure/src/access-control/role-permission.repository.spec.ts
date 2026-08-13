import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Permission, Role } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleRolePermissionRepository } from './role-permission.repository';

// README.md section 3.8 "Roles y permisos" (the 8-row business matrix,
// source of truth for WHO gets WHAT) translated to design.md's permission
// catalog (source of truth for the exact permission strings). See migration
// 0006_access_control.sql's own header comment for the `agenda:read:any`
// interpretive decision — it has no literal README row, but is granted to
// owner/secretary as the unavoidable prerequisite of rows 1/3/4.
const EXPECTED_MATRIX: Record<Role, readonly Permission[]> = {
  owner: [
    'appointment:create',
    'appointment:update',
    'appointment:cancel',
    'appointment:mark-completed:any',
    'walkin:create',
    'barber:mark-absent',
    'client:manage',
    'barber:manage',
    'schedule:configure',
    'pricing:configure',
    'finance:read:shop',
    'agenda:read:any',
  ],
  secretary: [
    'appointment:create',
    'appointment:update',
    'appointment:cancel',
    'appointment:mark-completed:any',
    'walkin:create',
    'barber:mark-absent',
    'client:manage',
    'agenda:read:any',
  ],
  barber: ['appointment:mark-completed:own', 'finance:read:own', 'agenda:read:own'],
};

describe('role_permissions seed (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
      // Same contention allowance as the other Testcontainers suites: this
      // machine's Docker health-check status lags behind actual readiness.
      .withStartupTimeout(240_000)
      .start();

    client = postgres(container.getConnectionUri());
    db = drizzle(client);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('seeds exactly the three roles the system recognizes, nothing more', async () => {
    const rows = await client`select name from roles order by name`;
    expect(rows.map((row) => row.name)).toEqual(['barber', 'owner', 'secretary']);
  });

  it('seeds role_permissions to reflect exactly the matrix specified in README.md 3.8', async () => {
    const rows = await client`
      select r.name as role, rp.permission as permission
      from role_permissions rp
      join roles r on r.id = rp.role_id
    `;

    const actual: Record<string, string[]> = { owner: [], secretary: [], barber: [] };
    for (const row of rows) {
      actual[row.role]?.push(row.permission);
    }
    for (const role of Object.keys(actual)) {
      actual[role]?.sort();
    }

    expect(actual).toEqual({
      owner: [...EXPECTED_MATRIX.owner].sort(),
      secretary: [...EXPECTED_MATRIX.secretary].sort(),
      barber: [...EXPECTED_MATRIX.barber].sort(),
    });
  });

  it('grants a permission actually assigned to the role', async () => {
    const repo = new DrizzleRolePermissionRepository(db);

    const ownerHasShopFinance = await repo.hasPermission('owner', 'finance:read:shop');
    const barberHasOwnFinance = await repo.hasPermission('barber', 'finance:read:own');

    expect(ownerHasShopFinance).toBe(true);
    expect(barberHasOwnFinance).toBe(true);
  });

  it('denies a permission never assigned to the role — the barber cannot read shop-wide finance', async () => {
    const repo = new DrizzleRolePermissionRepository(db);

    const result = await repo.hasPermission('barber', 'finance:read:shop');

    expect(result).toBe(false);
  });

  it('denies a permission the secretary was deliberately not granted', async () => {
    const repo = new DrizzleRolePermissionRepository(db);

    const result = await repo.hasPermission('secretary', 'barber:manage');

    expect(result).toBe(false);
  });

  // access-control: "Permisos de secretaria ajustables sin cambio de
  // código" (3b.12/3b.13). Proves the widening happens by adding a row to
  // `role_permissions` — nothing else — and that the SAME repository
  // instance, constructed once before the row existed, reflects it on its
  // very next call. No re-construction, no restart, no code path other than
  // hasPermission() itself: this is the exact query PermissionsGuard already
  // runs on every request (see permissions.guard.spec.ts for the guard-level
  // half of this same proof — that the guard adds no caching of its own on
  // top of this repository).
  it('reflects a role_permissions row added after construction, on the very next call', async () => {
    const repo = new DrizzleRolePermissionRepository(db);

    const before = await repo.hasPermission('secretary', 'finance:read:shop');
    expect(before).toBe(false);

    const roleRows = await client`select id from roles where name = 'secretary'`;
    const secretaryRoleId = roleRows[0]?.id as string;
    try {
      await client`
        insert into role_permissions (role_id, permission) values (${secretaryRoleId}, 'finance:read:shop')
      `;

      const after = await repo.hasPermission('secretary', 'finance:read:shop');
      expect(after).toBe(true);
    } finally {
      // Restore the seed exactly as migration 0006 left it, so the
      // exact-matrix test above stays correct regardless of run order.
      await client`
        delete from role_permissions where role_id = ${secretaryRoleId} and permission = 'finance:read:shop'
      `;
    }
  });
});
