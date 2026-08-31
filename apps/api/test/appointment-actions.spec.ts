import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createBarber,
  createService,
  FakeAbsenceRecordRepository,
  FakeActorContextRepository,
  FakeAppointmentRepository,
  FakeBarberRepository,
  FakeClientRepository,
  FakeClock,
  FakeHoldExpireScheduler,
  FakeHoldRepository,
  FakeNotificationOutboxRepository,
  FakePaymentPort,
  FakeRolePermissionRepository,
  FakeServiceRepository,
  FakeWalkInRepository,
  type Appointment,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import {
  ABSENCE_RECORD_REPOSITORY,
  APPOINTMENT_REPOSITORY,
  BARBER_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  HOLD_EXPIRE_SCHEDULER,
  HOLD_REPOSITORY,
  NOTIFICATION_OUTBOX_REPOSITORY,
  PAYMENT_PORT,
  SERVICE_REPOSITORY,
  WALK_IN_REPOSITORY,
} from '../src/appointments/tokens';

const dateBuilder = new FakeClock();
// After the default fixture's timeRange (10:00-10:30, below) — mark-completed
// now rejects a turno whose start has not arrived yet, so "now" here must be
// at/after the turno's start for the existing "marks realizado" happy paths
// to still describe a turno that has actually begun.
const clock = new FakeClock(-180, dateBuilder.localTimeToUtc('2026-09-01', '10:35'));
const at = (time: string) => clock.localTimeToUtc('2026-09-01', time);

const OWNER_SESSION = 'session-owner-actions';
const SECRETARY_SESSION = 'session-secretary-actions';
const BARBER_A_SESSION = 'session-barber-a-actions';
const BARBER_B_SESSION = 'session-barber-b-actions';
const BARBER_A_ID = 'aaaaaaaa-1111-4000-8000-000000000a01';
const BARBER_B_ID = 'aaaaaaaa-1111-4000-8000-000000000b02';
const SERVICE_ID = 'bbbbbbbb-2222-4000-8000-000000000002';
const SERVICE_DURATION_MINUTES = 30;

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(SECRETARY_SESSION, { userId: 'secretary-user-id', role: 'secretary' });
actorContexts.seed(BARBER_A_SESSION, { userId: 'barber-a-user-id', role: 'barber', barberId: BARBER_A_ID });
actorContexts.seed(BARBER_B_SESSION, { userId: 'barber-b-user-id', role: 'barber', barberId: BARBER_B_ID });

// Mirrors the exact production seed (migration 0006).
const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    [
      'owner',
      new Set<Permission>([
        'appointment:update',
        'appointment:cancel',
        'appointment:mark-completed:any',
        'walkin:create',
      ]),
    ],
    [
      'secretary',
      new Set<Permission>([
        'appointment:update',
        'appointment:cancel',
        'appointment:mark-completed:any',
        'walkin:create',
      ]),
    ],
    ['barber', new Set<Permission>(['appointment:mark-completed:own'])],
  ]),
);

