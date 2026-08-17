import { FakeBarberPerformanceRepository, FakeClock, type ActorContext, type TimeWindow } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetOwnStatsUseCase } from './get-own-stats';

const clock = new FakeClock();
const OWN_BARBER_ID = 'barber-own';
const COLLEAGUE_BARBER_ID = 'barber-colleague';
const OWN_ACTOR: ActorContext = { userId: 'user-own', role: 'barber', barberId: OWN_BARBER_ID };

const AUGUST: TimeWindow = {
  start: clock.localTimeToUtc('2026-08-01', '00:00'),
  end: clock.localTimeToUtc('2026-08-31', '23:59'),
};

// barber-profile spec, "Estadísticas de cortes propios":
//
//   "El sistema MUST mostrarle al barbero la cantidad de turnos `realizado`
//   propios, agrupada por día, mes y un período seleccionable, SIN INCLUIR
//   CORTES DE OTROS BARBEROS."
//
//   Scenario: Conteo de cortes del mes
//     GIVEN turnos `realizado` propios dentro del mes en curso
//     WHEN el barbero consulta sus estadísticas
//     THEN ve la cantidad correcta de cortes propios de ese mes
describe('GetOwnStatsUseCase', () => {
  it("counts only the barber's own completed appointments inside the requested period", async () => {
    const performance = new FakeBarberPerformanceRepository();
    performance.seed(OWN_BARBER_ID, [
      { appointmentId: 'a1', serviceId: 'svc-1', listPriceCents: 500_000 },
      { appointmentId: 'a2', serviceId: 'svc-2', listPriceCents: 300_000 },
      { appointmentId: 'a3', serviceId: 'svc-1', listPriceCents: 500_000 },
    ]);
    performance.seed(COLLEAGUE_BARBER_ID, [
      { appointmentId: 'b1', serviceId: 'svc-1', listPriceCents: 500_000 },
    ]);

    const useCase = new GetOwnStatsUseCase(performance);
    const result = await useCase.execute(OWN_BARBER_ID, AUGUST, OWN_ACTOR);

    // "sin incluir cortes de otros barberos": barber-colleague's single
    // completed appointment must never inflate barber-own's count.
    expect(result).toEqual({ outcome: 'ok', count: 3 });
  });

  it('rejects a request for a different barber id — the requirement text itself: "sin incluir cortes de otros barberos"', async () => {
    const performance = new FakeBarberPerformanceRepository();
    performance.seed(COLLEAGUE_BARBER_ID, [{ appointmentId: 'b1', serviceId: 'svc-1', listPriceCents: 500_000 }]);

    const useCase = new GetOwnStatsUseCase(performance);
    const result = await useCase.execute(COLLEAGUE_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result).toEqual({ outcome: 'forbidden' });
  });
});
