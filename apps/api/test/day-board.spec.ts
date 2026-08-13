import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeClock,
  FakeDayBoardRepository,
  FakeRolePermissionRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import { DAY_BOARD_REPOSITORY } from '../src/agenda/tokens';

/** Builds fixed instants from shop wall-clock time — `Date` may not be constructed directly. */
const clock = new FakeClock();

const OWNER_SESSION = 'session-owner';
const BARBER_A_SESSION = 'session-barber-a';
const BARBER_A_ID = 'aaaaaaaa-1111-4000-8000-000000000001';
const BARBER_B_ID = 'bbbbbbbb-2222-4000-8000-000000000002';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(BARBER_A_SESSION, { userId: 'barber-a-user-id', role: 'barber', barberId: BARBER_A_ID });

const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    [
      'owner',
      new Set<Permission>(['appointment:update', 'appointment:cancel', 'appointment:mark-completed:any', 'agenda:read:any']),
    ],
    ['barber', new Set<Permission>(['appointment:mark-completed:own', 'agenda:read:own'])],
  ]),
);

const dayBoardRepository = new FakeDayBoardRepository();
dayBoardRepository.seed('2026-08-20', {
  columns: [
    { barberId: BARBER_A_ID, barberName: 'Juan' },
    { barberId: BARBER_B_ID, barberName: 'Ana' },
  ],
  slots: [
    {
      id: 'slot-a1',
      barberId: BARBER_A_ID,
      serviceId: 'service-1',
      clientId: null,
      status: 'reservado',
      startsAt: clock.localTimeToUtc('2026-08-20', '09:00'),
      endsAt: clock.localTimeToUtc('2026-08-20', '09:30'),
    },
    {
      id: 'slot-b1',
      barberId: BARBER_B_ID,
      serviceId: 'service-1',
      clientId: null,
      status: 'reservado',
      startsAt: clock.localTimeToUtc('2026-08-20', '10:00'),
      endsAt: clock.localTimeToUtc('2026-08-20', '10:30'),
    },
  ],
});

function withSession(req: request.Test, sessionId?: string): request.Test {
  return sessionId ? req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`) : req;
}

// The day board's real, production endpoint (task 8.3/8.4) — unlike
// authorization.contract.spec.ts's ThreatMatrixController, this exercises
// AgendaModule as it will actually ship, wired into the real AppModule.
describe('GET /agenda/day-board (App Nest levantada en memoria)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(DAY_BOARD_REPOSITORY)
      .useValue(dayBoardRepository)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects an anonymous request with 403 — deny by default applies to this endpoint too', async () => {
    const response = await request(app.getHttpServer()).get('/agenda/day-board?date=2026-08-20');

    expect(response.status).toBe(403);
  });

  it('returns every barber column, with edit/cancel/mark-completed allowed on every slot, for the owner', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/agenda/day-board?date=2026-08-20'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body.columns).toEqual([
      { barberId: BARBER_A_ID, barberName: 'Juan' },
      { barberId: BARBER_B_ID, barberName: 'Ana' },
    ]);
    expect(response.body.slots).toEqual([
      expect.objectContaining({ id: 'slot-a1', allowedActions: ['edit', 'cancel', 'mark-completed'] }),
      expect.objectContaining({ id: 'slot-b1', allowedActions: ['edit', 'cancel', 'mark-completed'] }),
    ]);
  });

  it("narrows to only the barber's own column and slot, with only mark-completed allowed — access-control threat matrix (task 8.7)", async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/agenda/day-board?date=2026-08-20'),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body.columns).toEqual([{ barberId: BARBER_A_ID, barberName: 'Juan' }]);
    expect(response.body.slots).toEqual([
      expect.objectContaining({ id: 'slot-a1', allowedActions: ['mark-completed'] }),
    ]);
  });
});
