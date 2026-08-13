import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakeRolePermissionRepository } from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Public } from '../src/access-control/decorators/public.decorator';
import { ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { AppModule } from '../src/app.module';

// Test-only controller, mounted only inside this spec's testing module —
// never registered on the real AppModule. Exercises PermissionsGuard's
// deny-by-default behaviour through a real, in-memory Nest application: the
// "App Nest levantada en memoria" harness this phase's delivery table
// names. Real business endpoints belong to phases 8/9/10, not here.
@Controller('threat-matrix')
class ThreatMatrixController {
  // Deliberately carries neither @RequiresPermission nor @Public() — the
  // exact shape task 3b.4 (matriz de amenazas) requires: a future developer
  // who adds a handler and forgets the decorator must get 403, not an open
  // endpoint.
  @Get('undecorated')
  undecorated(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('public')
  publicRoute(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [ThreatMatrixController] })
class ThreatMatrixFixtureModule {}

describe('authorization contract — deny by default (App Nest levantada en memoria)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ThreatMatrixFixtureModule],
    })
      // No real database in this harness — the DB-backed permission-check
      // branch is proven separately (packages/infrastructure's Testcontainers
      // suite and this app's own permissions.guard.spec.ts unit test).
      // This spec proves only the Nest wiring: the guard is genuinely global
      // and genuinely denies by default.
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(new FakeRolePermissionRepository())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a handler carrying neither @RequiresPermission nor @Public() with 403', async () => {
    const response = await request(app.getHttpServer()).get('/threat-matrix/undecorated');

    expect(response.status).toBe(403);
  });

  it('allows a handler explicitly marked @Public(), proving the guard does not blanket-deny', async () => {
    const response = await request(app.getHttpServer()).get('/threat-matrix/public');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
