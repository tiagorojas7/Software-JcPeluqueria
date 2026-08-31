import { FakeBarberRepository, createBarber } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ListPublicBarbersUseCase } from './list-public-barbers';

// datos-reales-en-ui RED — the owner's bug report: he deactivated Facundo
// Díaz through the panel and the public site kept listing him. This use
// case is the fix's application layer: client-booking spec, "Exploración
// sin cuenta" says a visitor MUST be able to consult "servicios, barberos
// y horarios disponibles" — a deactivated barber is not one of them, so a
// deactivated `Barber` must never reach the result, ever.

describe('ListPublicBarbersUseCase', () => {
  it('returns only active barbers, never a deactivated one', async () => {
    const barbers = new FakeBarberRepository();
    await barbers.create(createBarber({ id: 'barber-1', name: 'Cristian Gómez', active: true }));
    await barbers.create(createBarber({ id: 'barber-2', name: 'Facundo Díaz', active: false }));

    const useCase = new ListPublicBarbersUseCase(barbers);
    const result = await useCase.execute();

    // `permanentLeave` se sumó a `Barber` con la baja definitiva; este
    // esperado quedó sin actualizar y el test venía rojo desde entonces.
    expect(result.barbers).toEqual([
      { id: 'barber-1', name: 'Cristian Gómez', active: true, permanentLeave: false },
    ]);
  });

  it('returns an empty list when there are no active barbers', async () => {
    const barbers = new FakeBarberRepository();
    await barbers.create(createBarber({ id: 'barber-1', name: 'Cristian Gómez', active: false }));

    const useCase = new ListPublicBarbersUseCase(barbers);
    const result = await useCase.execute();

    expect(result.barbers).toEqual([]);
  });
});
