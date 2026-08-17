import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeAppointmentRepository,
  FakeClock,
  FakeRolePermissionRepository,
  type Appointment,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { APPOINTMENT_REPOSITORY, CLOCK } from '../src/absence-reassignment/tokens';
import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-01', time);

const OWNER_SESSION = 'session-owner-absence';
const SECRETARY_SESSION = 'session-secretary-absence';
const BARBER_SESSION = 'session-barber-absence';
const BARBER_ID = 'aaaaaaaa-1111-4000-8000-0000000000d1';

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
  serviceId: 'service-1',
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
describe('POST /barbers/:barberId/mark-absent (12.1/12.2)', () => {
  let app: INestApplication;
  let appointments: FakeAppointmentRepository;

  beforeAll(async () => {
    appointments = new FakeAppointmentRepository();
    appointments.seed(anAppointment());
    appointments.seed(anAppointment({ id: 'appointment-2', timeRange: { start: at('14:00'), end: at('14:30') } }));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(APPOINTMENT_REPOSITORY)
      .useValue(appointments)
      .overrideProvider(CLOCK)
      .useValue(clock)
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
