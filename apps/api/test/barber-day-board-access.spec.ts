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

const clock = new FakeClock();

const BARBER_A_SESSION = 'session-barber-a-profile';
const BARBER_A_ID = 'aaaaaaaa-1111-4000-8000-0000000000a1';
const BARBER_B_ID = 'bbbbbbbb-2222-4000-8000-0000000000b1';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(BARBER_A_SESSION, { userId: 'barber-a-user-id', role: 'barber', barberId: BARBER_A_ID });

const rolePermissions = new FakeRolePermissionRepository(
  new Map([['barber', new Set<Permission>(['appointment:mark-completed:own', 'agenda:read:own'])]]),
);

const dayBoardRepository = new FakeDayBoardRepository();
dayBoardRepository.seed('2026-08-21', {
  columns: [
    { barberId: BARBER_A_ID, barberName: 'Juan' },
    { barberId: BARBER_B_ID, barberName: 'Ana' },
  ],
  slots: [
    {
      id: 'slot-a1',
      barberId: BARBER_A_ID,
      serviceId: 'service-1',
      serviceName: 'Corte clasico',
      clientId: null,
      clientName: null,
      clientAge: null,
      clientPhone: null,
      status: 'reservado',
      startsAt: clock.localTimeToUtc('2026-08-21', '09:00'),
      endsAt: clock.localTimeToUtc('2026-08-21', '09:30'),
    },
    {
      id: 'slot-b1',
      barberId: BARBER_B_ID,
      serviceId: 'service-1',
      serviceName: 'Corte clasico',
      clientId: null,
      clientName: null,
      clientAge: null,
      clientPhone: null,
      status: 'reservado',
      startsAt: clock.localTimeToUtc('2026-08-21', '10:00'),
      endsAt: clock.localTimeToUtc('2026-08-21', '10:30'),
    },
  ],
});

function withSession(req: request.Test, sessionId: string): request.Test {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`);
}

// barber-profile spec, "Agenda propia filtrada":
//
//   Scenario: Barbero no accede a la agenda de un colega
//     GIVEN turnos agendados para otro barbero el mismo día
//     WHEN el barbero autenticado consulta su agenda
//     THEN el sistema MUST NOT incluir esos turnos ni datos del colega
//
// Task 11.3/11.4 reuses the exact narrowing 3b.6/8.7 already built and
// proved (`DayBoardRepository`, `WHERE barber_id` inside the query, never a
// post-fetch filter) — this is a dedicated regression lock traced to
// barber-profile's OWN requirement, not a duplicate of 8.7's
// admin-operations-traced assertion, even though both exercise the same
// production endpoint.
describe('GET /agenda/day-board — barber-profile: agenda propia filtrada', () => {
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

  it("MUST NOT include a colleague's column or slot when a barber requests the day board", async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/agenda/day-board?date=2026-08-21'),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body.columns).toEqual([{ barberId: BARBER_A_ID, barberName: 'Juan' }]);
    expect(response.body.slots).toHaveLength(1);
    expect(response.body.slots[0].barberId).toBe(BARBER_A_ID);
  });
});