function withSession(req: request.Test, sessionId?: string): request.Test {
  return sessionId ? req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`) : req;
}

const anAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appointment-1',
  barberId: BARBER_A_ID,
  serviceId: SERVICE_ID,
  clientId: 'client-1',
  channel: 'web',
  timeRange: { start: at('10:00'), end: at('10:30') },
  status: 'reservado',
  deposit: { kind: 'not_applicable' },
  ...overrides,
});

// Slice B (cablear-el-mvp, B.1-B.5): "el panel se ve pero no se puede hacer
// nada sobre un turno" — this suite is the HTTP wiring that was missing for
// AdminMarkCompletedUseCase, AdminConfirmAbsenceUseCase,
// BarberMarkCompletedUseCase, BarberConfirmAbsenceUseCase,
// EditAppointmentUseCase, AdminCancelAppointmentUseCase and
// CreateWalkInUseCase — every one of them already had a passing unit test
// against the fake, and none had a controller (task 10.11's actual gap).
describe('appointment actions panel endpoints (App Nest levantada en memoria)', () => {
  let app: INestApplication;
  let appointments: FakeAppointmentRepository;
  let absences: FakeAbsenceRecordRepository;
  let walkIns: FakeWalkInRepository;
  let services: FakeServiceRepository;
  let clients: FakeClientRepository;
  let barbers: FakeBarberRepository;
  let outbox: FakeNotificationOutboxRepository;

  beforeAll(async () => {
    appointments = new FakeAppointmentRepository();
    absences = new FakeAbsenceRecordRepository();
    walkIns = new FakeWalkInRepository();
    services = new FakeServiceRepository();
    services.create(
      createService({ id: SERVICE_ID, name: 'Corte clasico', durationMinutes: SERVICE_DURATION_MINUTES, priceCents: 500000 }),
    );
    clients = new FakeClientRepository();
    barbers = new FakeBarberRepository();
    barbers.create(createBarber({ id: BARBER_B_ID, name: 'Facundo Diaz', active: true }));
    outbox = new FakeNotificationOutboxRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(APPOINTMENT_REPOSITORY)
      .useValue(appointments)
      .overrideProvider(ABSENCE_RECORD_REPOSITORY)
      .useValue(absences)
      .overrideProvider(PAYMENT_PORT)
      .useValue(new FakePaymentPort())
      .overrideProvider(WALK_IN_REPOSITORY)
      .useValue(walkIns)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(CLIENT_REPOSITORY)
      .useValue(clients)
      .overrideProvider(HOLD_REPOSITORY)
      .useValue(new FakeHoldRepository())
      // Mandatory for every Nest test building the app (see repo conventions):
      // the real provider reaches for pg-boss, which this suite is not about.
      .overrideProvider(HOLD_EXPIRE_SCHEDULER)
      .useValue(new FakeHoldExpireScheduler())
      // panel-usable: EditAppointmentUseCase/CreateWalkInUseCase now derive
      // endTime from the target service's durationMinutes, so both need a
      // real service to find by id.
      .overrideProvider(SERVICE_REPOSITORY)
      .useValue(services)
      // panel-usable: EditAppointmentUseCase fires appointment_updated on a
      // successful edit — needs a barber to name in the email and an outbox
      // to write to (never NotificationPort directly).
      .overrideProvider(BARBER_REPOSITORY)
      .useValue(barbers)
      .overrideProvider(NOTIFICATION_OUTBOX_REPOSITORY)
      .useValue(outbox)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects an anonymous request with 403 — deny by default applies to this endpoint too', async () => {
    appointments.seed(anAppointment({ id: 'anon-1' }));

    const response = await request(app.getHttpServer()).post('/appointments/anon-1/mark-completed');

    expect(response.status).toBe(403);
  });

  it('lets the owner mark a reservado appointment as realizado', async () => {
    appointments.seed(anAppointment({ id: 'owner-mc-1' }));

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/owner-mc-1/mark-completed'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'owner-mc-1', status: 'realizado' });
  });

  // Un corte no puede estar "realizado" antes de suceder. La regla vive en el
  // dominio; acá se prueba que el borde HTTP la traduce a un 409 con un
  // mensaje que alguien parado en el mostrador puede entender, y no al 500
  // genérico que aparecía antes.
  it('rechaza con 409 marcar realizado un turno que todavia no empezo', async () => {
    appointments.seed(
      anAppointment({
        id: 'futuro-mc-1',
        timeRange: { start: at('18:00'), end: at('18:30') },
      }),
    );

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/futuro-mc-1/mark-completed'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/todav.a no empez/i);
    // Y nada se escribió para ESTE turno: sigue reservado. (El fake acumula
    // llamadas de todo el archivo, así que se filtra por id.)
    expect(appointments.updateStatusCalls.filter((call) => call.id === 'futuro-mc-1')).toEqual([]);
  });

  it('lets the secretary confirm an absence on a sin_registrado appointment', async () => {
    appointments.seed(anAppointment({ id: 'sec-ca-1', status: 'sin_registrado' }));

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/sec-ca-1/confirm-absence'),
      SECRETARY_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body.appointment).toMatchObject({ id: 'sec-ca-1', status: 'ausente' });
    expect(response.body.absence).toMatchObject({ appointmentId: 'sec-ca-1', confirmedByUserId: 'secretary-user-id' });
    expect(absences.recordCalls.some((absence) => absence.appointmentId === 'sec-ca-1')).toBe(true);
  });

  it('lets a barber mark their OWN reservado appointment as realizado', async () => {
    appointments.seed(anAppointment({ id: 'barber-mc-own', barberId: BARBER_A_ID }));

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/barber-mc-own/mark-completed'),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'barber-mc-own', status: 'realizado' });
  });

  it("rejects a barber marking a COLLEAGUE's appointment as realizado, and performs NO write", async () => {
    appointments.seed(anAppointment({ id: 'barber-mc-colleague', barberId: BARBER_B_ID }));

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/barber-mc-colleague/mark-completed'),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(403);
    expect(appointments.updateStatusCalls.some((call) => call.id === 'barber-mc-colleague')).toBe(false);
  });

  it('lets a barber confirm absence on their OWN sin_registrado appointment', async () => {
    appointments.seed(anAppointment({ id: 'barber-ca-own', barberId: BARBER_A_ID, status: 'sin_registrado' }));

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/barber-ca-own/confirm-absence'),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body.appointment).toMatchObject({ id: 'barber-ca-own', status: 'ausente' });
  });

  it("rejects a barber confirming absence on a COLLEAGUE's appointment, and records NO absence", async () => {
    appointments.seed(
      anAppointment({ id: 'barber-ca-colleague', barberId: BARBER_B_ID, status: 'sin_registrado' }),
    );

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/barber-ca-colleague/confirm-absence'),
      BARBER_A_SESSION,
    );

    expect(response.status).toBe(403);
    expect(absences.recordCalls.some((absence) => absence.appointmentId === 'barber-ca-colleague')).toBe(false);
  });

  it('lets the owner edit service, barber and horario of any turno — endTime derived from the service, never sent', async () => {
    appointments.seed(anAppointment({ id: 'edit-1' }));

    const response = await withSession(
      request(app.getHttpServer()).put('/appointments/edit-1'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_B_ID,
      serviceId: SERVICE_ID,
      calendarDate: '2026-09-01',
      startTime: '15:00',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'edit-1',
      barberId: BARBER_B_ID,
      startsAt: at('15:00').toISOString(),
      endsAt: at('15:30').toISOString(),
    });
  });

  // panel-usable: "nobody tells the client their appointment changed" —
  // this is the actual end-to-end wiring (HTTP -> use case -> outbox).
  it('notifies the client through the outbox when a successful edit changes their turno', async () => {
    clients.seed({ id: 'client-with-email', name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: null });
    appointments.seed(anAppointment({ id: 'edit-notify', clientId: 'client-with-email' }));
    const enqueuedBefore = outbox.enqueued.length;

    const response = await withSession(
      request(app.getHttpServer()).put('/appointments/edit-notify'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_B_ID,
      serviceId: SERVICE_ID,
      calendarDate: '2026-09-01',
      startTime: '16:00',
    });

    expect(response.status).toBe(200);
    expect(outbox.enqueued.length).toBe(enqueuedBefore + 1);
    expect(outbox.enqueued.at(-1)).toEqual({
      notificationType: 'appointment_updated',
      recipientEmail: 'marcos@example.com',
      payload: {
        barberName: 'Facundo Diaz',
        serviceName: 'Corte clasico',
        appointmentTime: at('16:00').toISOString(),
      },
    });
  });

  it('rejects editing into a service that does not exist with a 400, not a 500', async () => {
    appointments.seed(anAppointment({ id: 'edit-no-service' }));

    const response = await withSession(
      request(app.getHttpServer()).put('/appointments/edit-no-service'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_B_ID,
      serviceId: 'cccccccc-3333-4000-8000-000000000003',
      calendarDate: '2026-09-01',
      startTime: '15:00',
    });

    expect(response.status).toBe(400);
  });

  it('rejects a malformed edit body with 400 before ever calling the use case', async () => {
    appointments.seed(anAppointment({ id: 'edit-bad' }));

    const response = await withSession(
      request(app.getHttpServer()).put('/appointments/edit-bad'),
      OWNER_SESSION,
    ).send({ barberId: 'not-a-uuid' });

    expect(response.status).toBe(400);
  });

  it('rejects a barber editing an appointment — no appointment:update permission', async () => {
    appointments.seed(anAppointment({ id: 'edit-forbidden', barberId: BARBER_A_ID }));

    const response = await withSession(
      request(app.getHttpServer()).put('/appointments/edit-forbidden'),
      BARBER_A_SESSION,
    ).send({ barberId: BARBER_A_ID, serviceId: SERVICE_ID, calendarDate: '2026-09-01', startTime: '16:00' });

    expect(response.status).toBe(403);
  });

  it('lets the owner cancel any turno', async () => {
    appointments.seed(anAppointment({ id: 'cancel-1' }));

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/cancel-1/cancel'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'cancel-1', status: 'cancelado' });
  });

  it('returns 404 when the appointment does not exist', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/does-not-exist/cancel'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(404);
  });

  it('lets the owner load a walk-in straight into realizado — endTime derived from the service, never sent', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/walk-in'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_A_ID,
      serviceId: SERVICE_ID,
      clientPhone: null,
      calendarDate: '2026-09-01',
      startTime: '11:00',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      barberId: BARBER_A_ID,
      channel: 'walk_in',
      status: 'realizado',
      clientId: null,
      startsAt: at('11:00').toISOString(),
      endsAt: at('11:30').toISOString(),
    });
    expect(walkIns.createCalls).toHaveLength(1);
  });

  it('links the walk-in to an existing client found by phone', async () => {
    clients.seed({ id: 'client-9', name: 'Laura', phone: '3512223344', email: null, age: null });

    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/walk-in'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_A_ID,
      serviceId: SERVICE_ID,
      clientPhone: '3512223344',
      calendarDate: '2026-09-01',
      startTime: '13:00',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ clientId: 'client-9' });
  });

  it('rejects a walk-in into a service that does not exist with a 400, not a 500', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/walk-in'),
      OWNER_SESSION,
    ).send({
      barberId: BARBER_A_ID,
      serviceId: 'cccccccc-3333-4000-8000-000000000003',
      calendarDate: '2026-09-01',
      startTime: '12:00',
    });

    expect(response.status).toBe(400);
  });

  it('rejects a barber loading a walk-in — no walkin:create permission', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/appointments/walk-in'),
      BARBER_A_SESSION,
    ).send({
      barberId: BARBER_A_ID,
      serviceId: SERVICE_ID,
      calendarDate: '2026-09-01',
      startTime: '12:00',
    });

    expect(response.status).toBe(403);
  });
});
