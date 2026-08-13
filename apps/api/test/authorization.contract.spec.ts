import type { INestApplication } from '@nestjs/common';
import { Controller, ForbiddenException, Get, Inject, Module, Param } from '@nestjs/common';
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
import { Public } from '../src/access-control/decorators/public.decorator';
import { RequiresPermission } from '../src/access-control/decorators/requires-permission.decorator';
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
}

@Module({
  controllers: [ThreatMatrixController],
  providers: [{ provide: AGENDA_REPOSITORY, useValue: agendaRepository }],
})
class ThreatMatrixFixtureModule {}

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
});
