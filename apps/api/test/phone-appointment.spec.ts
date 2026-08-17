import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeClientRepository,
  FakeClock,
  FakeHoldRepository,
  FakeRolePermissionRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import { CLIENT_REPOSITORY, CLOCK, HOLD_REPOSITORY } from '../src/appointments/tokens';

const OWNER_SESSION = 'session-owner';
const BARBER_SESSION = 'session-barber';
const BARBER_ID = 'aaaaaaaa-1111-4000-8000-000000000001';
const SERVICE_ID = 'bbbbbbbb-2222-4000-8000-000000000002';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(BARBER_SESSION, { userId: 'barber-user-id', role: 'barber', barberId: BARBER_ID });

const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    ['owner', new Set<Permission>(['appointment:create'])],
    ['barber', new Set<Permission>([])],
  ]),
);

function withSession(req: request.Test, sessionId?: string): request.Test {
  return sessionId ? req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`) : req;
}

// The panel's real, production phone-appointment endpoint (task 10.1/10.2) —
// exercises AppointmentsModule wired into the real AppModule, same pattern
// as apps/api/test/day-board.spec.ts.
describe('POST /appointments/phone (App Nest levantada en memoria)', () => {
  let app: INestApplication;
  // A throwaway FakeClock only to build a fixed instant for the real one below.
  const dateBuilder = new FakeClock();
  const clock = new FakeClock(-180, dateBuilder.localTimeToUtc('2026-09-01', '09:00'));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(CLIENT_REPOSITORY)
      .useValue(new FakeClientRepository())
      .overrideProvider(HOLD_REPOSITORY)
      .useValue(new FakeHoldRepository())
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects an anonymous request with 403 — deny by default applies to this endpoint too', async () => {
    const response = await request(app.getHttpServer()).post('/appointments/phone').send({});

    expect(response.status).toBe(403);
  });

  it('books a phone appointment with only name and phone, no seña', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/phone'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_ID,
      serviceId: SERVICE_ID,
      calendarDate: '2026-09-01',
      startTime: '10:00',
      endTime: '10:30',
      client: { name: 'Marcos', phone: '3511234567' },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'reservado' });
  });

  it('rejects a request missing the required phone field', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/phone'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_ID,
      serviceId: SERVICE_ID,
      calendarDate: '2026-09-01',
      startTime: '11:00',
      endTime: '11:30',
      client: { name: 'Laura' },
    });

    expect(response.status).toBe(400);
  });

  it('rejects a request from an actor without appointment:create', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/phone'),
      BARBER_SESSION,
    ).send({
      barberId: BARBER_ID,
      serviceId: SERVICE_ID,
      calendarDate: '2026-09-01',
      startTime: '12:00',
      endTime: '12:30',
      client: { name: 'Laura', phone: '3517654321' },
    });

    expect(response.status).toBe(403);
  });
});
