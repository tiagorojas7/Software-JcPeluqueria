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
    performance.seedStatusCounts(OWN_BARBER_ID, { realizado: 3 });
    performance.seedStatusCounts(COLLEAGUE_BARBER_ID, { realizado: 1 });

    const useCase = new GetOwnStatsUseCase(performance);
    const result = await useCase.execute(OWN_BARBER_ID, AUGUST, OWN_ACTOR);

    // "sin incluir cortes de otros barberos": barber-colleague's single
    // completed appointment must never inflate barber-own's count.
    expect(result).toEqual({ outcome: 'ok', count: 3, cancelledCount: 0, absentCount: 0, unresolvedCount: 0 });
  });

  it('rejects a request for a different barber id — the requirement text itself: "sin incluir cortes de otros barberos"', async () => {
    const performance = new FakeBarberPerformanceRepository();
    performance.seedStatusCounts(COLLEAGUE_BARBER_ID, { realizado: 1 });

    const useCase = new GetOwnStatsUseCase(performance);
    const result = await useCase.execute(COLLEAGUE_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result).toEqual({ outcome: 'forbidden' });
  });

  // docs/HUECOS-BACKEND.md #4, "El barbero no puede ver cómo cerraron sus
  // turnos": a bare realizado count with no context — five ausente this
  // month explains a low number, and is exactly the visibility README's
  // absence-tracking story depends on being real.
  it('reports cancelled, absent and unresolved counts alongside realizado — not just the completed count', async () => {
    const performance = new FakeBarberPerformanceRepository();
    performance.seedStatusCounts(OWN_BARBER_ID, {
      realizado: 10,
      cancelado: 2,
      ausente: 5,
      sin_registrado: 1,
    });

    const useCase = new GetOwnStatsUseCase(performance);
    const result = await useCase.execute(OWN_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result).toEqual({
      outcome: 'ok',
      count: 10,
      cancelledCount: 2,
      absentCount: 5,
      unresolvedCount: 1,
    });
  });

  it('reports every count as zero for a period with nothing at all', async () => {
    const performance = new FakeBarberPerformanceRepository();

    const useCase = new GetOwnStatsUseCase(performance);
    const result = await useCase.execute(OWN_BARBER_ID, AUGUST, OWN_ACTOR);

    expect(result).toEqual({ outcome: 'ok', count: 0, cancelledCount: 0, absentCount: 0, unresolvedCount: 0 });
  });
});
