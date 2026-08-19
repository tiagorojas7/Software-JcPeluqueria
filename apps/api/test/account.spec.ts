import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeAppointmentRepository,
  FakeClientContextRepository,
  FakeClock,
  FakeHoldExpireScheduler,
  FakePaymentPort,
  type Appointment,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import { ACTOR_CONTEXT_REPOSITORY, CLIENT_CONTEXT_REPOSITORY } from '../src/access-control/tokens';
import { HOLD_EXPIRE_SCHEDULER } from '../src/booking/tokens';
import { APPOINTMENT_REPOSITORY, CLOCK, PAYMENT_PORT } from '../src/identity/tokens';
import { AppModule } from '../src/app.module';

// cablear-el-mvp Slice C (C.3/C.4): "Mi cuenta" — the client's own
// appointments and self-service cancellation, reached exclusively through a
// resolved client session (`@RequiresClientSession()`/`@CurrentClient()`),
// never through the request body/query. Mirrors the "App Nest levantada en
// memoria" harness `client-session-authorization.spec.ts` already
// established, over the REAL production controller this time.

const clientContexts = new FakeClientContextRepository();
const appointments = new FakeAppointmentRepository();
const paymentPort = new FakePaymentPort();
// `new Date(...)` is off-limits outside `ShopClock`/`FakeClock` (the
// repo-wide Clock-only ESLint rule) — `FakeClock.parseInstant` builds the
// fixed `now` instant instead, so this file never constructs one directly.
const clock = new FakeClock(-180, new FakeClock().parseInstant('2026-09-01T12:00:00.000Z'));
const at = (time: string) => clock.localTimeToUtc('2026-09-01', time);

let sessionCounter = 0;
/** One fresh session per call — tests never share a client identity, so no
 *  test's own appointments can leak into another test's assertions even
 *  though `appointments`/`clientContexts` are never reset between tests
 *  (same "unique key per test, no shared-state reset" posture
 *  `client-access.spec.ts` already established with unique phone numbers). */
function newClientSession(): { sessionId: string; clientId: string } {
  const n = sessionCounter++;
  const sessionId = `account-session-${n}`;
  const clientId = `account-client-${n}`;
  clientContexts.seed(sessionId, { userId: `account-user-${n}`, clientId });
  return { sessionId, clientId };
}

