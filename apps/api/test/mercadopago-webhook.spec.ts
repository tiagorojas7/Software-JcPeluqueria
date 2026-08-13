import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakePaymentEventRepository, FakePaymentJobQueue } from '@jc-barberia/domain';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { PaymentsModule } from '../src/payments/payments.module';
import { MERCADOPAGO_WEBHOOK_SECRET, PAYMENT_EVENT_REPOSITORY, PAYMENT_JOB_QUEUE } from '../src/payments/tokens';

const SECRET = 'test-webhook-secret';

function signatureHeaderFor(dataId: string, ts: number, requestId?: string): string {
  const manifest = `id:${dataId.toLowerCase()};${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
  const v1 = createHmac('sha256', SECRET).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

// Threat matrix (design.md): "Webhook público de MercadoPago" — firma
// inválida -> 401 cero efectos · responde 200 y encola, nunca procesa
// sincrónicamente · payload approved falsificado sin firma -> rechazado.
describe('MercadoPago webhook (App Nest levantada en memoria)', () => {
  let app: INestApplication;
  let events: FakePaymentEventRepository;
  let queue: FakePaymentJobQueue;

  beforeAll(async () => {
    events = new FakePaymentEventRepository();
    queue = new FakePaymentJobQueue();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, PaymentsModule],
    })
      .overrideProvider(PAYMENT_EVENT_REPOSITORY)
      .useValue(events)
      .overrideProvider(PAYMENT_JOB_QUEUE)
      .useValue(queue)
      .overrideProvider(MERCADOPAGO_WEBHOOK_SECRET)
      .useValue(SECRET)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects an invalid signature with 401, recording the event but enqueueing nothing', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?data.id=123456')
      .set('x-signature', 'ts=1700000000,v1=deadbeef')
      .send({ action: 'payment.updated' });

    expect(response.status).toBe(401);
    expect(queue.enqueuedPaymentIds).toEqual([]);
    expect(events.records).toEqual([
      { paymentId: '123456', rawPayload: { action: 'payment.updated' }, signatureValid: false },
    ]);
  });

  it('accepts a validly signed payload with 200 and enqueues the payment id for async processing', async () => {
    const ts = 1700000001;
    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?data.id=654321')
      .set('x-signature', signatureHeaderFor('654321', ts, 'req-1'))
      .set('x-request-id', 'req-1')
      .send({ action: 'payment.updated' });

    expect(response.status).toBe(200);
    expect(queue.enqueuedPaymentIds).toEqual(['654321']);
  });

  it('rejects a forged "approved" payload carrying no valid signature — never reaches the queue', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?data.id=999999')
      .set('x-signature', 'ts=1700000002,v1=' + '0'.repeat(64))
      .send({ action: 'payment.updated', data: { id: '999999' }, status: 'approved' });

    expect(response.status).toBe(401);
    expect(queue.enqueuedPaymentIds).not.toContain('999999');
  });

  it('is public — reachable with no session cookie, proving PermissionsGuard does not block it', async () => {
    const ts = 1700000003;
    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?data.id=111111')
      .set('x-signature', signatureHeaderFor('111111', ts))
      .send({});

    expect(response.status).toBe(200);
  });
});
