import { FakeClock, FakeShopRevenueRepository, type TimeWindow } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetShopRevenueUseCase } from './get-shop-revenue';

const clock = new FakeClock();
const AUGUST: TimeWindow = {
  start: clock.localTimeToUtc('2026-08-01', '00:00'),
  end: clock.localTimeToUtc('2026-08-31', '23:59'),
};

// docs/HUECOS-BACKEND.md #5, "«Facturación del local» no existe":
//
//   "Qué sí puede calcular el dominio: suma de precios de lista de turnos
//   realizado, agrupable por barbero, por servicio y por día."
//
// Unlike the barber's own revenue, this never narrows to one barber — the
// owner sees every barber's realizado turno in the period, which is exactly
// what `@RequiresPermission('finance:read:shop')` (owner-only) is FOR.
describe('GetShopRevenueUseCase', () => {
  it('sums the list price of every realizado turno across every barber', async () => {
    const repository = new FakeShopRevenueRepository();
    repository.seed([
      { appointmentId: 'a1', barberId: 'b1', barberName: 'Juan', serviceId: 's1', serviceName: 'Corte', listPriceCents: 500_000 },
      { appointmentId: 'a2', barberId: 'b2', barberName: 'Ana', serviceId: 's1', serviceName: 'Corte', listPriceCents: 500_000 },
      { appointmentId: 'a3', barberId: 'b1', barberName: 'Juan', serviceId: 's2', serviceName: 'Barba', listPriceCents: 300_000 },
    ]);

    const useCase = new GetShopRevenueUseCase(repository);
    const result = await useCase.execute(AUGUST);

    expect(result.totalListPriceCents).toBe(1_300_000);
    expect(result.count).toBe(3);
    expect(repository.calls).toEqual([AUGUST]);
  });

  it('breaks the total down by barber — one row per barber, count and its own total', async () => {
    const repository = new FakeShopRevenueRepository();
    repository.seed([
      { appointmentId: 'a1', barberId: 'b1', barberName: 'Juan', serviceId: 's1', serviceName: 'Corte', listPriceCents: 500_000 },
      { appointmentId: 'a2', barberId: 'b1', barberName: 'Juan', serviceId: 's2', serviceName: 'Barba', listPriceCents: 300_000 },
      { appointmentId: 'a3', barberId: 'b2', barberName: 'Ana', serviceId: 's1', serviceName: 'Corte', listPriceCents: 500_000 },
    ]);

    const useCase = new GetShopRevenueUseCase(repository);
    const result = await useCase.execute(AUGUST);

    expect(result.byBarber).toEqual(
      expect.arrayContaining([
        { barberId: 'b1', barberName: 'Juan', count: 2, totalListPriceCents: 800_000 },
        { barberId: 'b2', barberName: 'Ana', count: 1, totalListPriceCents: 500_000 },
      ]),
    );
    expect(result.byBarber).toHaveLength(2);
  });

  it('breaks the total down by service too — never conflating the two breakdowns', async () => {
    const repository = new FakeShopRevenueRepository();
    repository.seed([
      { appointmentId: 'a1', barberId: 'b1', barberName: 'Juan', serviceId: 's1', serviceName: 'Corte', listPriceCents: 500_000 },
      { appointmentId: 'a2', barberId: 'b2', barberName: 'Ana', serviceId: 's1', serviceName: 'Corte', listPriceCents: 500_000 },
    ]);

    const useCase = new GetShopRevenueUseCase(repository);
    const result = await useCase.execute(AUGUST);

    expect(result.byService).toEqual([{ serviceId: 's1', serviceName: 'Corte', count: 2, totalListPriceCents: 1_000_000 }]);
  });

  // README §"Perfil del barbero": el mismo disclaimer, palabra por palabra —
  // la advertencia de "no es ganancia" importa tanto (o más) a nivel local
  // como a nivel de un barbero individual.
  it('carries the EXACT SAME disclaimer text the barber own-revenue screen shows — not a paraphrase', async () => {
    const repository = new FakeShopRevenueRepository();

    const useCase = new GetShopRevenueUseCase(repository);
    const result = await useCase.execute(AUGUST);

    expect(result.disclaimer).toMatch(/precio de lista/i);
    expect(result.disclaimer).toMatch(/no\b[^.]*ganancia/i);
    expect(result.disclaimer).toMatch(/no\b[^.]*efectivamente cobrad/i);
    expect(result.disclaimer).toMatch(/50\s*%/);
    expect(result.disclaimer).toMatch(/mostrador/i);
  });

  it('answers zero/empty for a period with nothing at all, never an error', async () => {
    const repository = new FakeShopRevenueRepository();

    const useCase = new GetShopRevenueUseCase(repository);
    const result = await useCase.execute(AUGUST);

    expect(result.totalListPriceCents).toBe(0);
    expect(result.count).toBe(0);
    expect(result.byBarber).toEqual([]);
    expect(result.byService).toEqual([]);
  });
});
