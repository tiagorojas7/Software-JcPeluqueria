import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeBarberPerformanceRepository,
  FakeClock,
  FakeRolePermissionRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import { BARBER_PERFORMANCE_REPOSITORY, CLOCK } from '../src/barbers/tokens';

const clock = new FakeClock();

const OWNER_SESSION = 'session-owner-perf';
const BARBER_A_SESSION = 'session-barber-a-perf';
const BARBER_A_ID = 'aaaaaaaa-1111-4000-8000-0000000000c1';
const BARBER_B_ID = 'bbbbbbbb-2222-4000-8000-0000000000c2';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(BARBER_A_SESSION, { userId: 'barber-a-user-id', role: 'barber', barberId: BARBER_A_ID });

// Mirrors the exact production seed (migration 0006): owner holds
// finance:read:shop/agenda:read:any, never the :own variants; barber holds
// only the :own variants. Task 11.10's whole point is that swapping either
// pair must not accidentally grant access.
const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    ['owner', new Set<Permission>(['finance:read:shop', 'agenda:read:any'])],
    ['barber', new Set<Permission>(['finance:read:own', 'agenda:read:own'])],
  ]),
);

const performanceRepository = new FakeBarberPerformanceRepository();
performanceRepository.seed(BARBER_A_ID, [{ appointmentId: 'a1', serviceId: 'svc-1', listPriceCents: 500_000 }]);
performanceRepository.seed(BARBER_B_ID, [{ appointmentId: 'b1', serviceId: 'svc-1', listPriceCents: 300_000 }]);

function withSession(req: request.Test, sessionId: string): request.Test {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`);
}

// barber-profile spec, "Facturación teórica por precio de lista":
//
//   Scenario: Barbero no accede a la facturación del local
//     GIVEN un barbero autenticado
//     WHEN intenta consultar la facturación total del local o la de otro barbero
//     THEN el sistema MUST rechazar el acceso
//
// Task 11.10: "confirmar el guard de permiso finance:read:own vs
// finance:read:shop" — this is the assertion that the two permissions are
// genuinely distinct, not just two names for the same access.
describe('GET /barbers/:barberId/revenue|stats — barber-profile guard (11.9/11.10)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(BARBER_PERFORMANCE_REPOSITORY)
      .useValue(performanceRepository)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('lets a barber read their own revenue, with the required disclaimer', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get(`/barbers/${BARBER_A_ID}/revenue?from=2026-08-01&to=2026-08-31`),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body.totalListPriceCents).toBe(500_000);
    expect(response.body.disclaimer).toMatch(/precio de lista/i);
  });

  it("rejects a barber requesting a colleague's revenue with 403 — \"la de otro barbero\"", async () => {
    const response = await withSession(
      request(app.getHttpServer()).get(`/barbers/${BARBER_B_ID}/revenue?from=2026-08-01&to=2026-08-31`),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(403);
  });

  it('rejects the owner (finance:read:shop, not finance:read:own) with 403 — the two permissions are not interchangeable', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get(`/barbers/${BARBER_A_ID}/revenue?from=2026-08-01&to=2026-08-31`),
      OWNER_SESSION,
    );

    expect(response.status).toBe(403);
  });

  it('rejects an anonymous request with 403 — deny by default applies to this endpoint too', async () => {
    const response = await request(app.getHttpServer()).get(`/barbers/${BARBER_A_ID}/revenue?from=2026-08-01&to=2026-08-31`);

    expect(response.status).toBe(403);
  });

  it("lets a barber read their own stats count, and rejects a colleague's", async () => {
    const own = await withSession(
      request(app.getHttpServer()).get(`/barbers/${BARBER_A_ID}/stats?from=2026-08-01&to=2026-08-31`),
      BARBER_A_SESSION,
    );
    expect(own.status).toBe(200);
    expect(own.body.count).toBe(1);

    const colleague = await withSession(
      request(app.getHttpServer()).get(`/barbers/${BARBER_B_ID}/stats?from=2026-08-01&to=2026-08-31`),
      BARBER_A_SESSION,
    );
    expect(colleague.status).toBe(403);
  });
});
