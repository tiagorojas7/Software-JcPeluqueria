import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeActorContextRepository,
  FakeAppointmentRepository,
  FakeClientContextRepository,
  FakeClock,
  FakeHoldRepository,
  FakePaymentPort,
  type Appointment,
  type Hold,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTOR_CONTEXT_REPOSITORY, CLIENT_CONTEXT_REPOSITORY } from '../src/access-control/tokens';
import { SESSION_COOKIE_NAME } from '../src/access-control/session-cookie';
import {
  APPOINTMENT_REPOSITORY,
  CLOCK,
  HOLD_REPOSITORY,
  PAYMENT_PORT,
} from '../src/absence-reassignment/tokens';
import { AppModule } from '../src/app.module';

// A throwaway FakeClock only to build fixed instants for test data — never
// the one injected into the module (same pattern every other spec in this
// suite already establishes).
const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-07', time);
const clock = new FakeClock(-180, at('09:45'));

function withSession(req: request.Test, sessionId?: string): request.Test {
  return sessionId ? req.set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`) : req;
}

let counter = 0;

function anOffer(overrides: Partial<Hold> = {}): Hold {
  const n = counter;
  return {
    id: `offer-hold-${n}`,
    barberId: 'barber-other',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: at('11:00'), end: at('11:30') },
    holdExpiresAt: at('10:15'),
    originOccupancyId: `origin-appointment-${n}`,
    ...overrides,
  };
}

function anOriginalAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: `origin-appointment-${counter}`,
    barberId: 'barber-absent',
    serviceId: 'service-1',
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'reservado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

// C.6 (cablear-el-mvp Slice C): the client's own accept/reject routes for a
// barber-absence-reassignment offer, reached from the offer link.
describe('POST /account/offers/:holdId/accept + POST /account/offers/:holdId/reject (C.6)', () => {
  let app: INestApplication;
  let holds: FakeHoldRepository;
  let appointments: FakeAppointmentRepository;
  const clientContexts = new FakeClientContextRepository();
  const OWNER_SESSION = 'offer-client-session';
  const OWNER_CLIENT_ID = 'client-1';
  const OTHER_SESSION = 'offer-other-client-session';
  clientContexts.seed(OWNER_SESSION, { userId: 'offer-user-1', clientId: OWNER_CLIENT_ID });
  clientContexts.seed(OTHER_SESSION, { userId: 'offer-user-2', clientId: 'client-2' });

  beforeAll(async () => {
    holds = new FakeHoldRepository();
    appointments = new FakeAppointmentRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENT_CONTEXT_REPOSITORY)
      .useValue(clientContexts)
      // ActorContextMiddleware runs on EVERY route unconditionally — even a
      // client-only route needs a working ActorContextRepository whenever a
      // session cookie is present, same reason every other client-session
      // spec in this suite overrides it too.
      .overrideProvider(ACTOR_CONTEXT_REPOSITORY)
      .useValue(new FakeActorContextRepository())
      .overrideProvider(HOLD_REPOSITORY)
      .useValue(holds)
      .overrideProvider(APPOINTMENT_REPOSITORY)
      .useValue(appointments)
      .overrideProvider(PAYMENT_PORT)
      .useValue(new FakePaymentPort())
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('POST /account/offers/:holdId/accept', () => {
    it('rejects an anonymous request with 403 — deny by default applies here too', async () => {
      const response = await request(app.getHttpServer()).post('/account/offers/whatever/accept');

      expect(response.status).toBe(403);
    });

    it('reassigns the original appointment to the offered barber/time for the offer’s own client', async () => {
      counter++;
      const offer = anOffer({ clientId: OWNER_CLIENT_ID });
      holds.seed(offer);
      appointments.seed(anOriginalAppointment());

      const response = await withSession(
        request(app.getHttpServer()).post(`/account/offers/${offer.id}/accept`),
        OWNER_SESSION,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ outcome: 'reassigned' });
      expect(appointments.updateScheduleCalls).toContainEqual({
        id: offer.originOccupancyId,
        change: { barberId: offer.barberId, serviceId: offer.serviceId, timeRange: offer.timeRange },
      });
    });

    it('answers "offer-expired" identically for someone else’s offer and for a missing one — no oracle', async () => {
      counter++;
      const offer = anOffer({ clientId: OWNER_CLIENT_ID });
      holds.seed(offer);
      appointments.seed(anOriginalAppointment());

      const foreign = await withSession(
        request(app.getHttpServer()).post(`/account/offers/${offer.id}/accept`),
        OTHER_SESSION,
      );
      const missing = await withSession(
        request(app.getHttpServer()).post('/account/offers/does-not-exist/accept'),
        OTHER_SESSION,
      );

      expect(foreign.status).toBe(200);
      expect(foreign.body).toEqual({ outcome: 'offer-expired' });
      expect(missing.body).toEqual(foreign.body);
      // The foreign client's probe must never have moved the appointment.
      expect(appointments.updateScheduleCalls).not.toContainEqual(
        expect.objectContaining({ id: offer.originOccupancyId }),
      );
    });

    it('answers "offer-expired" for an ordinary (non-offer) hold — originOccupancyId null', async () => {
      counter++;
      const ordinaryHold = anOffer({ clientId: OWNER_CLIENT_ID, originOccupancyId: null });
      holds.seed(ordinaryHold);

      const response = await withSession(
        request(app.getHttpServer()).post(`/account/offers/${ordinaryHold.id}/accept`),
        OWNER_SESSION,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ outcome: 'offer-expired' });
    });

    it('answers "offer-expired" for an offer past its own holdExpiresAt, even if the row is still physically there', async () => {
      counter++;
      const lapsedOffer = anOffer({ clientId: OWNER_CLIENT_ID, holdExpiresAt: at('09:00') }); // before `clock`'s fixed now (09:45)
      holds.seed(lapsedOffer);
      appointments.seed(anOriginalAppointment());

      const response = await withSession(
        request(app.getHttpServer()).post(`/account/offers/${lapsedOffer.id}/accept`),
        OWNER_SESSION,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ outcome: 'offer-expired' });
    });
  });

  describe('POST /account/offers/:holdId/reject', () => {
    it('rejects an anonymous request with 403', async () => {
      const response = await request(app.getHttpServer()).post('/account/offers/whatever/reject');

      expect(response.status).toBe(403);
    });

    it('cancels the original appointment for the offer’s own client', async () => {
      counter++;
      const offer = anOffer({ clientId: OWNER_CLIENT_ID });
      holds.seed(offer);
      appointments.seed(anOriginalAppointment());

      const response = await withSession(
        request(app.getHttpServer()).post(`/account/offers/${offer.id}/reject`),
        OWNER_SESSION,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        outcome: 'cancelled',
        appointment: expect.objectContaining({ id: offer.originOccupancyId, status: 'cancelado' }),
      });
    });

    it('answers "not-cancellable" identically for someone else’s offer and for a missing one — no oracle', async () => {
      counter++;
      const offer = anOffer({ clientId: OWNER_CLIENT_ID });
      holds.seed(offer);
      appointments.seed(anOriginalAppointment());

      const foreign = await withSession(
        request(app.getHttpServer()).post(`/account/offers/${offer.id}/reject`),
        OTHER_SESSION,
      );
      const missing = await withSession(
        request(app.getHttpServer()).post('/account/offers/does-not-exist/reject'),
        OTHER_SESSION,
      );

      expect(foreign.status).toBe(200);
      expect(foreign.body).toEqual({ outcome: 'not-cancellable' });
      expect(missing.body).toEqual(foreign.body);
      expect(appointments.updateStatusCalls).not.toContainEqual(
        expect.objectContaining({ id: offer.originOccupancyId }),
      );
    });
  });
});
