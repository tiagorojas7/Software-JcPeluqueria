import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeAuthChallengeRepository,
  FakeClientAccountRepository,
  FakeClientRepository,
  FakeClock,
  FakeHoldExpireScheduler,
  FakeNotificationOutboxRepository,
  type Session,
  type SessionRepository,
} from '@jc-barberia/domain';
import type { ClientContext, ClientContextRepository } from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, CLIENT_CONTEXT_REPOSITORY } from '../src/access-control/tokens';
import { HOLD_EXPIRE_SCHEDULER } from '../src/booking/tokens';
import {
  AUTH_CHALLENGE_REPOSITORY,
  CLIENT_ACCOUNT_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  NOTIFICATION_OUTBOX_REPOSITORY,
  SESSION_REPOSITORY,
} from '../src/identity/tokens';
import { AppModule } from '../src/app.module';

/**
 * Combines `SessionRepository` + `ClientContextRepository` over ONE shared
 * map, scoped to this file only (never added to the shared domain Fakes):
 * `AuthController`'s client-login handler creates a session then IMMEDIATELY
 * resolves it back (the same "resolve right after minting" shape
 * `AuthController.login` already established for staff) — a session id is
 * only known AFTER `SessionService.create()` runs, so a plain
 * `FakeClientContextRepository.seed(sessionId, ...)` cannot pre-register it.
 * This mirrors exactly what `DrizzleClientContextRepository` does for real
 * (JOIN sessions -> users by userId), just over two in-memory maps instead
 * of one query.
 */
class InMemorySessionsAndClientContext implements SessionRepository, ClientContextRepository {
  private readonly sessions = new Map<string, Session>();
  private readonly clientIdByUserId = new Map<string, string>();

  seedClientAccount(userId: string, clientId: string): void {
    this.clientIdByUserId.set(userId, clientId);
  }

  async create(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(id);
      }
    }
  }

  async resolveBySessionId(sessionId: string): Promise<ClientContext | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    const clientId = this.clientIdByUserId.get(session.userId);
    return clientId ? { userId: session.userId, clientId, sessionExpiresAt: session.expiresAt } : null;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }
}

// `parseInstant` off a bare FakeClock instead of `new Date(...)`: the ESLint
// rule that bans direct Date construction applies to tests too, and FakeClock
// is the sanctioned way to derive an instant.
const clock = new FakeClock(-180, new FakeClock().parseInstant('2026-09-01T12:00:00.000Z'));

