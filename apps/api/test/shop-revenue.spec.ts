import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeClock,
  FakeRolePermissionRepository,
  FakeShopRevenueRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import { CLOCK, SHOP_REVENUE_REPOSITORY } from '../src/shop/tokens';

const clock = new FakeClock();

const OWNER_SESSION = 'session-owner-shop';
const SECRETARY_SESSION = 'session-secretary-shop';
const BARBER_SESSION = 'session-barber-shop';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(SECRETARY_SESSION, { userId: 'secretary-user-id', role: 'secretary' });
actorContexts.seed(BARBER_SESSION, { userId: 'barber-user-id', role: 'barber', barberId: 'barber-1' });

// Mirrors the exact production seed (migration 0006): finance:read:shop
// reaches the owner ALONE — never the secretary, never a barber.
const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    ['owner', new Set<Permission>(['finance:read:shop'])],
    ['secretary', new Set<Permission>(['client:manage'])],
    ['barber', new Set<Permission>(['finance:read:own'])],
  ]),
);

const shopRevenueRepository = new FakeShopRevenueRepository();
shopRevenueRepository.seed([
  { appointmentId: 'a1', barberId: 'b1', barberName: 'Juan', serviceId: 's1', serviceName: 'Corte', listPriceCents: 500_000 },
  { appointmentId: 'a2', barberId: 'b2', barberName: 'Ana', serviceId: 's2', serviceName: 'Barba', listPriceCents: 300_000 },
]);

function withSession(req: request.Test, sessionId: string): request.Test {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`);
}

// docs/HUECOS-BACKEND.md #5, "«Facturación del local» no existe": no
// controller anywhere reached `finance:read:shop` before this. This suite
// proves the endpoint exists for real, is owner-only, and the response
// actually carries the breakdowns — not just a 200 with an empty body.
describe('GET /shop/revenue (App Nest levantada en memoria)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(SHOP_REVENUE_REPOSITORY)
      .useValue(shopRevenueRepository)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects an anonymous request with 403 — deny by default applies here too', async () => {
    const response = await request(app.getHttpServer()).get('/shop/revenue?from=2026-08-01&to=2026-08-31');

    expect(response.status).toBe(403);
  });

  it('MUST reject the secretary — finance:read:shop is owner-only', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/shop/revenue?from=2026-08-01&to=2026-08-31'),
      SECRETARY_SESSION,
    );

    expect(response.status).toBe(403);
  });

  it('MUST reject a barber trying to reach the shop total through their own permission', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/shop/revenue?from=2026-08-01&to=2026-08-31'),
      BARBER_SESSION,
    );

    expect(response.status).toBe(403);
  });

  it('lets the owner read the shop total with its breakdowns and the required disclaimer', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/shop/revenue?from=2026-08-01&to=2026-08-31'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body.totalListPriceCents).toBe(800_000);
    expect(response.body.count).toBe(2);
    expect(response.body.disclaimer).toMatch(/precio de lista/i);
    expect(response.body.disclaimer).toMatch(/no\b[^.]*ganancia/i);
    expect(response.body.byBarber).toEqual(
      expect.arrayContaining([
        { barberId: 'b1', barberName: 'Juan', count: 1, totalListPriceCents: 500_000 },
        { barberId: 'b2', barberName: 'Ana', count: 1, totalListPriceCents: 300_000 },
      ]),
    );
    expect(response.body.byService).toEqual(
      expect.arrayContaining([
        { serviceId: 's1', serviceName: 'Corte', count: 1, totalListPriceCents: 500_000 },
        { serviceId: 's2', serviceName: 'Barba', count: 1, totalListPriceCents: 300_000 },
      ]),
    );
  });
});
