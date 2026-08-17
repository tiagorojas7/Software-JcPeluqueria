import {
  FakeAppointmentRepository,
  FakeClock,
  FakeHoldRepository,
  SlotUnavailableError,
  type Appointment,
  type Hold,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { AcceptOfferUseCase } from './accept-absence-offer';

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-07', time);

const anOffer = (overrides: Partial<Hold> = {}): Hold => ({
  id: 'offer-hold-1',
  barberId: 'barber-other',
  serviceId: 'service-1',
  clientId: 'client-1',
  channel: 'web',
  timeRange: { start: at('11:00'), end: at('11:30') },
  holdExpiresAt: at('10:15'),
  originOccupancyId: 'appointment-1',
  ...overrides,
});

const originalAppointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'appointment-1',
  barberId: 'barber-absent',
  serviceId: 'service-1',
  clientId: 'client-1',
  channel: 'web',
  timeRange: { start: at('10:00'), end: at('10:30') },
  status: 'reservado',
  deposit: { kind: 'settled', paymentId: 'mp-1', amountCents: 250000 },
  ...overrides,
});

const searchWindow = { start: at('09:00'), end: at('18:00') };

// 12.7 RED — derived from specs/barber-absence-reassignment/spec.md:
//
//   "Requirement: Aceptación reagenda sin mover dinero"
//   "Si el cliente acepta un horario ofrecido dentro de la ventana del
//   hold, el sistema MUST re-validar su disponibilidad y MUST reasignar el
//   turno original a ese barbero y horario, conservando el estado de la
//   seña sin generar un nuevo cobro ni un reembolso, exista o no seña."
//
//   Scenario "Cliente acepta la reasignación":
//     GIVEN una oferta con hold activo
//     WHEN el cliente la acepta y la re-validación es exitosa
//     THEN el turno se reagenda al nuevo barbero y horario
//     AND la seña, si existía, se mantiene asociada sin cobro ni reembolso
//     adicional
describe('AcceptOfferUseCase', () => {
  it('moves the ORIGINAL appointment to the offered barber/time via UPDATE, keeping its settled deposit untouched — no new charge, no refund', async () => {
    const holds = new FakeHoldRepository();
    const appointments = new FakeAppointmentRepository();
    const offer = anOffer();
    holds.seed(offer);
    appointments.seed(originalAppointment());
    const useCase = new AcceptOfferUseCase(holds, appointments);

    const result = await useCase.execute({ offerHoldId: offer.id, searchWindow });

    expect(result).toEqual({ outcome: 'reassigned' });
    // The origin row is UPDATEd (barberId/timeRange), never re-inserted —
    // updateScheduleCalls is the ONLY write AppointmentRepository records.
    expect(appointments.updateScheduleCalls).toEqual([
      {
        id: 'appointment-1',
        change: { barberId: 'barber-other', serviceId: 'service-1', timeRange: offer.timeRange },
      },
    ]);
    // Nothing ever asked this appointment to change status or touch money —
    // deposit_id/state stay exactly as they were before acceptance.
    expect(appointments.updateStatusCalls).toEqual([]);
    // The offer hold itself is released BEFORE the original claims that
    // exact (barberId, timeRange) — otherwise the EXCLUDE constraint would
    // reject the original's own UPDATE against the still-`held` offer row.
    expect(holds.releaseCalls).toEqual([offer.id]);
  });

  it('reports offer-expired without touching the original appointment when the offer hold already lapsed', async () => {
    const holds = new FakeHoldRepository(true, true, true, false); // release() always fails
    const appointments = new FakeAppointmentRepository();
    const offer = anOffer();
    holds.seed(offer);
    appointments.seed(originalAppointment());
    const useCase = new AcceptOfferUseCase(holds, appointments);

    const result = await useCase.execute({ offerHoldId: offer.id, searchWindow });

    expect(result).toEqual({ outcome: 'offer-expired' });
    expect(appointments.updateScheduleCalls).toEqual([]);
  });

  it('reports offer-expired for an unknown hold id, instead of throwing', async () => {
    const holds = new FakeHoldRepository();
    const appointments = new FakeAppointmentRepository();
    const useCase = new AcceptOfferUseCase(holds, appointments);

    const result = await useCase.execute({ offerHoldId: 'does-not-exist', searchWindow });

    expect(result).toEqual({ outcome: 'offer-expired' });
  });

  it('reports slot-taken with alternatives when the original loses the race for the offered slot', async () => {
    const holds = new FakeHoldRepository();
    class ConflictingAppointmentRepository extends FakeAppointmentRepository {
      override async updateSchedule(): Promise<void> {
        throw new SlotUnavailableError([{ start: at('12:00'), end: at('12:30') }]);
      }
    }
    const appointments = new ConflictingAppointmentRepository();
    const offer = anOffer();
    holds.seed(offer);
    appointments.seed(originalAppointment());
    const useCase = new AcceptOfferUseCase(holds, appointments);

    const result = await useCase.execute({ offerHoldId: offer.id, searchWindow });

    expect(result).toEqual({
      outcome: 'slot-taken',
      alternatives: [{ start: at('12:00'), end: at('12:30') }],
    });
  });
});
