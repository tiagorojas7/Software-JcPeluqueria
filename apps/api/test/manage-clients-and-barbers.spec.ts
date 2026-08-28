import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createBarber,
  FakeActorContextRepository,
  FakeAppointmentRepository,
  FakeAuthChallengeRepository,
  FakeBarberRepository,
  FakeClientRepository,
  FakeClock,
  FakeNotificationOutboxRepository,
  FakeRolePermissionRepository,
  FakeScheduleRepository,
  FakeServiceRepository,
  FakeStaffAccountRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import {
  APPOINTMENT_REPOSITORY,
  AUTH_CHALLENGE_REPOSITORY,
  BARBER_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  NOTIFICATION_OUTBOX_REPOSITORY,
  SCHEDULE_REPOSITORY,
  SERVICE_REPOSITORY,
  STAFF_ACCOUNT_REPOSITORY,
} from '../src/panel/tokens';

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
/** Only ever used to build fixed instants for test fixtures — the module's
 *  own CLOCK is fixed separately at `2026-09-01T12:00:00.000Z` (a Tuesday). */
const dateBuilder = new FakeClock();

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
  let staffAccounts: FakeStaffAccountRepository;
  let outbox: FakeNotificationOutboxRepository;
  let appointments: FakeAppointmentRepository;

  beforeAll(async () => {
    barbers = new FakeBarberRepository();
    clients = new FakeClientRepository();
    schedules = new FakeScheduleRepository();
    staffAccounts = new FakeStaffAccountRepository();
    outbox = new FakeNotificationOutboxRepository();
    appointments = new FakeAppointmentRepository();

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
      // The alta creates the barber ACCOUNT too now, so this suite has to
      // stand in for the three ports that invitation needs — otherwise the
      // real Drizzle repositories would try to reach a database.
      .overrideProvider(STAFF_ACCOUNT_REPOSITORY)
      .useValue(staffAccounts)
      .overrideProvider(AUTH_CHALLENGE_REPOSITORY)
      .useValue(new FakeAuthChallengeRepository())
      .overrideProvider(NOTIFICATION_OUTBOX_REPOSITORY)
      .useValue(outbox)
      .overrideProvider(CLOCK)
      .useValue(new FakeClock(-180, new FakeClock().parseInstant('2026-09-01T12:00:00.000Z')))
      // `configureBarberWeek`'s orphan-turno check (docs/HUECOS-BACKEND.md
      // #6) — without this override the real Drizzle repository would try
      // to reach a database.
      .overrideProvider(APPOINTMENT_REPOSITORY)
      .useValue(appointments)
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
      .send({ name: 'Nuevo', email: 'nuevo-anon@jc.test', schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }] });

    expect(response.status).toBe(403);
  });

  it('lets the owner add a barber with a base schedule', async () => {
    const response = await withSession(request(app.getHttpServer()).post('/panel/barbers'), OWNER_SESSION).send({
      name: 'Nuevo Barbero',
      email: 'nuevo@jc.test',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Nuevo Barbero', active: true, permanentLeave: false });
    const stored = await barbers.list();
    expect(stored).toEqual([{ id: response.body.id, name: 'Nuevo Barbero', active: true, permanentLeave: false }]);
  });

  it('MUST reject the secretary adding a barber with 403 — barber:manage is owner-only, unlike client:manage', async () => {
    const response = await withSession(request(app.getHttpServer()).post('/panel/barbers'), SECRETARY_SESSION).send({
      name: 'Otro Barbero',
      email: 'otro@jc.test',
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

  // docs/HUECOS-BACKEND.md #6, segunda parte: "el backend responda cuántos
  // turnos quedarían huérfanos y que la UI pida confirmación con ese
  // número." El reloj de este modulo esta fijo en 2026-09-01T12:00:00Z (un
  // martes); el turno queda en el martes SIGUIENTE (2026-09-08), asi que es
  // futuro respecto de ese reloj. El barbero conserva el lunes y se le saca
  // el martes — el contrato exige al menos un dia, asi que "apagar TODO" no
  // es el camino real de este endpoint.
  it('pide confirmacion, sin escribir nada, cuando sacar un dia dejaria un turno reservado huerfano', async () => {
    await barbers.create(createBarber({ id: 'week-barber-5', name: 'Con Turno', active: true }));
    await schedules.createBarberSchedule({ barberId: 'week-barber-5', dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' });
    await schedules.createBarberSchedule({ barberId: 'week-barber-5', dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' });
    appointments.seed({
      id: 'apt-huerfano',
      barberId: 'week-barber-5',
      serviceId: 'service-1',
      clientId: 'client-1',
      channel: 'web',
      timeRange: {
        start: dateBuilder.localTimeToUtc('2026-09-08', '10:00'),
        end: dateBuilder.localTimeToUtc('2026-09-08', '10:30'),
      },
      status: 'reservado',
      deposit: { kind: 'not_applicable' },
    });

    const response = await withSession(
      request(app.getHttpServer()).put('/panel/barbers/week-barber-5/schedule/week'),
      OWNER_SESSION,
    ).send({ schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ configured: false, affectedAppointmentIds: ['apt-huerfano'] });
    // Nada se escribio: los DOS dias siguen exactamente como estaban.
    expect(await schedules.listBarberSchedule('week-barber-5')).toHaveLength(2);
  });

  it('escribe el cambio cuando el dueno ya confirmo con confirm:true', async () => {
    await barbers.create(createBarber({ id: 'week-barber-6', name: 'Con Turno', active: true }));
    await schedules.createBarberSchedule({ barberId: 'week-barber-6', dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' });
    await schedules.createBarberSchedule({ barberId: 'week-barber-6', dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' });
    appointments.seed({
      id: 'apt-huerfano-2',
      barberId: 'week-barber-6',
      serviceId: 'service-1',
      clientId: 'client-1',
      channel: 'web',
      timeRange: {
        start: dateBuilder.localTimeToUtc('2026-09-08', '10:00'),
        end: dateBuilder.localTimeToUtc('2026-09-08', '10:30'),
      },
      status: 'reservado',
      deposit: { kind: 'not_applicable' },
    });

    const response = await withSession(
      request(app.getHttpServer()).put('/panel/barbers/week-barber-6/schedule/week'),
      OWNER_SESSION,
    ).send({ schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }], confirm: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ configured: true });
    const stored = await schedules.listBarberSchedule('week-barber-6');
    expect(stored.map((day) => day.dayOfWeek)).toEqual([1]);
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

  // El dueño cargo un horario que cerraba a las 00:00 y el panel lo acepto:
  // el schema solo validaba el FORMATO de cada hora, nunca que la apertura
  // fuera anterior al cierre. `createBarberSchedule` si lo valida, asi que la
  // fila entraba a la base y despues reventaba al LEERLA — y como la
  // disponibilidad recorre a todos los barberos en paralelo, un solo tramo
  // invalido dejaba sin horarios a TODO el local, no solo a ese barbero.
  // Se rechaza en el borde, que es donde se puede explicar el error.
  it('rechaza un tramo cuyo cierre no es posterior a la apertura, sin llegar al repositorio', async () => {
    const response = await withSession(
      request(app.getHttpServer()).put('/panel/barbers/week-barber-4/schedule/week'),
      OWNER_SESSION,
    ).send({ schedule: [{ dayOfWeek: 1, opensAt: '13:00', closesAt: '00:00' }] });

    expect(response.status).toBe(400);
    expect(await schedules.listBarberSchedule('week-barber-4')).toHaveLength(0);
  });

  it('rechaza tambien por el endpoint de un solo dia', async () => {
    const response = await withSession(
      request(app.getHttpServer()).put('/panel/barbers/day-barber-invalid/schedule'),
      OWNER_SESSION,
    ).send({ dayOfWeek: 2, opensAt: '18:00', closesAt: '18:00' });

    expect(response.status).toBe(400);
    expect(await schedules.listBarberSchedule('day-barber-invalid')).toHaveLength(0);
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

// Migración 0013 — el dueño pidió poder reactivar a un barbero de baja
// temporal sin reconfigurar el horario, y poder eliminar a un barbero que
// nunca llegó a trabajar. Estas cuatro rutas nuevas viven bajo el mismo
// permiso `barber:manage` que el resto de este controller.
describe('Panel: baja temporal, baja definitiva y eliminar (App Nest levantada en memoria)', () => {
  let app: INestApplication;
  let barbers: FakeBarberRepository;
  let staffAccounts: FakeStaffAccountRepository;

  beforeAll(async () => {
    barbers = new FakeBarberRepository();
    staffAccounts = new FakeStaffAccountRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(CLIENT_REPOSITORY)
      .useValue(new FakeClientRepository())
      .overrideProvider(BARBER_REPOSITORY)
      .useValue(barbers)
      .overrideProvider(SCHEDULE_REPOSITORY)
      .useValue(new FakeScheduleRepository())
      .overrideProvider(SERVICE_REPOSITORY)
      .useValue(new FakeServiceRepository())
      .overrideProvider(STAFF_ACCOUNT_REPOSITORY)
      .useValue(staffAccounts)
      .overrideProvider(AUTH_CHALLENGE_REPOSITORY)
      .useValue(new FakeAuthChallengeRepository())
      .overrideProvider(NOTIFICATION_OUTBOX_REPOSITORY)
      .useValue(new FakeNotificationOutboxRepository())
      .overrideProvider(CLOCK)
      .useValue(new FakeClock(-180, new FakeClock().parseInstant('2026-09-01T12:00:00.000Z')))
      .overrideProvider(APPOINTMENT_REPOSITORY)
      .useValue(new FakeAppointmentRepository())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('GET /panel/barbers lists every barber, active or not, with canDelete', async () => {
    await barbers.create(createBarber({ id: 'gb-1', name: 'Activo', active: true }));
    await barbers.create(createBarber({ id: 'gb-2', name: 'Con Historial', active: false }));
    barbers.seedHasAppointments('gb-2');

    const response = await withSession(request(app.getHttpServer()).get('/panel/barbers'), OWNER_SESSION);

    expect(response.status).toBe(200);
    expect(response.body.barbers).toEqual(
      expect.arrayContaining([
        { id: 'gb-1', name: 'Activo', active: true, permanentLeave: false, canDelete: true },
        { id: 'gb-2', name: 'Con Historial', active: false, permanentLeave: false, canDelete: false },
      ]),
    );
  });

  it('MUST reject the secretary listing barbers for management — barber:manage is owner-only', async () => {
    const response = await withSession(request(app.getHttpServer()).get('/panel/barbers'), SECRETARY_SESSION);

    expect(response.status).toBe(403);
  });

  it('reactiva a un barbero dado de baja', async () => {
    await barbers.create(createBarber({ id: 'react-1', name: 'De Baja', active: true }));
    await barbers.deactivate('react-1');

    const response = await withSession(
      request(app.getHttpServer()).post('/panel/barbers/react-1/reactivate'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reactivated: true });
    expect(await barbers.findById('react-1')).toMatchObject({ active: true, permanentLeave: false });
  });

  it('404 al reactivar un barbero que no existe, nunca un 500', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/panel/barbers/no-existe/reactivate'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(404);
  });

  it('da de baja definitiva a un barbero y le borra la cuenta', async () => {
    await barbers.create(createBarber({ id: 'term-1', name: 'Se Fue', active: true }));
    const account = await staffAccounts.create({ email: 'sefue@jc.test', role: 'barber', barberId: 'term-1' });

    const response = await withSession(
      request(app.getHttpServer()).post('/panel/barbers/term-1/terminate'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ terminated: true });
    expect(await barbers.findById('term-1')).toMatchObject({ active: false, permanentLeave: true });
    expect(await staffAccounts.findById(account.id)).toBeNull();
  });

  it('404 al dar de baja definitiva a un barbero que no existe', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/panel/barbers/no-existe/terminate'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(404);
  });

  it('elimina a un barbero sin turnos', async () => {
    await barbers.create(createBarber({ id: 'del-1', name: 'Nunca Trabajo', active: true }));

    const response = await withSession(request(app.getHttpServer()).delete('/panel/barbers/del-1'), OWNER_SESSION);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: true });
    expect(await barbers.findById('del-1')).toBeNull();
  });

  it('404 al eliminar un barbero que no existe', async () => {
    const response = await withSession(
      request(app.getHttpServer()).delete('/panel/barbers/no-existe'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(404);
  });

  // El mensaje explica QUE hacer en su lugar — un 409 explicable, no un
  // callejon sin salida.
  it('409, y NO un 500, al intentar eliminar un barbero con turnos en el historial', async () => {
    await barbers.create(createBarber({ id: 'del-2', name: 'Con Turnos', active: true }));
    barbers.seedHasAppointments('del-2');

    const response = await withSession(request(app.getHttpServer()).delete('/panel/barbers/del-2'), OWNER_SESSION);

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/baja definitiva/i);
    expect(await barbers.findById('del-2')).not.toBeNull();
  });

  it('MUST reject the secretary deleting a barber — barber:manage is owner-only', async () => {
    await barbers.create(createBarber({ id: 'del-3', name: 'Protegido', active: true }));

    const response = await withSession(request(app.getHttpServer()).delete('/panel/barbers/del-3'), SECRETARY_SESSION);

    expect(response.status).toBe(403);
    expect(await barbers.findById('del-3')).not.toBeNull();
  });
});
