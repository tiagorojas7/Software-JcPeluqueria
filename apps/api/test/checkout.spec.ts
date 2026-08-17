import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createService,
  FakeClock,
  FakeHoldExpireScheduler,
  FakeHoldRepository,
  FakePaymentPort,
  FakeServiceRepository,
  type Hold,
} from '@jc-barberia/domain';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { CLOCK, HOLD_EXPIRE_SCHEDULER, HOLD_REPOSITORY, PAYMENT_PORT, SERVICE_REPOSITORY } from '../src/booking/tokens';

// 9.11 RED — derived from specs/client-booking/spec.md, not from an
// implementation:
//
//   "Reserva web con seña obligatoria del 50%" (Scenario "Reserva confirmada
//   con seña cobrada"):
//     GIVEN un horario retenido y los datos de cuenta completos
//     WHEN el cliente completa el pago del 50% por la pasarela de pago
//     THEN el turno pasa a estado `reservado`
//     AND queda asociada la seña cobrada al turno
//
//   Scenario "Falla el cobro de la seña":
//     GIVEN un horario retenido y los datos de cuenta completos
//     WHEN el pago de la seña es rechazado o no se completa
//     THEN el sistema MUST NOT crear el turno en estado `reservado`
//     AND el horario permanece sujeto a las reglas de expiración de slot-hold
//
// `CheckoutUseCase` (5.6) already proves the 50% math and the
// re-validate-then-charge order against fakes, and `DrizzleDepositRepository`
// (5.11/5.12) already proves the real `reservado`/`liberado` transitions
// against Postgres. What is new here — and genuinely untested until now — is
// the HTTP doorway nobody built: `POST /holds/checkout`, reusing that exact
// use case plus the real `ServiceRepository` (for the 50% base price) and the
// `PAYMENT_PORT` seam `apps/api/src/booking/tokens.ts` declared but nothing
// ever bound. No second payment path — this wires the existing one through.

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-07', time);
const clock = new FakeClock(-180, at('09:45'));

const SERVICE_ID = 'cccccccc-0000-4000-8000-000000000003';
const HOLD_ID = 'dddddddd-0000-4000-8000-000000000004';

function buildHold(): Hold {
  return {
    id: HOLD_ID,
    barberId: 'aaaaaaaa-0000-4000-8000-000000000001',
    serviceId: SERVICE_ID,
    clientId: 'client-1',
    channel: 'web',
    timeRange: { start: at('10:00'), end: at('10:30') },
    holdExpiresAt: at('10:15'),
  };
}

async function buildApp(beginCheckoutResult: boolean, paymentPort: FakePaymentPort = new FakePaymentPort()) {
  const holds = new FakeHoldRepository(true, beginCheckoutResult);
  holds.seed(buildHold());
  const services = new FakeServiceRepository();
  await services.create(
    createService({ id: SERVICE_ID, name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HOLD_REPOSITORY)
    .useValue(holds)
    .overrideProvider(SERVICE_REPOSITORY)
    .useValue(services)
    .overrideProvider(PAYMENT_PORT)
    .useValue(paymentPort)
    .overrideProvider(HOLD_EXPIRE_SCHEDULER)
    .useValue(new FakeHoldExpireScheduler())
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, holds, paymentPort };
}

describe('POST /holds/checkout (App Nest levantada en memoria)', () => {
  it('cobra exactamente el 50% del precio de lista y reenvia el initPoint de la pasarela', async () => {
    const paymentPort = new FakePaymentPort();
    const { app, holds } = await buildApp(true, paymentPort);

    const response = await request(app.getHttpServer()).post('/holds/checkout').send({ holdId: HOLD_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      outcome: 'created',
      initPoint: 'https://mercadopago.example/fake-preference-1',
    });
    expect(paymentPort.createPreferenceCalls).toEqual([
      { externalReference: HOLD_ID, amountCents: 250000, description: 'Corte clasico' },
    ]);
    expect(holds.beginCheckoutCalls).toEqual([{ holdId: HOLD_ID, paymentExpiresAt: at('10:00') }]);

    await app.close();
  });

  it('MUST NOT crear el turno reservado cuando el hold ya no esta vivo — nunca llega a cobrar', async () => {
    const paymentPort = new FakePaymentPort();
    const { app } = await buildApp(false, paymentPort);

    const response = await request(app.getHttpServer()).post('/holds/checkout').send({ holdId: HOLD_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'hold-expired' });
    // The core of "Falla el cobro de la seña": nothing here ever asks
    // MercadoPago to charge anything, so the slot stays exactly where
    // `beginCheckout`'s own atomic re-validation left it — subject to
    // slot-hold's ordinary expiry rules, never a second, ad-hoc release path.
    expect(paymentPort.createPreferenceCalls).toEqual([]);

    await app.close();
  });

  it('rejects malformed input with 400 before ever touching the hold', async () => {
    const { app, holds, paymentPort } = await buildApp(true);

    const response = await request(app.getHttpServer()).post('/holds/checkout').send({});

    expect(response.status).toBe(400);
    expect(holds.beginCheckoutCalls).toEqual([]);
    expect(paymentPort.createPreferenceCalls).toEqual([]);

    await app.close();
  });

  it('is public — reachable with no session cookie, proving PermissionsGuard does not block it', async () => {
    const { app } = await buildApp(true);

    const response = await request(app.getHttpServer()).post('/holds/checkout').send({ holdId: HOLD_ID });

    expect(response.status).not.toBe(403);

    await app.close();
  });
});
