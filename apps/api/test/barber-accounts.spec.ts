import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createBarber,
  FakeActorContextRepository,
  FakeAuthChallengeRepository,
  FakeBarberRepository,
  FakeClientRepository,
  FakeClock,
  FakeNotificationOutboxRepository,
  FakePasswordHasher,
  FakeRolePermissionRepository,
  FakeScheduleRepository,
  FakeServiceRepository,
  FakeStaffAccountRepository,
  FakeUserCredentialsRepository,
  type Permission,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { AppModule } from '../src/app.module';
import {
  AUTH_CHALLENGE_REPOSITORY as IDENTITY_AUTH_CHALLENGE_REPOSITORY,
  PASSWORD_HASHER,
  USER_CREDENTIALS_REPOSITORY,
} from '../src/identity/tokens';
import {
  AUTH_CHALLENGE_REPOSITORY as PANEL_AUTH_CHALLENGE_REPOSITORY,
  BARBER_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK as PANEL_CLOCK,
  NOTIFICATION_OUTBOX_REPOSITORY as PANEL_OUTBOX,
  SCHEDULE_REPOSITORY,
  SERVICE_REPOSITORY,
  STAFF_ACCOUNT_REPOSITORY,
} from '../src/panel/tokens';

// README section 3.9, "Perfil del barbero": *"Cada barbero tiene su perfil.
// No es opcional: es la puerta por la que entra al sistema."* — plus the shop
// owner's own framing: *"la cuenta de cada barbero y tener todo el control
// sobre las cuentas para que ingresen, contraseña, etc."*
//
// The alta used to write `barbers` + `barber_schedules` and stop there: the
// person appeared in the agenda and in public availability with no `users`
// row at all, so there was nothing to log in as. This suite proves the whole
// chain at the HTTP boundary — alta creates the account and mails the invite,
// the owner (and ONLY the owner) can re-send it and switch access on and off,
// and the invite's link actually sets a password at the other end.
//
// The one thing it also proves is a NEGATIVE: no route here carries a
// password in either direction. The owner's control stops at the account.

const OWNER_SESSION = 'session-owner';
const SECRETARY_SESSION = 'session-secretary';

const actorContexts = new FakeActorContextRepository();
actorContexts.seed(OWNER_SESSION, { userId: 'owner-user-id', role: 'owner' });
actorContexts.seed(SECRETARY_SESSION, { userId: 'secretary-user-id', role: 'secretary' });

// The exact 3b split this feature depends on: `barber:manage` is owner-only,
// which is what keeps the secretary out of the accounts screen even though
// she manages clients and turnos all day.
const rolePermissions = new FakeRolePermissionRepository(
  new Map([
    ['owner', new Set<Permission>(['client:manage', 'barber:manage', 'schedule:configure', 'pricing:configure'])],
    ['secretary', new Set<Permission>(['client:manage'])],
  ]),
);

