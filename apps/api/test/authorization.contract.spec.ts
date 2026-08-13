import type { INestApplication } from '@nestjs/common';
import { Controller, ForbiddenException, Get, Inject, Module, Param } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeAgendaRepository,
  FakeRolePermissionRepository,
  type ActorContext,
  type AgendaRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CurrentActor } from '../src/access-control/decorators/current-actor.decorator';
import { IS_PUBLIC_KEY, Public } from '../src/access-control/decorators/public.decorator';
import {
  REQUIRES_PERMISSION_KEY,
  RequiresPermission,
} from '../src/access-control/decorators/requires-permission.decorator';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { AppModule } from '../src/app.module';

// Test-fixture-only DI token: AgendaRepository has no real production
// controller yet (that starts phases 8/11) — see ThreatMatrixController's
// own doc comment.
const AGENDA_REPOSITORY = Symbol('AGENDA_REPOSITORY (threat-matrix fixture only)');

// Fixed session ids and barber ids, seeded once below and reused across
// every describe block in this file — including the route × role matrix
// (3b.10) later in the file.
const OWNER_SESSION = 'session-owner';
const SECRETARY_SESSION = 'session-secretary';
const BARBER_A_SESSION = 'session-barber-a';
const BARBER_B_SESSION = 'session-barber-b';
const BARBER_A_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const BARBER_B_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(SECRETARY_SESSION, { userId: 'secretary-user-id', role: 'secretary' });
actorContexts.seed(BARBER_A_SESSION, { userId: 'barber-a-user-id', role: 'barber', barberId: BARBER_A_ID });
actorContexts.seed(BARBER_B_SESSION, { userId: 'barber-b-user-id', role: 'barber', barberId: BARBER_B_ID });

const agendaRepository = new FakeAgendaRepository();
agendaRepository.seed(BARBER_A_ID, [{ barberId: BARBER_A_ID, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }]);
agendaRepository.seed(BARBER_B_ID, [{ barberId: BARBER_B_ID, dayOfWeek: 2, opensAt: '10:00', closesAt: '19:00' }]);

// The exact subset of the real README/migration-0006 seed matrix these
// fixture routes exercise (owner: agenda:read:any + finance:read:shop;
// secretary: agenda:read:any only; barber: agenda:read:own only) — see
// role-permission.repository.spec.ts for the full 23-row matrix this
// mirrors. Kept as a named const (not inline) because 3b.12/3b.13 need to
// `.grant()` onto this exact instance later in this file.
const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    ['owner', new Set<Permission>(['agenda:read:any', 'finance:read:shop'])],
    ['secretary', new Set<Permission>(['agenda:read:any'])],
    ['barber', new Set<Permission>(['agenda:read:own'])],
  ]),
);

/** `Cookie: session_id=...` for a given fixture session, or no cookie at
 *  all for an anonymous request. */
function withSession(req: request.Test, sessionId?: string): request.Test {
  return sessionId ? req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`) : req;
}

// Test-only controller, mounted only inside this spec's testing module —
// never registered on the real AppModule. Exercises PermissionsGuard's
// deny-by-default behaviour, ActorContext resolution and repository-level
// narrowing through a real, in-memory Nest application: the "App Nest
// levantada en memoria" harness this phase's delivery table names. Real
// business endpoints belong to phases 8/9/10, not here — these routes are
// seams wide enough to exercise the access-control contract honestly, kept
// deliberately thin otherwise.
@Controller('threat-matrix')
class ThreatMatrixController {
  constructor(@Inject(AGENDA_REPOSITORY) private readonly agenda: AgendaRepository) {}

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

  // access-control: "El barbero queda acotado a sus propios datos". Owner
  // and secretary hold agenda:read:any (any barber id); a barber holds only
  // agenda:read:own. @RequiresPermission lets a request through when the
  // actor's role holds EITHER permission — that is only the coarse layer.
  // The fine layer (does THIS barberId belong to THIS actor) is
  // AgendaRepository's job, never this handler's: it never inspects
  // `result` beyond the discriminant, so it can never "fetch, then hide".
  @RequiresPermission('agenda:read:any', 'agenda:read:own')
  @Get('barbers/:barberId/schedule')
  async schedule(@Param('barberId') barberId: string, @CurrentActor() actor: ActorContext) {
    const result = await this.agenda.findScheduleFor(barberId, actor);
    if (result.outcome === 'forbidden') {
      throw new ForbiddenException(`Actor is not entitled to barber "${barberId}"'s schedule.`);
    }
    return result.schedule;
  }

  // access-control: shop-wide billing has no row-level narrowing to apply —
  // unlike the schedule route above, `finance:read:shop` is not
  // id-parameterized, so the coarse guard check alone is the whole
  // authorization decision (design.md: "Facturación del local y del
  // barbero son dos read models distintos, no el mismo filtrado"). No real
  // financial data exists yet (Phase 5) — this stays a thin seam.
  @RequiresPermission('finance:read:shop')
  @Get('finance/shop')
  shopBilling(): { scope: 'shop' } {
    return { scope: 'shop' };
  }
}

