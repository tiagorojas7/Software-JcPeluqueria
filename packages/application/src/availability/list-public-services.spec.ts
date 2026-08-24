import { FakeServiceRepository, createService } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { ListPublicServicesUseCase } from './list-public-services';

// datos-reales-en-ui RED — the owner changed a service price through the
// panel and the public site kept showing the old number, because nothing
// on the wire ever carried `priceCents`: `apps/web/src/shared/demo-data.ts`
// baked a formatted string in instead. client-booking spec, "Exploración
// sin cuenta": a visitor MUST be able to consult services without an
// account. This use case is a thin pass-through over `ServiceRepository`
// on purpose — `Service` already carries real `priceCents`/`durationMinutes`,
// there is no filtering rule for services the way `active` filters barbers.

describe('ListPublicServicesUseCase', () => {
  it('returns every service with its real priceCents and durationMinutes', async () => {
    const services = new FakeServiceRepository();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clásico', durationMinutes: 30, priceCents: 800000 }),
    );

    const useCase = new ListPublicServicesUseCase(services);
    const result = await useCase.execute();

    expect(result.services).toEqual([
      { id: 'service-1', name: 'Corte clásico', durationMinutes: 30, priceCents: 800000 },
    ]);
  });

  it('returns an empty list when there are no services', async () => {
    const services = new FakeServiceRepository();

    const useCase = new ListPublicServicesUseCase(services);
    const result = await useCase.execute();

    expect(result.services).toEqual([]);
  });
});
