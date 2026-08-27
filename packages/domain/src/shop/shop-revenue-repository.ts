import type { TimeWindow } from '../availability';

/**
 * One `realizado` appointment, shop-wide — the sibling of
 * `CompletedAppointmentRecord` (`barbers/barber-performance-repository.ts`)
 * with the one difference "facturación del local" needs and a single
 * barber's own view never does: WHICH barber it belongs to, so the caller
 * can break the total down by barber as well as by service.
 *
 * docs/HUECOS-BACKEND.md #5, "«Facturación del local» no existe": the shop
 * can only ever see list-price totals of `realizado` turnos — never the 50%
 * collected in cash at the counter, the same boundary
 * `CompletedAppointmentRecord`'s own doc comment states for one barber.
 */
export interface ShopRevenueRecord {
  readonly appointmentId: string;
  readonly barberId: string;
  readonly barberName: string;
  readonly serviceId: string;
  readonly serviceName: string;
  /** The service's list price AT THE TIME OF THE QUERY — never a frozen
   *  booking-time amount, and never the deposit/payment amount, the same
   *  rule `CompletedAppointmentRecord.listPriceCents` documents. */
  readonly listPriceCents: number;
}

/**
 * docs/HUECOS-BACKEND.md #5 — the shop's own read model, deliberately
 * separate from `BarberPerformanceRepository`: that port's entire reason to
 * exist is narrowing to ONE barber (access-control's "El barbero queda
 * acotado a sus propios datos"), and this one never narrows at all — every
 * `realizado` turno in `range`, across every barber. No actor/permission
 * parameter, matching every other panel use case in this codebase
 * (`ManageClientsAndBarbersUseCase`, `CreatePhoneAppointmentUseCase`): the
 * HTTP boundary's `@RequiresPermission('finance:read:shop')` is the one
 * place that decides who may call this at all, and migration
 * `0006_access_control.sql` grants that permission to the owner alone.
 */
export interface ShopRevenueRepository {
  findCompletedAppointments(range: TimeWindow): Promise<readonly ShopRevenueRecord[]>;
}