@Module({
  controllers: [ThreatMatrixController],
  providers: [{ provide: AGENDA_REPOSITORY, useValue: agendaRepository }],
})
class ThreatMatrixFixtureModule {}

type RouteId = 'undecorated' | 'public' | 'schedule' | 'financeShop';

// The single source of truth tying every handler method that exists on
// ThreatMatrixController to a row in the matrix below (3b.10). Deliberately
// hand-maintained rather than derived by reflection: the completeness check
// just below compares this AGAINST `Object.getOwnPropertyNames` of the
// controller's own prototype, so a handler added here without a
// corresponding method (or vice versa) fails immediately — that mismatch is
// the whole point of 3b.10, not an implementation detail to hide. It caught
// exactly that gap once already in this same file: `schedule` and
// `shopBilling` (3b.6/3b.8) were added to the controller before this map
// knew about them, and the completeness check below failed until both were
// added here too.
const ROUTE_ID_TO_HANDLER_NAME: Record<RouteId, string> = {
  undecorated: 'undecorated',
  public: 'publicRoute',
  schedule: 'schedule',
  financeShop: 'shopBilling',
};

describe('authorization contract — deny by default (App Nest levantada en memoria)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ThreatMatrixFixtureModule],
    })
      // No real database in this harness — the DB-backed permission-check
      // and actor-resolution branches are proven separately
      // (packages/infrastructure's Testcontainers suites and this app's own
      // permissions.guard.spec.ts unit test). This spec proves only the
      // Nest wiring: the guard is genuinely global, genuinely denies by
      // default, and genuinely resolves+narrows by actor end to end.
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
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

  it('lets a barber read their own schedule', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get(`/threat-matrix/barbers/${BARBER_A_ID}/schedule`),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ barberId: BARBER_A_ID, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }]);
  });

  it('rejects a barber requesting a colleague’s schedule by id with 403 — access-control threat matrix (3b.6)', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get(`/threat-matrix/barbers/${BARBER_B_ID}/schedule`),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(403);
  });

  it('lets the owner read the shop’s billing', async () => {
    const response = await withSession(request(app.getHttpServer()).get('/threat-matrix/finance/shop'), OWNER_SESSION);

    expect(response.status).toBe(200);
  });

  it('rejects a barber requesting the shop’s billing with 403 — access-control threat matrix (3b.8)', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/threat-matrix/finance/shop'),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(403);
  });

  // access-control: "Matriz de permisos por rol" (3b.10/3b.11) — this is
  // what turns the deny-by-default guard from a claim into a guarantee.
  // `ROUTE_ID_TO_HANDLER_NAME` is the declared-routes catalog; the
  // completeness check below fails the moment a handler method exists on
  // ThreatMatrixController without a matching entry there, regardless of
  // whether that new handler carries a decorator or not.
  describe('route × role contract — completeness', () => {
    it('accounts for every handler method declared on ThreatMatrixController', () => {
      const declaredMethods = new Set(
        Object.getOwnPropertyNames(ThreatMatrixController.prototype).filter((name) => name !== 'constructor'),
      );
      const coveredMethods = new Set(Object.values(ROUTE_ID_TO_HANDLER_NAME));

      expect(coveredMethods).toEqual(declaredMethods);
    });

    it('every catalogued route other than "undecorated" declares @Public() or @RequiresPermission(...)', () => {
      const reflector = new Reflector();
      const handlersByName = ThreatMatrixController.prototype as unknown as Record<string, () => unknown>;

      for (const [routeId, methodName] of Object.entries(ROUTE_ID_TO_HANDLER_NAME)) {
        const handler = handlersByName[methodName];
        if (!handler) {
          throw new Error(`ThreatMatrixController has no method named "${methodName}" (check ROUTE_ID_TO_HANDLER_NAME).`);
        }
        const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
        const requiredPermissions = reflector.get<Permission[]>(REQUIRES_PERMISSION_KEY, handler);

        if (routeId === 'undecorated') {
          expect(isPublic).toBeUndefined();
          expect(requiredPermissions).toBeUndefined();
        } else {
          expect(isPublic === true || (Array.isArray(requiredPermissions) && requiredPermissions.length > 0)).toBe(
            true,
          );
        }
      }
    });
  });

  interface MatrixCase {
    readonly routeId: RouteId;
    readonly description: string;
    readonly path: string;
    readonly session: string | undefined;
    readonly expectedStatus: number;
  }

  const routeAccessMatrix: readonly MatrixCase[] = [
    // undecorated — deny-by-default, regardless of role or anonymity
    { routeId: 'undecorated', description: 'owner', path: '/threat-matrix/undecorated', session: OWNER_SESSION, expectedStatus: 403 },
    { routeId: 'undecorated', description: 'secretary', path: '/threat-matrix/undecorated', session: SECRETARY_SESSION, expectedStatus: 403 },
    { routeId: 'undecorated', description: 'barber', path: '/threat-matrix/undecorated', session: BARBER_A_SESSION, expectedStatus: 403 },
    { routeId: 'undecorated', description: 'anonymous', path: '/threat-matrix/undecorated', session: undefined, expectedStatus: 403 },

    // public — @Public(), always allowed
    { routeId: 'public', description: 'owner', path: '/threat-matrix/public', session: OWNER_SESSION, expectedStatus: 200 },
    { routeId: 'public', description: 'secretary', path: '/threat-matrix/public', session: SECRETARY_SESSION, expectedStatus: 200 },
    { routeId: 'public', description: 'barber', path: '/threat-matrix/public', session: BARBER_A_SESSION, expectedStatus: 200 },
    { routeId: 'public', description: 'anonymous', path: '/threat-matrix/public', session: undefined, expectedStatus: 200 },

    // schedule — agenda:read:any (owner/secretary, any barber) or
    // agenda:read:own (barber, own id only — access-control threat matrix 3b.6)
    { routeId: 'schedule', description: 'owner, any barber', path: `/threat-matrix/barbers/${BARBER_A_ID}/schedule`, session: OWNER_SESSION, expectedStatus: 200 },
    { routeId: 'schedule', description: 'secretary, any barber', path: `/threat-matrix/barbers/${BARBER_B_ID}/schedule`, session: SECRETARY_SESSION, expectedStatus: 200 },
    { routeId: 'schedule', description: 'barber, own schedule', path: `/threat-matrix/barbers/${BARBER_A_ID}/schedule`, session: BARBER_A_SESSION, expectedStatus: 200 },
    { routeId: 'schedule', description: 'barber, colleague’s schedule', path: `/threat-matrix/barbers/${BARBER_B_ID}/schedule`, session: BARBER_A_SESSION, expectedStatus: 403 },
    { routeId: 'schedule', description: 'anonymous', path: `/threat-matrix/barbers/${BARBER_A_ID}/schedule`, session: undefined, expectedStatus: 403 },

    // financeShop — finance:read:shop, owner only (access-control threat matrix 3b.8)
    { routeId: 'financeShop', description: 'owner', path: '/threat-matrix/finance/shop', session: OWNER_SESSION, expectedStatus: 200 },
    { routeId: 'financeShop', description: 'secretary', path: '/threat-matrix/finance/shop', session: SECRETARY_SESSION, expectedStatus: 403 },
    { routeId: 'financeShop', description: 'barber', path: '/threat-matrix/finance/shop', session: BARBER_A_SESSION, expectedStatus: 403 },
    { routeId: 'financeShop', description: 'anonymous', path: '/threat-matrix/finance/shop', session: undefined, expectedStatus: 403 },
  ];

  describe.each(routeAccessMatrix)('route × role matrix — $routeId ($description)', (testCase) => {
    it(`returns ${testCase.expectedStatus}`, async () => {
      const response = await withSession(request(app.getHttpServer()).get(testCase.path), testCase.session);

      expect(response.status).toBe(testCase.expectedStatus);
    });
  });
});
