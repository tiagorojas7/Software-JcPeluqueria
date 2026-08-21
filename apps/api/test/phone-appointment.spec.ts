import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createService,
  FakeActorContextRepository,
  FakeAppointmentReminderScheduler,
  FakeClientRepository,
  FakeClock,
  FakeHoldExpireScheduler,
  FakeHoldRepository,
  FakeRolePermissionRepository,
  FakeServiceRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import {
  APPOINTMENT_REMINDER_SCHEDULER,
  CLIENT_REPOSITORY,
  CLOCK,
  HOLD_EXPIRE_SCHEDULER,
  HOLD_REPOSITORY,
  SERVICE_REPOSITORY,
} from '../src/appointments/tokens';

const OWNER_SESSION = 'session-owner';
const BARBER_SESSION = 'session-barber';
const BARBER_ID = 'aaaaaaaa-1111-4000-8000-000000000001';
const SERVICE_ID = 'bbbbbbbb-2222-4000-8000-000000000002';

// D.4 (paneles-y-turno-telefonico): the secretary never types an end time —
// CreatePhoneAppointmentUseCase derives it from this service's
// durationMinutes instead, so this suite needs a real one to look up.
const services = new FakeServiceRepository();
services.create(createService({ id: SERVICE_ID, name: 'Corte clasico', durationMinutes: 30, priceCents: 800000 }));

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
      .overrideProvider(SERVICE_REPOSITORY)
      .useValue(services)
      .overrideProvider(CLOCK)
      .useValue(clock)
      // `CreateHold` enqueues `hold.expire` for every hold (task 6.3), so the
      // real provider would reach for pg-boss. This suite is about the HTTP
      // wiring, not the queue: the enqueue is proven in the scheduler's own
      // unit test, and the worker owns the consuming half.
      .overrideProvider(HOLD_EXPIRE_SCHEDULER)
      .useValue(new FakeHoldExpireScheduler())
      // E.2: `CreatePhoneAppointmentUseCase` now schedules `appointment.reminder`
      // too (Slice E) — same reasoning as `HOLD_EXPIRE_SCHEDULER` above, this
      // suite is about the HTTP wiring, not the queue.
      .overrideProvider(APPOINTMENT_REMINDER_SCHEDULER)
      .useValue(new FakeAppointmentReminderScheduler())
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

  it('books a phone appointment with only name and phone, no seña, no endTime in the request', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/phone'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_ID,
      serviceId: SERVICE_ID,
      calendarDate: '2026-09-01',
      startTime: '10:00',
      client: { name: 'Marcos', phone: '3511234567' },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'reservado' });
  });

  // D.4: the exact property the owner asked to guarantee — the stored
  // duration always matches the selected service's durationMinutes (30 for
  // SERVICE_ID here), server-derived, never trusted from the request.
  it("derives endsAt from the selected service's durationMinutes", async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/phone'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_ID,
      serviceId: SERVICE_ID,
      calendarDate: '2026-09-01',
      startTime: '13:00',
      client: { name: 'Sofia', phone: '3519876543' },
    });

    expect(response.status).toBe(201);
    expect(response.body.startsAt).toBe(dateBuilder.localTimeToUtc('2026-09-01', '13:00').toISOString());
    expect(response.body.endsAt).toBe(dateBuilder.localTimeToUtc('2026-09-01', '13:30').toISOString());
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
      client: { name: 'Laura' },
    });

    expect(response.status).toBe(400);
  });

  it('rejects a serviceId that does not exist with 400, never a bare 500', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/phone'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_ID,
      serviceId: 'cccccccc-3333-4000-8000-000000000003',
      calendarDate: '2026-09-01',
      startTime: '14:00',
      client: { name: 'Laura', phone: '3517654321' },
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
      client: { name: 'Laura', phone: '3517654321' },
    });

    expect(response.status).toBe(403);
  });
});