// cablear-el-mvp Slice C (C.1/C.2): client-booking spec, "Cuenta sin
// contraseña creada al final del flujo" + "Código de acceso vencido" — the
// full request-access -> login round trip, reading the plaintext code back
// from the SAME place a real deployment would (the outbox, "read the code
// from the log or straight from the DB").
describe('POST /auth/request-client-access + POST /auth/client-login (C.1/C.2)', () => {
  let app: INestApplication;
  let clients: FakeClientRepository;
  let accounts: FakeClientAccountRepository;
  let challenges: FakeAuthChallengeRepository;
  let outbox: FakeNotificationOutboxRepository;
  let sessionsAndClientContext: InMemorySessionsAndClientContext;

  beforeAll(async () => {
    clients = new FakeClientRepository();
    accounts = new FakeClientAccountRepository();
    challenges = new FakeAuthChallengeRepository();
    outbox = new FakeNotificationOutboxRepository();
    sessionsAndClientContext = new InMemorySessionsAndClientContext();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(CLIENT_REPOSITORY)
      .useValue(clients)
      .overrideProvider(CLIENT_ACCOUNT_REPOSITORY)
      .useValue(accounts)
      .overrideProvider(AUTH_CHALLENGE_REPOSITORY)
      .useValue(challenges)
      .overrideProvider(NOTIFICATION_OUTBOX_REPOSITORY)
      .useValue(outbox)
      .overrideProvider(CLIENT_CONTEXT_REPOSITORY)
      .useValue(sessionsAndClientContext)
      .overrideProvider(SESSION_REPOSITORY)
      .useValue(sessionsAndClientContext)
      // No real ActorContextRepository/Postgres in this harness — none of
      // these requests carry a pre-existing session cookie, so
      // ActorContextMiddleware never reaches for it, but every Nest test
      // building the full AppModule still overrides the DB-backed tokens it
      // does construct (see access-control's own contract spec for why).
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue({ resolveBySessionId: async () => null })
      .overrideProvider(HOLD_EXPIRE_SCHEDULER)
      .useValue(new FakeHoldExpireScheduler())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a malformed request-access body with 400', async () => {
    const response = await request(app.getHttpServer()).post('/auth/request-client-access').send({});

    expect(response.status).toBe(400);
  });

  it('answers {outcome:"requested"} for an UNKNOWN phone, identically to a known one — no oracle', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/request-client-access')
      .send({ phone: '+5493511111111' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'requested' });
    expect(outbox.enqueued).toHaveLength(0);
  });

  it('issues a challenge and enqueues the access code for a client with a registered web account', async () => {
    const client = await clients.create({ name: 'Ana', phone: '+5493512222222', email: 'ana@example.com', age: null });
    await accounts.create({ clientId: client.id, email: 'ana@example.com' });

    const response = await request(app.getHttpServer())
      .post('/auth/request-client-access')
      .send({ phone: '+5493512222222' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'requested' });
    expect(outbox.enqueued).toHaveLength(1);
    expect(outbox.enqueued[0]?.notificationType).toBe('client_access_code');
    expect(outbox.enqueued[0]?.recipientEmail).toBe('ana@example.com');
    expect(outbox.enqueued[0]?.payload.code).toMatch(/^\d{6}$/);
    expect(outbox.enqueued[0]?.payload.challengeId).toBeTruthy();
  });

  it('rejects a malformed client-login body with 400', async () => {
    const response = await request(app.getHttpServer()).post('/auth/client-login').send({ challengeId: 'not-a-uuid' });

    expect(response.status).toBe(400);
  });

  it('logs the client in with the code read back from the outbox, sets the session cookie, and returns their own clientId', async () => {
    const client = await clients.create({ name: 'Beto', phone: '+5493513333333', email: 'beto@example.com', age: null });
    const account = await accounts.create({ clientId: client.id, email: 'beto@example.com' });
    sessionsAndClientContext.seedClientAccount(account.id, client.id);

    await request(app.getHttpServer()).post('/auth/request-client-access').send({ phone: '+5493513333333' });
    const issued = outbox.enqueued.at(-1);
    const challengeId = issued?.payload.challengeId;
    const code = issued?.payload.code;
    expect(challengeId).toBeTruthy();
    expect(code).toBeTruthy();

    const response = await request(app.getHttpServer())
      .post('/auth/client-login')
      .send({ challengeId, secret: code });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'authenticated', clientId: client.id });
    const setCookie = response.headers['set-cookie'];
    expect(setCookie?.[0]).toMatch(/^session_id=/);

    // client-booking + session-service: client sessions slide for 30 days —
    // the exact TTL 3a.19 sets, never the 12h/8h staff windows.
    const sessionId = /session_id=([^;]+)/.exec(setCookie?.[0] ?? '')?.[1];
    const session = sessionId ? sessionsAndClientContext.get(sessionId) : undefined;
    expect(session).toBeDefined();
    const ttlMinutes = ((session?.expiresAt.getTime() ?? 0) - clock.now().getTime()) / 60_000;
    expect(ttlMinutes).toBe(30 * 24 * 60);
  });

  it('rejects the wrong code on a still-live challenge without killing it (retry is meaningful)', async () => {
    const client = await clients.create({ name: 'Cami', phone: '+5493514444444', email: 'cami@example.com', age: null });
    await accounts.create({ clientId: client.id, email: 'cami@example.com' });

    await request(app.getHttpServer()).post('/auth/request-client-access').send({ phone: '+5493514444444' });
    const challengeId = outbox.enqueued.at(-1)?.payload.challengeId;

    const response = await request(app.getHttpServer())
      .post('/auth/client-login')
      .send({ challengeId, secret: '000000' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'rejected' });
  });

  it('demands a fresh code once the challenge has expired — never lets the same one retry', async () => {
    const client = await clients.create({ name: 'Dani', phone: '+5493515555555', email: 'dani@example.com', age: null });
    await accounts.create({ clientId: client.id, email: 'dani@example.com' });

    await request(app.getHttpServer()).post('/auth/request-client-access').send({ phone: '+5493515555555' });
    const issued = outbox.enqueued.at(-1);
    const challengeId = issued?.payload.challengeId;
    const code = issued?.payload.code;
    if (challengeId) {
      challenges.expire(challengeId);
    }

    const response = await request(app.getHttpServer())
      .post('/auth/client-login')
      .send({ challengeId, secret: code });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'must-request-new-code', reason: 'expired' });
  });
});
