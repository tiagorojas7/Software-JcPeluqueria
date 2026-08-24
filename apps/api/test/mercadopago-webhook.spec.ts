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

  it('asienta la firma invalida en la auditoria, sin usarla como filtro', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?data.id=123456')
      .set('x-signature', 'ts=1700000000,v1=deadbeef')
      .send({ action: 'payment.updated' });

    expect(response.status).toBe(200);
    expect(events.records).toEqual([
      { paymentId: '123456', rawPayload: { action: 'payment.updated' }, signatureValid: false },
    ]);
  });

  it('responde 200 y no encola nada cuando la notificacion no nombra un pago', async () => {
    // Un `merchant_order` — o cualquier POST perdido — no trae un id que se
    // le pueda preguntar a `/v1/payments/{id}`. Se responde 200 a proposito:
    // un 4xx haria que MercadoPago reintente para siempre algo que no nos
    // sirve. Tampoco hay fila de auditoria, porque esa tabla se indexa por id
    // de pago y aca no hay ninguno.
    // Los dobles se comparten entre los casos de esta suite, asi que lo que
    // importa es el delta de esta llamada, no el contenido absoluto.
    const recordsBefore = events.records.length;
    const enqueuedBefore = queue.enqueuedPaymentIds.length;

    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?id=43900907080&topic=merchant_order')
      .set('x-signature', 'ts=1700000000,v1=deadbeef')
      .send({ resource: 'https://api.mercadolibre.com/merchant_orders/43900907080' });

    expect(response.status).toBe(200);
    expect(queue.enqueuedPaymentIds).toHaveLength(enqueuedBefore);
    expect(events.records).toHaveLength(recordsBefore);
  });

  // MercadoPago manda por DOS formatos y del ultimo pago real solo llego el
  // viejo, que este endpoint rechazaba. Verificado contra el trafico real
  // capturado por ngrok:
  //   ?data.id=<id>&type=payment        (moderno, el unico que se aceptaba)
  //   ?id=<id>&topic=payment            (IPN legacy)
  //   ?id=<merchant_order_id>&topic=merchant_order
  // Un pago aprobado cuyo aviso llega solo por el canal viejo se quedaba sin
  // confirmar para siempre.
  it('acepta el formato viejo id+topic=payment y encola el mismo id', async () => {
    const before = queue.enqueuedPaymentIds.length;

    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?id=778899&topic=payment')
      .set('x-signature', signatureHeaderFor('778899', 1700000000, 'req-ipn'))
      .set('x-request-id', 'req-ipn')
      .send({ action: 'payment.created' });

    expect(response.status).toBe(200);
    expect(queue.enqueuedPaymentIds.slice(before)).toEqual(['778899']);
  });

  // La firma deja de ser la unica autenticacion. Prueba QUIEN habla; no
  // prueba el hecho. Quien lo prueba es `PaymentPort.getPayment`, que
  // `ProcessPaymentUseCase` ya consulta antes de tocar nada — el propio
  // puerto lo documenta: "the webhook's data.id is never trusted directly".
  // Encolar no confirma ningun turno: solo agenda la pregunta a MercadoPago.
  it('encola igual cuando la firma no valida, pero lo deja asentado como invalido', async () => {
    const before = queue.enqueuedPaymentIds.length;

    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?data.id=445566&type=payment')
      .set('x-signature', 'ts=1700000000,v1=deadbeef')
      .set('x-request-id', 'req-invalida')
      .send({ action: 'payment.updated' });

    expect(response.status).toBe(200);
    expect(queue.enqueuedPaymentIds.slice(before)).toEqual(['445566']);
    // El registro de auditoria conserva que esa firma no validaba.
    expect(events.records.at(-1)).toEqual(
      expect.objectContaining({ paymentId: '445566', signatureValid: false }),
    );
  });

  it('accepts a validly signed payload with 200 and enqueues the payment id for async processing', async () => {
    const before = queue.enqueuedPaymentIds.length;
    const ts = 1700000001;
    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?data.id=654321')
      .set('x-signature', signatureHeaderFor('654321', ts, 'req-1'))
      .set('x-request-id', 'req-1')
      .send({ action: 'payment.updated' });

    expect(response.status).toBe(200);
    expect(queue.enqueuedPaymentIds.slice(before)).toEqual(['654321']);
  });

  it('un payload que se declara approved sin firma valida no confirma nada por si mismo', async () => {
    // Antes este caso probaba que la firma lo frenaba en la puerta. Ya no la
    // usamos como filtro, asi que lo que hay que probar es lo que de verdad
    // protege: encolar NO es confirmar. El id entra a la cola, pero el
    // `status: 'approved'` del cuerpo se ignora por completo — nada aguas
    // abajo lo lee. `ProcessPaymentUseCase` le pregunta el estado a
    // MercadoPago con `PaymentPort.getPayment`, de modo que un atacante no
    // puede fabricar una aprobacion escribiendola en el JSON.
    const response = await request(app.getHttpServer())
      .post('/webhooks/mercadopago?data.id=999999')
      .set('x-signature', 'ts=1700000002,v1=' + '0'.repeat(64))
      .send({ action: 'payment.updated', data: { id: '999999' }, status: 'approved' });

    expect(response.status).toBe(200);
    expect(events.records.at(-1)).toEqual(
      expect.objectContaining({ paymentId: '999999', signatureValid: false }),
    );
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
