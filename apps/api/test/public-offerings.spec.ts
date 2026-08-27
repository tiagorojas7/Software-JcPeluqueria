import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakeBarberRepository, FakeServiceRepository, createBarber, createService } from '@jc-barberia/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { BARBER_REPOSITORY, SERVICE_REPOSITORY } from '../src/booking/tokens';

// datos-reales-en-ui RED (app-level) — the owner's bug report end to end:
// he deactivated Facundo Díaz through the panel and the public site kept
// listing him; he created "roberto carlos" and the site never showed him;
// he changed a service price and the site kept the old number. Both new
// public endpoints prove, through a real Nest application with NO session
// cookie set anywhere in this file, that a deactivated barber never
// reaches the wire and a service's real priceCents always does.

const barbers = new FakeBarberRepository();
const services = new FakeServiceRepository();

const ACTIVE_BARBER_ID = 'aaaaaaaa-0000-4000-8000-000000000010';
const DEACTIVATED_BARBER_ID = 'aaaaaaaa-0000-4000-8000-000000000011';
const SERVICE_ID = 'bbbbbbbb-0000-4000-8000-000000000010';

describe('GET /barbers, GET /services (App Nest levantada en memoria)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await barbers.create(createBarber({ id: ACTIVE_BARBER_ID, name: 'Cristian Gómez', active: true }));
    await barbers.create(createBarber({ id: DEACTIVATED_BARBER_ID, name: 'Facundo Díaz', active: false }));
    await services.create(
      createService({ id: SERVICE_ID, name: 'Corte clásico', durationMinutes: 30, priceCents: 800000 }),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BARBER_REPOSITORY)
      .useValue(barbers)
      .overrideProvider(SERVICE_REPOSITORY)
      .useValue(services)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('GET /barbers lists only active barbers, with no session cookie', async () => {
    const response = await request(app.getHttpServer()).get('/barbers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ barbers: [{ id: ACTIVE_BARBER_ID, name: 'Cristian Gómez' }] });
  });

  it('GET /services lists every service with its real priceCents and durationMinutes', async () => {
    const response = await request(app.getHttpServer()).get('/services');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      services: [
        { id: SERVICE_ID, name: 'Corte clásico', durationMinutes: 30, priceCents: 800000, depositCents: 400000 },
      ],
    });
  });

  // docs/HUECOS-BACKEND.md, "fuera de esta lista": the panel's Precios
  // screen wants to show the seña next to each price. Deriving it in the
  // browser (`priceCents / 2`) would duplicate `depositAmountCents` in a
  // second place, and the day the seña stops being a flat 50% one of the two
  // would go stale. Rounds the same way `depositAmountCents` does — an odd
  // price is a real case (nothing in `configureServicePrice` requires an
  // even number of cents).
  it('rounds an odd priceCents the same way depositAmountCents does', async () => {
    await services.create(
      createService({ id: 'service-odd', name: 'Arreglo de barba', durationMinutes: 15, priceCents: 150001 }),
    );

    const response = await request(app.getHttpServer()).get('/services');

    const odd = response.body.services.find((s: { id: string }) => s.id === 'service-odd');
    expect(odd).toMatchObject({ priceCents: 150001, depositCents: 75001 });
  });
});
