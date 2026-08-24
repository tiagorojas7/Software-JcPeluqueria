import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createBarber,
  FakeActorContextRepository,
  FakeBarberRepository,
  FakeClientRepository,
  FakeRolePermissionRepository,
  FakeScheduleRepository,
  FakeServiceRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import { BARBER_REPOSITORY, CLIENT_REPOSITORY, SCHEDULE_REPOSITORY, SERVICE_REPOSITORY } from '../src/panel/tokens';

// 10.14/10.15 RED — derived from specs/admin-operations/spec.md, not from
// an implementation:
//
//   "Gestión de clientes y de barberos":
//     El sistema MUST poder ver y administrar los registros de clientes. El
//     alta y baja de barberos, y la configuración de horarios base y
//     precios de servicios, MUST quedar restringidas a los roles
//     autorizados según access-control.
//
//   Scenario "Alta de un nuevo barbero":
//     GIVEN un rol autorizado para configuración
//     WHEN da de alta un nuevo barbero con su horario base
//     THEN el barbero queda disponible para asignación de turnos
//
// The 3b seed (0006_access_control.sql) grants `client:manage` to BOTH
// owner and secretary, but `barber:manage`/`schedule:configure`/
// `pricing:configure` to owner ONLY — the exact "restringidas a los roles
// autorizados" split this suite proves at the HTTP boundary, the same
// threat-matrix style Fase 3b/11 already used ("dos permisos no son
// intercambiables").

const OWNER_SESSION = 'session-owner';
const SECRETARY_SESSION = 'session-secretary';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(SECRETARY_SESSION, { userId: 'secretary-user-id', role: 'secretary' });

const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    ['owner', new Set<Permission>(['client:manage', 'barber:manage', 'schedule:configure', 'pricing:configure'])],
    ['secretary', new Set<Permission>(['client:manage'])],
  ]),
);

function withSession(req: request.Test, sessionId: string): request.Test {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`);
}

describe('Panel: gestión de clientes y barberos (App Nest levantada en memoria)', () => {
  let app: INestApplication;
  let barbers: FakeBarberRepository;
  let clients: FakeClientRepository;
  let schedules: FakeScheduleRepository;

  beforeAll(async () => {
    barbers = new FakeBarberRepository();
    clients = new FakeClientRepository();
    schedules = new FakeScheduleRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(CLIENT_REPOSITORY)
      .useValue(clients)
      .overrideProvider(BARBER_REPOSITORY)
      .useValue(barbers)
      .overrideProvider(SCHEDULE_REPOSITORY)
      .useValue(schedules)
      .overrideProvider(SERVICE_REPOSITORY)
      .useValue(new FakeServiceRepository())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects an anonymous request to add a barber with 403 — deny by default applies here too', async () => {
    const response = await request(app.getHttpServer())
      .post('/panel/barbers')
      .send({ name: 'Nuevo', schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }] });

    expect(response.status).toBe(403);
  });

  it('lets the owner add a barber with a base schedule', async () => {
    const response = await withSession(request(app.getHttpServer()).post('/panel/barbers'), OWNER_SESSION).send({
      name: 'Nuevo Barbero',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Nuevo Barbero', active: true });
    const stored = await barbers.list();
    expect(stored).toEqual([{ id: response.body.id, name: 'Nuevo Barbero', active: true }]);
  });

  it('MUST reject the secretary adding a barber with 403 — barber:manage is owner-only, unlike client:manage', async () => {
    const response = await withSession(request(app.getHttpServer()).post('/panel/barbers'), SECRETARY_SESSION).send({
      name: 'Otro Barbero',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
    });

    expect(response.status).toBe(403);
  });

  it('lets the secretary view the client list — client:manage reaches both owner and secretary', async () => {
    await clients.create({ name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: null });

    const response = await withSession(request(app.getHttpServer()).get('/panel/clients'), SECRETARY_SESSION);

    expect(response.status).toBe(200);
    expect(response.body.clients).toHaveLength(1);
  });

  it('rejects malformed input with 400 before ever touching the barber repository', async () => {
    const response = await withSession(request(app.getHttpServer()).post('/panel/barbers'), OWNER_SESSION).send({
      name: '',
      schedule: [],
    });

    expect(response.status).toBe(400);
  });

  it('404s deactivating an unknown barber id, never a raw 500', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/panel/barbers/does-not-exist/deactivate'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(404);
  });

  // panel-usable: the actual product bug — configuring a week took five
  // separate PUTs and the panel only ever made one, so every barber ended up
  // with a single `barber_schedules` row. This is the one-call fix.
  it("lets the owner set a barber's whole week in one request — one row per working day", async () => {
    await barbers.create(createBarber({ id: 'week-barber', name: 'Semana', active: true }));

    const response = await withSession(
      request(app.getHttpServer()).put('/panel/barbers/week-barber/schedule/week'),
      OWNER_SESSION,
    ).send({
      schedule: [
        { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
        { dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' },
        { dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' },
        { dayOfWeek: 4, opensAt: '09:00', closesAt: '18:00' },
        { dayOfWeek: 5, opensAt: '09:00', closesAt: '17:00' },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ configured: true });
    const stored = await schedules.listBarberSchedule('week-barber');
    expect(stored).toHaveLength(5);
  });

  it('MUST reject the secretary configuring a week — schedule:configure is owner-only', async () => {
    await barbers.create(createBarber({ id: 'week-barber-2', name: 'Semana', active: true }));

    const response = await withSession(
      request(app.getHttpServer()).put('/panel/barbers/week-barber-2/schedule/week'),
      SECRETARY_SESSION,
    ).send({ schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }] });

    expect(response.status).toBe(403);
  });

  it('rejects an empty week with 400 before ever touching the schedule repository', async () => {
    const response = await withSession(
      request(app.getHttpServer()).put('/panel/barbers/week-barber-3/schedule/week'),
      OWNER_SESSION,
    ).send({ schedule: [] });

    expect(response.status).toBe(400);
  });

  it('the per-day schedule endpoint keeps working unmodified for a single-day caller', async () => {
    await barbers.create(createBarber({ id: 'day-barber', name: 'Un Dia', active: true }));

    const response = await withSession(
      request(app.getHttpServer()).put('/panel/barbers/day-barber/schedule'),
      OWNER_SESSION,
    ).send({ dayOfWeek: 3, opensAt: '10:00', closesAt: '19:00' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ configured: true });
    const stored = await schedules.listBarberSchedule('day-barber');
    expect(stored).toHaveLength(1);
  });
});