function withSession(req: request.Test, sessionId?: string): request.Test {
  return sessionId ? req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`) : req;
}

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: at('14:00'), end: at('14:30') },
    status: 'reservado',
    deposit: { kind: 'settled', paymentId: 'pay-1', amountCents: 500000 },
    ...overrides,
  };
}

describe('GET /account/appointments + POST /account/appointments/:id/cancel (C.3/C.4)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENT_CONTEXT_REPOSITORY)
      .useValue(clientContexts)
      // ActorContextMiddleware runs on every route unconditionally — even a
      // client-only route needs a working ActorContextRepository whenever a
      // session cookie is present, same reason every other client-session
      // spec in this suite overrides it too.
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(new FakeActorContextRepository())
      .overrideProvider(HOLD_EXPIRE_SCHEDULER)
      .useValue(new FakeHoldExpireScheduler())
      .overrideProvider(APPOINTMENT_REPOSITORY)
      .useValue(appointments)
      .overrideProvider(PAYMENT_PORT)
      .useValue(paymentPort)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /account/appointments', () => {
    it('rejects an anonymous request with 403 — deny by default applies here too', async () => {
      const response = await request(app.getHttpServer()).get('/account/appointments');

      expect(response.status).toBe(403);
    });

    it('returns only the authenticated client’s own appointments, never another client’s', async () => {
      const mine = newClientSession();
      const other = newClientSession();
      appointments.seed(buildAppointment({ id: `mine-${mine.clientId}`, clientId: mine.clientId }));
      appointments.seed(buildAppointment({ id: `other-${other.clientId}`, clientId: other.clientId }));

      const response = await withSession(
        request(app.getHttpServer()).get('/account/appointments'),
        mine.sessionId,
      );

      expect(response.status).toBe(200);
      expect(response.body.appointments.map((a: { id: string }) => a.id)).toEqual([`mine-${mine.clientId}`]);
    });

    it('returns an empty list for a client with no appointments, never an error', async () => {
      const fresh = newClientSession();

      const response = await withSession(
        request(app.getHttpServer()).get('/account/appointments'),
        fresh.sessionId,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ appointments: [] });
    });
  });

  describe('POST /account/appointments/:id/cancel', () => {
    it('rejects an anonymous request with 403', async () => {
      const response = await request(app.getHttpServer()).post('/account/appointments/appt-1/cancel');

      expect(response.status).toBe(403);
    });

    it('cancels and triggers the automatic refund when more than 1 hour remains', async () => {
      const owner = newClientSession();
      const appointmentId = `cancel-ok-${owner.clientId}`;
      appointments.seed(buildAppointment({ id: appointmentId, clientId: owner.clientId }));
      const refundsBefore = paymentPort.refundCalls.length;

      const response = await withSession(
        request(app.getHttpServer()).post(`/account/appointments/${appointmentId}/cancel`),
        owner.sessionId,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        outcome: 'cancelled',
        appointment: expect.objectContaining({ id: appointmentId, status: 'cancelado' }),
      });
      // "sin aprobación manual": the refund is part of cancelling, never a
      // second step someone has to remember to trigger.
      expect(paymentPort.refundCalls.length).toBe(refundsBefore + 1);
      expect(paymentPort.refundCalls.at(-1)).toEqual({ paymentId: 'pay-1', amountCents: 500000 });
    });

    it('rejects with the cutoff instant when less than 1 hour remains, without touching the appointment or the money', async () => {
      const owner = newClientSession();
      const appointmentId = `cancel-late-${owner.clientId}`;
      appointments.seed(
        buildAppointment({
          id: appointmentId,
          clientId: owner.clientId,
          // `now` is fixed at UTC 12:00 (see `clock` above) — a Date
          // comparison is an absolute-instant comparison, never a
          // local-wall-clock one, so the fixture's start must be picked
          // relative to THAT instant, not to a "12:30 looks late" intuition.
          // Local 09:30 = UTC 12:30 (this shop's fixed -03:00 offset): only
          // 30 minutes after `now`, inside the 60-minute cutoff.
          timeRange: { start: at('09:30'), end: at('10:00') },
        }),
      );
      const refundsBefore = paymentPort.refundCalls.length;

      const response = await withSession(
        request(app.getHttpServer()).post(`/account/appointments/${appointmentId}/cancel`),
        owner.sessionId,
      );

      expect(response.status).toBe(200);
      // Cutoff = start (local 09:30 = UTC 12:30) minus 60 minutes = local
      // 08:30 = UTC 11:30.
      expect(response.body).toEqual({ outcome: 'too-late', cutoff: at('08:30').toISOString() });
      expect(paymentPort.refundCalls.length).toBe(refundsBefore);
    });

    it('answers "not-yours" for someone else’s appointment, identically to a missing one — no oracle', async () => {
      const owner = newClientSession();
      const prober = newClientSession();
      const appointmentId = `cancel-foreign-${owner.clientId}`;
      appointments.seed(buildAppointment({ id: appointmentId, clientId: owner.clientId }));

      const foreign = await withSession(
        request(app.getHttpServer()).post(`/account/appointments/${appointmentId}/cancel`),
        prober.sessionId,
      );
      const missing = await withSession(
        request(app.getHttpServer()).post(`/account/appointments/no-existe-${prober.clientId}/cancel`),
        prober.sessionId,
      );

      expect(foreign.status).toBe(200);
      expect(foreign.body).toEqual({ outcome: 'not-yours' });
      expect(missing.body).toEqual(foreign.body);
    });
  });
});
