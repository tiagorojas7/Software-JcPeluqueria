import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createBarber,
  createBarberSchedule,
  createService,
  createShopHours,
  FakeActorContextRepository,
  FakeAppointmentRepository,
  FakeBarberRepository,
  FakeClientRepository,
  FakeClock,
  FakeFreeRangesQuery,
  FakeHoldExpireScheduler,
  FakeHoldRepository,
  FakeNotificationOutboxRepository,
  FakePaymentPort,
  FakeRolePermissionRepository,
  FakeScheduleRepository,
  FakeServiceRepository,
  type Appointment,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  APPOINTMENT_REPOSITORY,
  BARBER_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  FREE_RANGES_QUERY,
  HOLD_EXPIRE_SCHEDULER,
  HOLD_REPOSITORY,
  NOTIFICATION_OUTBOX_REPOSITORY,
  PAYMENT_PORT,
  SCHEDULE_REPOSITORY,
  SERVICE_REPOSITORY,
} from '../src/absence-reassignment/tokens';
import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';

// A throwaway FakeClock used only to build fixed instants for test data —
// never the one injected into the module (`generate-absence-reassignment-offers.spec.ts`'s
// same pattern). The REAL injected `clock` below carries a fixed `now`:
// `CreateHold` (reused by `GenerateAbsenceReassignmentOffers`) calls
// `clock.now()` to compute `holdExpiresAt`, which throws on an unconfigured
// `FakeClock`.
const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time); // a Tuesday (dayOfWeek 2)
const clock = new FakeClock(-180, at('09:45'));

const OWNER_SESSION = 'session-owner-absence';
const SECRETARY_SESSION = 'session-secretary-absence';
const BARBER_SESSION = 'session-barber-absence';
const BARBER_ID = 'aaaaaaaa-1111-4000-8000-0000000000d1';
const OTHER_BARBER_ID = 'aaaaaaaa-1111-4000-8000-0000000000d2';
const SERVICE_ID = 'bbbbbbbb-2222-4000-8000-0000000000e1';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(SECRETARY_SESSION, { userId: 'secretary-user-id', role: 'secretary' });
actorContexts.seed(BARBER_SESSION, { userId: 'barber-user-id', role: 'barber', barberId: BARBER_ID });

// Mirrors the exact production seed (migration 0006): owner and secretary
// hold barber:mark-absent, barber does not.
const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    ['owner', new Set<Permission>(['barber:mark-absent'])],
    ['secretary', new Set<Permission>(['barber:mark-absent'])],
    ['barber', new Set<Permission>([])],
  ]),
);

const anAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appointment-1',
  barberId: BARBER_ID,
  // Only THIS service exists in the seeded `services` fake below — an
  // appointment for any other serviceId is a legitimate `no-availability`
  // (service not found), which is exactly what `appointment-2` below uses to
  // stay out of the offer-generation assertion without needing a second
  // free-range fixture.
  serviceId: SERVICE_ID,
  clientId: 'client-1',
  channel: 'web',
  timeRange: { start: at('10:00'), end: at('10:30') },
  status: 'reservado',
  deposit: { kind: 'not_applicable' },
  ...overrides,
});

