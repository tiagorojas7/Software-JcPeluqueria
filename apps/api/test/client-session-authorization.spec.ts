import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeClientContextRepository,
  FakeClock,
  FakeHoldExpireScheduler,
  type ClientContext,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CurrentClient } from '../src/access-control/decorators/current-client.decorator';
import { RequiresClientSession } from '../src/access-control/decorators/requires-client-session.decorator';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { ACTOR_CONTEXT_REPOSITORY, CLIENT_CONTEXT_REPOSITORY } from '../src/access-control/tokens';
import { HOLD_EXPIRE_SCHEDULER } from '../src/booking/tokens';
import { AppModule } from '../src/app.module';

// A throwaway clock only to build a fixed `sessionExpiresAt` fixture — never
// the one any production code reads (same pattern every other spec in this
// suite establishes for date fixtures).
const dateBuilder = new FakeClock();
const SESSION_EXPIRES_AT = dateBuilder.localTimeToUtc('2026-09-01', '12:00');

// cuenta-cliente-persistente: `sessionExpiresAt` here is a FIXED fixture
// value the fake simply echoes back — `FakeClientContextRepository` does
// not implement the real half-life renewal (same posture
// `FakeAuthChallengeRepository` already takes for its own time-dependent
// branch: that guarantee is proven only against the real Postgres adapter's
// Testcontainers suite, `client-context.repository.spec.ts`).

// cablear-el-mvp Slice C (C.4): the client-session counterpart of
// `apps/api/test/authorization.contract.spec.ts` — proves
// `PermissionsGuard`'s `@RequiresClientSession()` branch end to end through a
// real, in-memory Nest application, the same "App Nest levantada en memoria"
// harness that file already established for the role-based branch. Kept as
// its own file rather than extending that one: this is a genuinely new
// route classification, not another row on the existing
// ThreatMatrixController route × role matrix (which is scoped to
// `ActorContext`/role, a shape a client structurally never has).
const CLIENT_SESSION = 'client-session-fixture';
const OTHER_CLIENT_SESSION = 'client-session-other';

const clientContexts = new FakeClientContextRepository();
clientContexts.seed(CLIENT_SESSION, { userId: 'user-client-1', clientId: 'client-1', sessionExpiresAt: SESSION_EXPIRES_AT });
clientContexts.seed(OTHER_CLIENT_SESSION, { userId: 'user-client-2', clientId: 'client-2', sessionExpiresAt: SESSION_EXPIRES_AT });

function withSession(req: request.Test, sessionId?: string): request.Test {
  return sessionId ? req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`) : req;
}

// Test-only controller, mounted only inside this spec's testing module —
// never registered on the real AppModule. Exercises the guard branch plus
// `@CurrentClient()`'s narrowing (never the request body/query) end to end.
@Controller('client-fixture')
class ClientFixtureController {
  @RequiresClientSession()
  @Get('whoami')
  whoami(@CurrentClient() client: ClientContext): ClientContext {
    return client;
  }
}

@Module({ controllers: [ClientFixtureController] })
class ClientFixtureModule {}

describe('client-session authorization contract — @RequiresClientSession() (App Nest levantada en memoria)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ClientFixtureModule],
    })
      .overrideProvider(CLIENT_CONTEXT_REPOSITORY)
      .useValue(clientContexts)
      // ActorContextMiddleware runs on EVERY route unconditionally (it has
      // no way to know in advance a route only needs a client session), so
      // even this client-only fixture needs a working ActorContextRepository
      // whenever a session cookie is present — otherwise it reaches for the
      // real, absent Postgres connection and 500s before the guard ever runs.
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(new FakeActorContextRepository())
      // Every Nest test that builds the full AppModule must override this —
      // an eager HOLD_EXPIRE_SCHEDULER provider reaches for pg-boss at
      // module-graph construction time and hangs the whole suite (see
      // BookingModule's own doc comment on why the real provider is
      // lazy/synchronous instead).
      .overrideProvider(HOLD_EXPIRE_SCHEDULER)
      .useValue(new FakeHoldExpireScheduler())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects an anonymous request with 403 — deny by default applies to client routes too', async () => {
    const response = await request(app.getHttpServer()).get('/client-fixture/whoami');

    expect(response.status).toBe(403);
  });

  it('rejects a session cookie that does not resolve to any client with 403', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/client-fixture/whoami'),
      'not-a-real-session',
    );

    expect(response.status).toBe(403);
  });

  it('lets an authenticated client through, and narrows @CurrentClient() to exactly their own identity', async () => {
    const response = await withSession(request(app.getHttpServer()).get('/client-fixture/whoami'), CLIENT_SESSION);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: 'user-client-1',
      clientId: 'client-1',
      sessionExpiresAt: SESSION_EXPIRES_AT.toISOString(),
    });
  });

  it('resolves a DIFFERENT client session to that client’s own identity, never a cached previous one', async () => {
    const response = await withSession(
      request(app.getHttpServer()).get('/client-fixture/whoami'),
      OTHER_CLIENT_SESSION,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: 'user-client-2',
      clientId: 'client-2',
      sessionExpiresAt: SESSION_EXPIRES_AT.toISOString(),
    });
  });
});