function withSession(req: request.Test, sessionId: string): request.Test {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`);
}

const A_WEEK = [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }];

describe('Panel: cuentas de barberos (App Nest levantada en memoria)', () => {
  let app: INestApplication;
  let staffAccounts: FakeStaffAccountRepository;
  let outbox: FakeNotificationOutboxRepository;
  let credentials: FakeUserCredentialsRepository;
  let challenges: FakeAuthChallengeRepository;

  beforeAll(async () => {
    staffAccounts = new FakeStaffAccountRepository();
    outbox = new FakeNotificationOutboxRepository();
    credentials = new FakeUserCredentialsRepository();
    // ONE instance behind BOTH module tokens: the panel issues the challenge
    // and identity consumes it, and in production those are the same
    // `auth_challenges` table. Two separate fakes would let this suite pass
    // while the real invite link never opened.
    challenges = new FakeAuthChallengeRepository();

    const clock = new FakeClock(-180, new FakeClock().parseInstant('2026-09-01T12:00:00.000Z'));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROLE_PERMISSION_REPOSITORY)
      .useValue(rolePermissions)
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(actorContexts)
      .overrideProvider(CLIENT_REPOSITORY)
      .useValue(new FakeClientRepository())
      .overrideProvider(BARBER_REPOSITORY)
      .useValue(new FakeBarberRepository())
      .overrideProvider(SCHEDULE_REPOSITORY)
      .useValue(new FakeScheduleRepository())
      .overrideProvider(SERVICE_REPOSITORY)
      .useValue(new FakeServiceRepository())
      .overrideProvider(STAFF_ACCOUNT_REPOSITORY)
      .useValue(staffAccounts)
      .overrideProvider(PANEL_AUTH_CHALLENGE_REPOSITORY)
      .useValue(challenges)
      .overrideProvider(IDENTITY_AUTH_CHALLENGE_REPOSITORY)
      .useValue(challenges)
      .overrideProvider(PANEL_OUTBOX)
      .useValue(outbox)
      .overrideProvider(PANEL_CLOCK)
      .useValue(clock)
      .overrideProvider(USER_CREDENTIALS_REPOSITORY)
      .useValue(credentials)
      .overrideProvider(PASSWORD_HASHER)
      .useValue(new FakePasswordHasher())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  let nextEmail = 1;
  const anEmail = () => `barbero-${nextEmail++}@jc.test`;

  async function addBarber(email: string, name = 'Nuevo Barbero') {
    return withSession(request(app.getHttpServer()).post('/panel/barbers'), OWNER_SESSION).send({
      name,
      email,
      schedule: A_WEEK,
    });
  }

  beforeEach(() => {
    outbox.enqueued.length = 0;
  });

  it('el alta crea la cuenta del barbero y le manda la invitacion de activacion', async () => {
    const email = anEmail();

    const response = await addBarber(email, 'Con Cuenta');

    expect(response.status).toBe(201);
    const account = await staffAccounts.findByEmail(email);
    expect(account).toMatchObject({ role: 'barber', active: true, activated: false });
    expect(account!.barberId).toBe(response.body.id);
    expect(outbox.enqueued).toHaveLength(1);
    expect(outbox.enqueued[0]).toMatchObject({ notificationType: 'staff_activation', recipientEmail: email });
  });

  it('rechaza con 409 un alta cuyo email ya tiene cuenta, sin crear el barbero', async () => {
    const email = anEmail();
    await addBarber(email, 'Primero');
    outbox.enqueued.length = 0;

    const response = await addBarber(email, 'Segundo');

    expect(response.status).toBe(409);
    // Ni barbero a medio crear ni invitacion: el email se valida antes de
    // escribir nada.
    expect(outbox.enqueued).toEqual([]);
  });

  it('lista las cuentas para el dueno, con el estado de activacion de cada una', async () => {
    await addBarber(anEmail(), 'Listado');

    const response = await withSession(request(app.getHttpServer()).get('/panel/barber-accounts'), OWNER_SESSION);

    expect(response.status).toBe(200);
    expect(response.body.accounts.length).toBeGreaterThan(0);
    for (const account of response.body.accounts) {
      expect(account).toMatchObject({ activated: expect.any(Boolean), active: expect.any(Boolean) });
      // El control del dueno llega hasta la cuenta, nunca hasta la credencial.
      expect(Object.keys(account)).not.toContain('password');
      expect(Object.keys(account)).not.toContain('passwordHash');
    }
  });

  it('MUST rechazar a la secretaria en las tres rutas — barber:manage es solo del dueno', async () => {
    const listed = await withSession(request(app.getHttpServer()).get('/panel/barber-accounts'), SECRETARY_SESSION);
    const resent = await withSession(
      request(app.getHttpServer()).post('/panel/barber-accounts/whatever/resend-invite'),
      SECRETARY_SESSION,
    );
    const toggled = await withSession(
      request(app.getHttpServer()).post('/panel/barber-accounts/whatever/active'),
      SECRETARY_SESSION,
    ).send({ active: false });

    expect([listed.status, resent.status, toggled.status]).toEqual([403, 403, 403]);
  });

  it('rechaza a un anonimo — deny by default tambien aca', async () => {
    const response = await request(app.getHttpServer()).get('/panel/barber-accounts');

    expect(response.status).toBe(403);
  });

  it('reenvia la invitacion con un secreto nuevo, y el anterior deja de servir', async () => {
    const email = anEmail();
    await addBarber(email, 'Reenvio');
    const first = outbox.enqueued[0]!.payload;
    const account = await staffAccounts.findByEmail(email);

    const response = await withSession(
      request(app.getHttpServer()).post(`/panel/barber-accounts/${account!.id}/resend-invite`),
      OWNER_SESSION,
    );

    expect(response.status).toBe(200);
    expect(outbox.enqueued).toHaveLength(2);
    expect(outbox.enqueued[1]!.payload.token).not.toBe(first.token);

    // El enlace viejo ya no activa nada: `ChallengeService.issue` mata el
    // anterior antes de escribir el nuevo.
    const withOldLink = await request(app.getHttpServer()).post('/auth/activate-staff').send({
      challengeId: first.challengeId,
      secret: first.token,
      newPassword: 'una-contra-bien-larga',
    });
    expect(withOldLink.body).toEqual({ outcome: 'rejected' });
  });

  // El hueco que aparecio en la barberia real: seis barberos ya estaban
  // cargados de antes de que el alta creara cuentas. La pantalla listaba
  // CUENTAS, asi que esos seis no aparecian en la unica pagina que puede
  // darles acceso.
  it('lista tambien a los barberos sin cuenta, y los deja invitar', async () => {
    const barbers = app.get<FakeBarberRepository>(BARBER_REPOSITORY);
    await barbers.create(createBarber({ id: 'barber-de-antes', name: 'De Antes', active: true }));

    const listed = await withSession(request(app.getHttpServer()).get('/panel/barber-accounts'), OWNER_SESSION);
    const row = listed.body.accounts.find((a: { barberId: string }) => a.barberId === 'barber-de-antes');
    expect(row).toMatchObject({ userId: null, email: null, barberName: 'De Antes', activated: false });

    const email = anEmail();
    const invited = await withSession(request(app.getHttpServer()).post('/panel/barber-accounts'), OWNER_SESSION).send({
      barberId: 'barber-de-antes',
      email,
    });

    expect(invited.status).toBe(201);
    expect(outbox.enqueued).toContainEqual(expect.objectContaining({ notificationType: 'staff_activation', recipientEmail: email }));
  });

  it('409 al invitar a un barbero que ya tiene cuenta', async () => {
    const email = anEmail();
    const created = await addBarber(email, 'Ya Tiene');

    const response = await withSession(request(app.getHttpServer()).post('/panel/barber-accounts'), OWNER_SESSION).send({
      barberId: created.body.id,
      email: anEmail(),
    });

    expect(response.status).toBe(409);
  });

  it('404 al invitar a un barbero que no existe', async () => {
    const response = await withSession(request(app.getHttpServer()).post('/panel/barber-accounts'), OWNER_SESSION).send({
      barberId: '11111111-1111-4111-8111-111111111111',
      email: anEmail(),
    });

    expect(response.status).toBe(404);
  });

  it('404 al reenviar a una cuenta que no existe', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/panel/barber-accounts/no-existe/resend-invite'),
      OWNER_SESSION,
    );

    expect(response.status).toBe(404);
  });

  it('quita y devuelve el acceso sin tocar el barbero', async () => {
    const email = anEmail();
    await addBarber(email, 'Acceso');
    const account = await staffAccounts.findByEmail(email);

    const revoked = await withSession(
      request(app.getHttpServer()).post(`/panel/barber-accounts/${account!.id}/active`),
      OWNER_SESSION,
    ).send({ active: false });

    expect(revoked.status).toBe(200);
    expect((await staffAccounts.findById(account!.id))?.active).toBe(false);

    const restored = await withSession(
      request(app.getHttpServer()).post(`/panel/barber-accounts/${account!.id}/active`),
      OWNER_SESSION,
    ).send({ active: true });

    expect(restored.status).toBe(200);
    expect((await staffAccounts.findById(account!.id))?.active).toBe(true);
  });

  it('el enlace de la invitacion deja al barbero elegir su contrasena, y la guarda hasheada', async () => {
    const email = anEmail();
    await addBarber(email, 'Activa');
    const account = await staffAccounts.findByEmail(email);
    const invite = outbox.enqueued[0]!.payload;

    const response = await request(app.getHttpServer()).post('/auth/activate-staff').send({
      challengeId: invite.challengeId,
      secret: invite.token,
      newPassword: 'una-contra-bien-larga',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'activated' });
    const stored = credentials.setPasswordCalls.find((call) => call.userId === account!.id);
    expect(stored).toBeDefined();
    // What reached the repository went through the hasher first — the raw
    // plaintext never lands in the column. `FakePasswordHasher` marks its
    // output so that is observable here; the real argon2id derivation has
    // its own coverage in `argon2-password-hasher.spec.ts`.
    expect(stored!.passwordHash).not.toBe('una-contra-bien-larga');
    expect(stored!.passwordHash.startsWith('fake-hash:')).toBe(true);
  });

  it('una contrasena debil no quema el enlace — se puede reintentar con el mismo mail', async () => {
    const email = anEmail();
    await addBarber(email, 'Debil');
    const invite = outbox.enqueued[0]!.payload;

    const weak = await request(app.getHttpServer()).post('/auth/activate-staff').send({
      challengeId: invite.challengeId,
      secret: invite.token,
      newPassword: 'corta',
    });
    // Rebotada por el schema antes de llegar al dominio: el minimo es una
    // regla de negocio, y el navegador merece un mensaje por campo.
    expect(weak.status).toBe(400);

    const retry = await request(app.getHttpServer()).post('/auth/activate-staff').send({
      challengeId: invite.challengeId,
      secret: invite.token,
      newPassword: 'una-contra-bien-larga',
    });

    expect(retry.body).toEqual({ outcome: 'activated' });
  });
});