function withSession(req: request.Test, sessionId: string): request.Test {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`);
}

// 12.2 RED — derived from specs/barber-absence-reassignment/spec.md,
// "Detección de turnos afectados": "Cuando el personal autorizado marca a
// un barbero como no disponible ... el sistema MUST identificar todos los
// turnos en `reservado` de ese barbero dentro de esa franja." Task 12.2's
// "reutiliza 3b" is the guard/permission contract this suite pins: the
// endpoint MUST be reachable for the roles the seeded `role_permissions`
// grant `barber:mark-absent` to, and deny-by-default MUST hold for everyone
// else — the same threat-matrix shape access-control's own contract spec
// already established for every other permission-gated route.
describe('POST /barbers/:barberId/mark-absent (12.1/12.2, E.1)', () => {
  let app: INestApplication;
  let appointments: FakeAppointmentRepository;
  let holds: FakeHoldRepository;
  let outbox: FakeNotificationOutboxRepository;

  beforeAll(async () => {
    appointments = new FakeAppointmentRepository();
    appointments.seed(anAppointment());
    appointments.seed(
      anAppointment({
        id: 'appointment-2',
        serviceId: 'service-without-offer-candidate',
        timeRange: { start: at('14:00'), end: at('14:30') },
      }),
    );

    const barbers = new FakeBarberRepository();
    await barbers.create(createBarber({ id: BARBER_ID, name: 'Ausente', active: true }));
    await barbers.create(createBarber({ id: OTHER_BARBER_ID, name: 'Disponible', active: true }));

    const services = new FakeServiceRepository();
    await services.create(
      createService({ id: SERVICE_ID, name: 'Corte', durationMinutes: 30, priceCents: 500000 }),
    );

    const schedules = new FakeScheduleRepository();
    await schedules.createShopHours(createShopHours({ dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' }));
    await schedules.createBarberSchedule(
      createBarberSchedule({ barberId: OTHER_BARBER_ID, dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' }),
    );

    const freeRanges = new FakeFreeRangesQuery();
    // The absent barber's own free ranges are irrelevant to the offer search
    // (12.5's own scenario, mirrored here) — only OTHER active barbers matter.
    freeRanges.seed(OTHER_BARBER_ID, [{ start: at('11:00'), end: at('11:30') }]);

    const clients = new FakeClientRepository();
    clients.seed({ id: 'client-1', name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: null });

    holds = new FakeHoldRepository();
    outbox = new FakeNotificationOutboxRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(APPOINTMENT_REPOSITORY)
      .useValue(appointments)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(BARBER_REPOSITORY)
      .useValue(barbers)
      .overrideProvider(SERVICE_REPOSITORY)
      .useValue(services)
      .overrideProvider(SCHEDULE_REPOSITORY)
      .useValue(schedules)
      .overrideProvider(FREE_RANGES_QUERY)
      .useValue(freeRanges)
      .overrideProvider(CLIENT_REPOSITORY)
      .useValue(clients)
      .overrideProvider(HOLD_REPOSITORY)
      .useValue(holds)
      // `CreateHold` (reused unmodified by `GenerateAbsenceReassignmentOffers`)
      // enqueues `hold.expire` for every hold it claims — the real provider
      // would reach for pg-boss. Same reasoning as every other Nest test in
      // this suite that overrides this token.
      .overrideProvider(HOLD_EXPIRE_SCHEDULER)
      .useValue(new FakeHoldExpireScheduler())
      .overrideProvider(NOTIFICATION_OUTBOX_REPOSITORY)
      .useValue(outbox)
      .overrideProvider(PAYMENT_PORT)
      .useValue(new FakePaymentPort())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('lets the owner mark a barber absent and returns the affected turnos', async () => {
    const response = await withSession(
      request(app.getHttpServer())
        .post(`/barbers/${BARBER_ID}/mark-absent`)
        .send({ calendarDate: '2026-09-01', startTime: '09:00', endTime: '18:00' }),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body.affectedAppointmentIds.sort()).toEqual(['appointment-1', 'appointment-2']);
  });

  // E.1 (cablear-el-mvp Slice E) — the gap this task closes:
  // `MarkBarberAbsentController` used to stop at detection. It must now also
  // call `GenerateAbsenceReassignmentOffers`, which claims a same-day hold
  // from another active barber and writes the client notification intent to
  // the outbox — the worker dispatches it from there (proven separately by
  // A.4/A.7's live worker run).
  it('generates a same-day reassignment offer hold and enqueues the client notification (E.1)', async () => {
    // The fakes are shared across this whole describe block (never reset
    // between tests, same posture `account.spec.ts` already established for
    // its own shared `paymentPort`) — other tests hit this SAME barber and
    // trigger their own offer-generation side effect too, so this asserts
    // the DELTA this one request causes, not an absolute count.
    const offerCallsBefore = holds.createCalls.filter((call) => call.hold.originOccupancyId !== null).length;
    const enqueuedBefore = outbox.enqueued.length;

    const response = await withSession(
      request(app.getHttpServer())
        .post(`/barbers/${BARBER_ID}/mark-absent`)
        .send({ calendarDate: '2026-09-01', startTime: '09:00', endTime: '18:00' }),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    const offerCalls = holds.createCalls.filter((call) => call.hold.originOccupancyId !== null).slice(offerCallsBefore);
    expect(offerCalls).toHaveLength(1);
    expect(offerCalls[0]?.hold.barberId).toBe(OTHER_BARBER_ID);
    expect(offerCalls[0]?.hold.originOccupancyId).toBe('appointment-1');

    expect(outbox.enqueued.slice(enqueuedBefore)).toEqual([
      expect.objectContaining({
        notificationType: 'absence_reassignment_offer',
        recipientEmail: 'marcos@example.com',
      }),
    ]);
  });

  it('lets the secretary do the same', async () => {
    const response = await withSession(
      request(app.getHttpServer())
        .post(`/barbers/${BARBER_ID}/mark-absent`)
        .send({ calendarDate: '2026-09-01', startTime: '09:00', endTime: '18:00' }),
      SECRETARY_SESSION,
    );

    expect(response.status).toBe(200);
  });

  it('rejects a barber (no barber:mark-absent permission) with 403', async () => {
    const response = await withSession(
      request(app.getHttpServer())
        .post(`/barbers/${BARBER_ID}/mark-absent`)
        .send({ calendarDate: '2026-09-01', startTime: '09:00', endTime: '18:00' }),
      BARBER_SESSION,
    );

    expect(response.status).toBe(403);
  });

  it('rejects an anonymous request with 403 — deny by default applies here too', async () => {
    const response = await request(app.getHttpServer())
      .post(`/barbers/${BARBER_ID}/mark-absent`)
      .send({ calendarDate: '2026-09-01', startTime: '09:00', endTime: '18:00' });

    expect(response.status).toBe(403);
  });

  it('rejects a malformed body with 400 before ever calling the use case', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post(`/barbers/${BARBER_ID}/mark-absent`).send({ calendarDate: 'not-a-date' }),
      OWNER_SESSION,
    );

    expect(response.status).toBe(400);
  });
});
