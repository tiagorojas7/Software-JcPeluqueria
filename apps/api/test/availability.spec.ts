import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FakeBarberRepository,
  FakeClock,
  FakeFreeRangesQuery,
  FakeScheduleRepository,
  FakeServiceRepository,
  createBarber,
  createBarberSchedule,
  createService,
  createShopHours,
} from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import {
  BARBER_REPOSITORY,
  CLOCK,
  FREE_RANGES_QUERY,
  SCHEDULE_REPOSITORY,
  SERVICE_REPOSITORY,
} from '../src/booking/tokens';

// 9.1 RED (app-level) — derived from specs/client-booking/spec.md:
//
//   "Exploración sin cuenta": GIVEN a visitor with no account WHEN they
//   consult available schedules for a service THEN the system shows the free
//   schedules without asking for registration.
//
// This proves the endpoint end to end through a real Nest application, with
// NO session cookie set anywhere in this file — the request that matters
// most here is the one nobody logs in for.

// A throwaway FakeClock only to build the fixed instants below; the app gets
// `clock`, whose `now` sits before the seeded Monday opens — the endpoint only
// offers start times still ahead, and this file is about the anonymous access,
// not about the time of day.
const dateBuilder = new FakeClock();
const clock = new FakeClock(-180, dateBuilder.localTimeToUtc('2026-09-07', '00:00'));
const BARBER_ID = 'aaaaaaaa-0000-4000-8000-000000000009';
const SERVICE_ID = 'bbbbbbbb-0000-4000-8000-000000000009';

const barbers = new FakeBarberRepository();
const services = new FakeServiceRepository();
const schedules = new FakeScheduleRepository();
const freeRanges = new FakeFreeRangesQuery();

describe('GET /availability (App Nest levantada en memoria)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await barbers.create(createBarber({ id: BARBER_ID, name: 'Juan', active: true }));
    await services.create(createService({ id: SERVICE_ID, name: 'Corte', durationMinutes: 30, priceCents: 500000 }));
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));
    await schedules.createBarberSchedule(
      createBarberSchedule({ barberId: BARBER_ID, dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }),
    );
    freeRanges.seed(BARBER_ID, [
      { start: clock.localTimeToUtc('2026-09-07', '09:00'), end: clock.localTimeToUtc('2026-09-07', '10:00') },
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BARBER_REPOSITORY)
      .useValue(barbers)
      .overrideProvider(SERVICE_REPOSITORY)
      .useValue(services)
      .overrideProvider(SCHEDULE_REPOSITORY)
      .useValue(schedules)
      .overrideProvider(FREE_RANGES_QUERY)
      .useValue(freeRanges)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('returns free slots to a request carrying no session cookie at all', async () => {
    const response = await request(app.getHttpServer())
      .get('/availability')
      .query({ barberId: BARBER_ID, serviceId: SERVICE_ID, date: '2026-09-07' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      slots: [
        { startsAt: '2026-09-07T12:00:00.000Z', endsAt: '2026-09-07T12:30:00.000Z' },
        { startsAt: '2026-09-07T12:30:00.000Z', endsAt: '2026-09-07T13:00:00.000Z' },
      ],
    });
  });

  it('rejects a malformed query with 400, never 500 — an anonymous caller cannot crash the endpoint', async () => {
    const response = await request(app.getHttpServer()).get('/availability').query({ barberId: 'not-a-uuid' });

    expect(response.status).toBe(400);
  });
});
