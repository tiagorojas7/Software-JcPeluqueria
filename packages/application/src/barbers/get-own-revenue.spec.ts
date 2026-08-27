import { FakeBarberPerformanceRepository, FakeClock, type ActorContext, type TimeWindow } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetOwnRevenueUseCase } from './get-own-revenue';

const clock = new FakeClock();
const OWN_BARBER_ID = 'barber-own';
const COLLEAGUE_BARBER_ID = 'barber-colleague';
const OWN_ACTOR: ActorContext = { userId: 'user-own', role: 'barber', barberId: OWN_BARBER_ID };

const AUGUST: TimeWindow = {
  start: clock.localTimeToUtc('2026-08-01', '00:00'),
  end: clock.localTimeToUtc('2026-08-31', '23:59'),
};

// barber-profile spec, "Facturación teórica por precio de lista":
//
//   "El sistema MUST mostrarle al barbero la suma de los precios de lista de
//   sus propios turnos `realizado` en el período consultado, MUST etiquetar
//   explícitamente esa cifra como facturación según precio de lista Y NO
//   COMO GANANCIA NI COMO PLATA EFECTIVAMENTE COBRADA, y MUST indicar que el
//   sistema no registra el 50% restante cobrado en el mostrador."
//
//   Scenario: Facturación mostrada con aclaración
//     GIVEN turnos `realizado` propios con sus precios de lista
//     WHEN el barbero consulta su facturación
//     THEN el sistema muestra el total junto con la aclaración de que es
//          precio de lista, no ganancia ni cobro efectivo
//
//   Scenario: Barbero no accede a la facturación del local
//     GIVEN un barbero autenticado
//     WHEN intenta consultar la facturación total del local o la de otro barbero
//     THEN el sistema MUST rechazar el acceso
describe('GetOwnRevenueUseCase', () => {
  it('sums only the list price of the own completed appointments in the period', async () => {
    const performance = new FakeBarberPerformanceRepository();
    performance.seed(OWN_BARBER_ID, [
      { appointmentId: 'a1', serviceId: 'svc-1', serviceName: 'Corte clásico', listPriceCents: 500_000 },
      { appointmentId: 'a2', serviceId: 'svc-2', serviceName: 'Barba', listPriceCents: 300_000 },
    ]);
    performance.seed(COLLEAGUE_BARBER_ID, [
      { appointmentId: 'b1', serviceId: 'svc-1', serviceName: 'Corte clásico', listPriceCents: 999_999 },
    ]);

    const useCase = new GetOwnRevenueUseCase(performance);
    const result = await useCase.execute(OWN_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') throw new Error('unreachable');
    expect(result.totalListPriceCents).toBe(800_000);
  });

  // This is the assertion that would have caught the rejected WIP: a label
  // that just said "3 cortes realizados" (or a bare number) passes a naive
  // "revenue exists" test while missing the requirement entirely. Every
  // clause below is independently required by the spec text quoted above —
  // dropping any one of them must fail this test.
  it('labels the figure explicitly as list-price billing — not profit, not money actually collected, and discloses the untracked 50%', async () => {
    const performance = new FakeBarberPerformanceRepository();
    performance.seed(OWN_BARBER_ID, [
      { appointmentId: 'a1', serviceId: 'svc-1', serviceName: 'Corte clásico', listPriceCents: 500_000 },
    ]);

    const useCase = new GetOwnRevenueUseCase(performance);
    const result = await useCase.execute(OWN_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') throw new Error('unreachable');
    expect(result.disclaimer).toMatch(/precio de lista/i);
    expect(result.disclaimer).toMatch(/no\b[^.]*ganancia/i);
    expect(result.disclaimer).toMatch(/no\b[^.]*efectivamente cobrad/i);
    expect(result.disclaimer).toMatch(/50\s*%/);
    expect(result.disclaimer).toMatch(/mostrador/i);
  });

  it('rejects a request for the shop total or a colleague — "MUST rechazar el acceso"', async () => {
    const performance = new FakeBarberPerformanceRepository();
    performance.seed(COLLEAGUE_BARBER_ID, [
      { appointmentId: 'b1', serviceId: 'svc-1', serviceName: 'Corte clásico', listPriceCents: 500_000 },
    ]);

    const useCase = new GetOwnRevenueUseCase(performance);
    const result = await useCase.execute(COLLEAGUE_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result).toEqual({ outcome: 'forbidden' });
  });

  // docs/HUECOS-BACKEND.md #3, "La facturación del barbero no se puede
  // desglosar": cuántos cortes de cada servicio hizo el barbero en el
  // período, y cuánto facturó cada uno — no un total sin abrir.
  it('breaks the total down by service — one row per service, count and its own total', async () => {
    const performance = new FakeBarberPerformanceRepository();
    performance.seed(OWN_BARBER_ID, [
      { appointmentId: 'a1', serviceId: 'svc-1', serviceName: 'Corte clásico', listPriceCents: 500_000 },
      { appointmentId: 'a2', serviceId: 'svc-1', serviceName: 'Corte clásico', listPriceCents: 500_000 },
      { appointmentId: 'a3', serviceId: 'svc-2', serviceName: 'Barba', listPriceCents: 300_000 },
    ]);

    const useCase = new GetOwnRevenueUseCase(performance);
    const result = await useCase.execute(OWN_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') throw new Error('unreachable');
    expect(result.byService).toEqual(
      expect.arrayContaining([
        { serviceId: 'svc-1', serviceName: 'Corte clásico', count: 2, totalListPriceCents: 1_000_000 },
        { serviceId: 'svc-2', serviceName: 'Barba', count: 1, totalListPriceCents: 300_000 },
      ]),
    );
    expect(result.byService).toHaveLength(2);
  });

  it('returns an empty breakdown, not an error, for a period with no completed appointments', async () => {
    const performance = new FakeBarberPerformanceRepository();

    const useCase = new GetOwnRevenueUseCase(performance);
    const result = await useCase.execute(OWN_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') throw new Error('unreachable');
    expect(result.byService).toEqual([]);
    expect(result.totalListPriceCents).toBe(0);
  });
});
