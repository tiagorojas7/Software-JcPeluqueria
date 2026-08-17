import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakeClock, FakeHoldExpireScheduler, FakeHoldRepository, SlotUnavailableError } from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { CLOCK, HOLD_EXPIRE_SCHEDULER, HOLD_REPOSITORY } from '../src/booking/tokens';

// 9.3 RED — derived from specs/client-booking/spec.md, not from an
// implementation:
//
//   "Reserva web con seña obligatoria del 50%" (Scenario "Reserva confirmada
//   con seña cobrada"): "GIVEN un horario retenido y los datos de cuenta
//   completos" — a hold is the precondition every later step in the web flow
//   builds on. Picking a free schedule (9.1/9.2) must be able to turn into a
//   hold, `channel: 'web'`, with NO client identified yet
//   ("Exploración sin cuenta" — the account only exists at confirmation,
//   task 9.7/9.8), reusing `CreateHold` (task 2.8) rather than a new insert
//   path.

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-07', time);
const clock = new FakeClock(-180, at('09:00'));

function withSession(req: request.Test): request.Test {
  return req; // deliberately never sets a session cookie — anonymous caller
}

describe('POST /holds (App Nest levantada en memoria)', () => {
  let app: INestApplication;
  let holds: FakeHoldRepository;

  beforeAll(async () => {
    holds = new FakeHoldRepository();
    const scheduler = new FakeHoldExpireScheduler();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HOLD_REPOSITORY)
      .useValue(holds)
      .overrideProvider(HOLD_EXPIRE_SCHEDULER)
      .useValue(scheduler)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('creates a web hold with no client identified yet, reachable by an anonymous caller', async () => {
    const response = await withSession(
      request(app.getHttpServer()).post('/holds').send({
        barberId: 'aaaaaaaa-0000-4000-8000-000000000001',
        serviceId: 'bbbbbbbb-0000-4000-8000-000000000002',
        calendarDate: '2026-09-07',
        startTime: '10:00',
        endTime: '10:30',
      }),
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ holdId: expect.any(String), expiresAt: '2026-09-07T12:15:00.000Z' });
    expect(holds.createCalls).toHaveLength(1);
    expect(holds.createCalls[0]?.hold).toMatchObject({ channel: 'web', clientId: null });
  });

  it('translates a taken slot into 409 with alternatives, never a raw 500', async () => {
    const conflicting = new FakeHoldRepository();
    vi.spyOn(conflicting, 'create').mockRejectedValueOnce(
      new SlotUnavailableError([{ start: at('11:00'), end: at('11:30') }]),
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HOLD_REPOSITORY)
      .useValue(conflicting)
      .overrideProvider(HOLD_EXPIRE_SCHEDULER)
      .useValue(new FakeHoldExpireScheduler())
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    const conflictApp = moduleRef.createNestApplication();
    await conflictApp.init();

    const response = await request(conflictApp.getHttpServer()).post('/holds').send({
      barberId: 'aaaaaaaa-0000-4000-8000-000000000001',
      serviceId: 'bbbbbbbb-0000-4000-8000-000000000002',
      calendarDate: '2026-09-07',
      startTime: '10:00',
      endTime: '10:30',
    });

    expect(response.status).toBe(409);
    expect(response.body.alternatives).toEqual([
      { start: '2026-09-07T14:00:00.000Z', end: '2026-09-07T14:30:00.000Z' },
    ]);

    await conflictApp.close();
  });
});
