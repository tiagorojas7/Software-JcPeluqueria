import {
  createBarberSchedule,
  createService,
  createShopHours,
  FakeAppointmentRepository,
  FakeAuthChallengeRepository,
  FakeBarberRepository,
  FakeClientRepository,
  FakeClock,
  FakeFreeRangesQuery,
  FakeNotificationOutboxRepository,
  FakeScheduleRepository,
  FakeServiceRepository,
  FakeStaffAccountRepository,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetPublicAvailabilityUseCase } from '../availability/get-public-availability';
import { ChallengeService } from '../identity/challenge-service';
import { ManageBarberAccountsUseCase } from './manage-barber-accounts';
import { ManageClientsAndBarbersUseCase } from './manage-clients-and-barbers';

// 10.14 RED — derived from specs/admin-operations/spec.md, not from an
// implementation:
//
//   "Gestión de clientes y de barberos":
//     El sistema MUST poder ver y administrar los registros de clientes. El
//     alta y baja de barberos, y la configuración de horarios base y
//     precios de servicios, MUST quedar restringidas a los roles
//     autorizados según access-control.
//
//   Scenario "Alta de un nuevo barbero":
//     GIVEN un rol autorizado para configuración
//     WHEN da de alta un nuevo barbero con su horario base
//     THEN el barbero queda disponible para asignación de turnos
//
// The prior WIP on `feat/turnero-10c-panel-cierre` (rejected) was a
// `DrizzleBarberUseCase`/`DrizzleClientUseCase` pair that lied about what it
// was (naming a Drizzle detail into an application-layer class, which
// imports NOTHING infrastructure-specific per the hexagonal rule), did
// nothing but list+create with zero tests, and declared `NotFoundError`
// types it never threw. This suite proves the "queda disponible" clause
// literally — not by asserting a returned flag, but by feeding the exact
// barber/schedule this use case wrote into `GetPublicAvailabilityUseCase`
// (already tested, 9.1/9.2) and checking it actually produces bookable
// slots. A barber created `active` but with no schedule row, or with a row
// nobody reads, would fail this test even though a shallow "was `create`
// called" assertion would still pass — that gap is exactly what sank the
// rejected version's sibling `barber-revenue.ts` (label text that never
// matched the requirement).

const clock = new FakeClock();
const at = (time: string) => clock.localTimeToUtc('2026-09-07', time); // a Monday
// `GetPublicAvailabilityUseCase` only offers start times still ahead of `now`,
// so the clock it gets here sits before the shop opens that Monday — this test
// is about the barber becoming assignable, not about the time of day.
const bookingClock = new FakeClock(-180, at('00:00'));

function buildUseCase(useCaseClock: FakeClock = bookingClock) {
  const clients = new FakeClientRepository();
  const barbers = new FakeBarberRepository();
  const schedules = new FakeScheduleRepository();
  const services = new FakeServiceRepository();
  const appointments = new FakeAppointmentRepository();
  const accountsRepository = new FakeStaffAccountRepository();
  const outbox = new FakeNotificationOutboxRepository();
  const accounts = new ManageBarberAccountsUseCase(
    accountsRepository,
    barbers,
    new ChallengeService(new FakeAuthChallengeRepository(), bookingClock),
    outbox,
  );
  const useCase = new ManageClientsAndBarbersUseCase(
    clients,
    barbers,
    schedules,
    services,
    accounts,
    appointments,
    useCaseClock,
  );
  return { useCase, clients, barbers, schedules, services, appointments, accounts, accountsRepository, outbox };
}

/** Every pre-existing test in this file is about the barber becoming
 *  assignable, not about their account — this keeps the email out of their
 *  way while still going through the one code path the alta now has. */
let nextEmail = 1;
const anEmail = () => `barbero-${nextEmail++}@jc.test`;

describe('ManageClientsAndBarbersUseCase (10.14/10.15)', () => {
  it('adding a barber with a base schedule makes them genuinely assignable — bookable slots appear', async () => {
    const { useCase, barbers, schedules, services } = buildUseCase();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
    );
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));

    const added = await useCase.addBarber({
      id: 'barber-1',
      name: 'Nuevo Barbero',
      email: anEmail(),
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    expect(added.outcome).toBe('added');
    expect(added.outcome === 'added' && added.barber).toMatchObject({
      id: 'barber-1',
      name: 'Nuevo Barbero',
      active: true,
    });

    // The literal "queda disponible para asignación de turnos" check: reuse
    // the already-tested public availability use case, unmodified, against
    // the exact rows `addBarber` just wrote.
    const freeRangesQuery = new FakeFreeRangesQuery();
    freeRangesQuery.seed('barber-1', [{ start: at('09:00'), end: at('13:00') }]);
    const availability = new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRangesQuery, bookingClock);

    const result = await availability.execute({
      barberId: 'barber-1',
      serviceId: 'service-1',
      date: '2026-09-07',
    });

    expect(result.slots.length).toBeGreaterThan(0);
  });

  it('a barber added with no schedule row never becomes assignable — the base schedule is not optional', async () => {
    const { useCase, barbers, schedules, services } = buildUseCase();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
    );
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));

    await useCase.addBarber({ id: 'barber-2', name: 'Sin Horario', email: anEmail(), schedule: [] });

    const freeRangesQuery = new FakeFreeRangesQuery();
    freeRangesQuery.seed('barber-2', [{ start: at('09:00'), end: at('13:00') }]);
    const availability = new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRangesQuery, bookingClock);

    const result = await availability.execute({
      barberId: 'barber-2',
      serviceId: 'service-1',
      date: '2026-09-07',
    });

    expect(result.slots).toEqual([]);
  });

  it("lets an authorized role view every client's record", async () => {
    const { useCase, clients } = buildUseCase();
    await clients.create({ name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: null });
    await clients.create({ name: 'Laura', phone: '3517654321', email: null, age: null });

    const listed = await useCase.listClients();

    expect(listed).toHaveLength(2);
    expect(listed.map((c) => c.phone).sort()).toEqual(['3511234567', '3517654321']);
  });

  it('deactivating a barber removes them from assignment — the same availability check flips to empty', async () => {
    const { useCase, barbers, schedules, services } = buildUseCase();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
    );
    await schedules.createShopHours(createShopHours({ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }));
    await useCase.addBarber({
      id: 'barber-3',
      name: 'Para Dar de Baja',
      email: anEmail(),
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    const result = await useCase.deactivateBarber('barber-3');

    expect(result).toBe(true);
    const freeRangesQuery = new FakeFreeRangesQuery();
    freeRangesQuery.seed('barber-3', [{ start: at('09:00'), end: at('13:00') }]);
    const availability = new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRangesQuery, bookingClock);
    const availabilityResult = await availability.execute({
      barberId: 'barber-3',
      serviceId: 'service-1',
      date: '2026-09-07',
    });
    expect(availabilityResult.slots).toEqual([]);
  });

  it('deactivating an unknown barber id reports false — no exception for a routine "already gone"', async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.deactivateBarber('does-not-exist');

    expect(result).toBe(false);
  });

  it('configures a service price for a real id and reports false for an unknown one', async () => {
    const { useCase, services } = buildUseCase();
    await services.create(
      createService({ id: 'service-1', name: 'Corte clasico', durationMinutes: 30, priceCents: 500000 }),
    );

    const updated = await useCase.configureServicePrice('service-1', 550000);
    const missing = await useCase.configureServicePrice('does-not-exist', 550000);

    expect(updated).toBe(true);
    expect(missing).toBe(false);
    expect(await services.findById('service-1')).toMatchObject({ priceCents: 550000 });
  });

  it('configures the base schedule for a day already on file, and creates it when the day is new', async () => {
    const { useCase, schedules } = buildUseCase();
    await useCase.addBarber({
      id: 'barber-4',
      name: 'Con Horario',
      email: anEmail(),
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    await useCase.configureBarberSchedule(
      createBarberSchedule({ barberId: 'barber-4', dayOfWeek: 1, opensAt: '10:00', closesAt: '18:00' }),
    );
    await useCase.configureBarberSchedule(
      createBarberSchedule({ barberId: 'barber-4', dayOfWeek: 2, opensAt: '10:00', closesAt: '18:00' }),
    );

    const own = await schedules.listBarberSchedule('barber-4');
    expect(own).toEqual(
      expect.arrayContaining([
        createBarberSchedule({ barberId: 'barber-4', dayOfWeek: 1, opensAt: '10:00', closesAt: '18:00' }),
        createBarberSchedule({ barberId: 'barber-4', dayOfWeek: 2, opensAt: '10:00', closesAt: '18:00' }),
      ]),
    );
    expect(own).toHaveLength(2); // day 1 was replaced in place, never duplicated
  });

  // panel-usable: a barber created through the panel ended up with exactly
  // ONE `barber_schedules` row no matter how many days the owner meant to
  // configure, because the panel only ever made one PUT with one day. This
  // is the fix's actual claim: one call, many rows.
  it('configures a whole week in a single call — one row per working day, never just one', async () => {
    const { useCase, schedules } = buildUseCase();
    await useCase.addBarber({ id: 'barber-5', name: 'Semana Completa', email: anEmail(), schedule: [] });

    await useCase.configureBarberWeek('barber-5', [
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 4, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 5, opensAt: '09:00', closesAt: '17:00' },
    ]);

    const own = await schedules.listBarberSchedule('barber-5');
    expect(own).toHaveLength(5);
    expect(own.map((day) => day.dayOfWeek).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  // RED — docs/HUECOS-BACKEND.md #6, "Apagar un día en Horarios no apaga el
  // día": el operador destildaba un día, guardaba, veía un mensaje de éxito, y
  // el barbero seguía trabajando ese día. El array recibido tiene que ser el
  // estado COMPLETO de la semana: un día que no viene en la lista deja de ser
  // un día de trabajo, no queda como estaba.
  it('desconfigura un dia que se saco de la semana — el bug que reporto el dueno', async () => {
    const { useCase, schedules } = buildUseCase();
    await useCase.addBarber({
      id: 'barber-7',
      name: 'Semana Que Se Achica',
      email: anEmail(),
      schedule: [],
    });
    await useCase.configureBarberWeek('barber-7', [
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' },
    ]);

    // El dueño destilda el martes (dayOfWeek 2) y vuelve a guardar.
    const result = await useCase.configureBarberWeek('barber-7', [
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' },
    ]);

    // Sin turnos reservados en el martes que se apaga, la escritura se hace
    // sola — pedir confirmación solo tiene sentido cuando hay algo que perder.
    expect(result).toEqual({ outcome: 'configured' });
    const own = await schedules.listBarberSchedule('barber-7');
    expect(own.map((day) => day.dayOfWeek).sort()).toEqual([1, 3]);
  });

  it('no toca los dias de OTRO barbero al reemplazar la semana de este', async () => {
    const { useCase, schedules } = buildUseCase();
    await useCase.addBarber({
      id: 'barber-8a',
      name: 'Uno',
      email: anEmail(),
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
    });
    await useCase.addBarber({
      id: 'barber-8b',
      name: 'Otro',
      email: anEmail(),
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
    });

    await useCase.configureBarberWeek('barber-8a', [{ dayOfWeek: 2, opensAt: '10:00', closesAt: '19:00' }]);

    const other = await schedules.listBarberSchedule('barber-8b');
    expect(other.map((day) => day.dayOfWeek)).toEqual([1]);
  });

  // docs/HUECOS-BACKEND.md #6, segunda parte: "decidir qué pasa con los
  // turnos ya reservados en un día que se apaga... lo correcto es que el
  // backend responda cuántos turnos quedarían huérfanos y que la UI pida
  // confirmación con ese número." El front hoy solo avisa con texto; esto es
  // lo que ese aviso necesitaba para dejar de ser un parche.
  describe('configureBarberWeek — turnos huerfanos al apagar un dia', () => {
    async function withBarberWorkingMonday(useCaseClock?: FakeClock) {
      const context = buildUseCase(useCaseClock);
      await context.useCase.addBarber({
        id: 'barber-9',
        name: 'Con Turno El Lunes',
        email: anEmail(),
        schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
      });
      return context;
    }

    it('pide confirmacion, y NO escribe nada, cuando apagar el dia dejaria un turno reservado huerfano', async () => {
      const { useCase, appointments, schedules } = await withBarberWorkingMonday();
      appointments.seed({
        id: 'apt-lunes',
        barberId: 'barber-9',
        serviceId: 'service-1',
        clientId: 'client-1',
        channel: 'web',
        timeRange: { start: at('10:00'), end: at('10:30') }, // 2026-09-07 es lunes
        status: 'reservado',
        deposit: { kind: 'not_applicable' },
      });

      const result = await useCase.configureBarberWeek('barber-9', []);

      expect(result).toEqual({ outcome: 'needs-confirmation', affectedAppointmentIds: ['apt-lunes'] });
      // Ni un dia se toco: pedir confirmacion es DECIDIDAMENTE no escribir
      // todavia, nunca un aviso post-facto sobre algo ya guardado.
      expect(await schedules.listBarberSchedule('barber-9')).toHaveLength(1);
    });

    it('escribe el cambio cuando el llamador ya confirmo, con turnos huerfanos y todo', async () => {
      const { useCase, appointments, schedules } = await withBarberWorkingMonday();
      appointments.seed({
        id: 'apt-lunes',
        barberId: 'barber-9',
        serviceId: 'service-1',
        clientId: 'client-1',
        channel: 'web',
        timeRange: { start: at('10:00'), end: at('10:30') },
        status: 'reservado',
        deposit: { kind: 'not_applicable' },
      });

      const result = await useCase.configureBarberWeek('barber-9', [], { confirm: true });

      expect(result).toEqual({ outcome: 'configured' });
      expect(await schedules.listBarberSchedule('barber-9')).toEqual([]);
    });

    it('no pide nada cuando el dia que se apaga no tiene ningun turno reservado', async () => {
      const { useCase, schedules } = await withBarberWorkingMonday();

      const result = await useCase.configureBarberWeek('barber-9', []);

      expect(result).toEqual({ outcome: 'configured' });
      expect(await schedules.listBarberSchedule('barber-9')).toEqual([]);
    });

    it('ignora un turno YA cancelado en ese dia — solo lo reservado queda huerfano', async () => {
      const { useCase, appointments, schedules } = await withBarberWorkingMonday();
      appointments.seed({
        id: 'apt-cancelado',
        barberId: 'barber-9',
        serviceId: 'service-1',
        clientId: 'client-1',
        channel: 'web',
        timeRange: { start: at('10:00'), end: at('10:30') },
        status: 'cancelado',
        deposit: { kind: 'not_applicable' },
      });

      const result = await useCase.configureBarberWeek('barber-9', []);

      expect(result).toEqual({ outcome: 'configured' });
      expect(await schedules.listBarberSchedule('barber-9')).toEqual([]);
    });

    it('ignora un turno reservado que YA paso — solo lo futuro cuenta como huerfano', async () => {
      // El reloj de este caso de uso lee las 11:00 ese mismo lunes — el
      // turno de las 10:00 ya paso para cuando se pide apagar el dia.
      const { useCase, appointments, schedules } = await withBarberWorkingMonday(new FakeClock(-180, at('11:00')));
      appointments.seed({
        id: 'apt-viejo',
        barberId: 'barber-9',
        serviceId: 'service-1',
        clientId: 'client-1',
        channel: 'web',
        timeRange: { start: at('10:00'), end: at('10:30') },
        status: 'reservado',
        deposit: { kind: 'not_applicable' },
      });

      const result = await useCase.configureBarberWeek('barber-9', []);

      expect(result).toEqual({ outcome: 'configured' });
      expect(await schedules.listBarberSchedule('barber-9')).toEqual([]);
    });

    it('no toca los turnos de un dia que sigue prendido', async () => {
      const { useCase, appointments, schedules } = await withBarberWorkingMonday();
      appointments.seed({
        id: 'apt-lunes',
        barberId: 'barber-9',
        serviceId: 'service-1',
        clientId: 'client-1',
        channel: 'web',
        timeRange: { start: at('10:00'), end: at('10:30') },
        status: 'reservado',
        deposit: { kind: 'not_applicable' },
      });

      // El lunes se mantiene tal cual — nada que preguntar.
      const result = await useCase.configureBarberWeek('barber-9', [
        { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
      ]);

      expect(result).toEqual({ outcome: 'configured' });
      expect(await schedules.listBarberSchedule('barber-9')).toHaveLength(1);
    });
  });

  it('configuring a week updates a day already on file instead of duplicating it', async () => {
    const { useCase, schedules } = buildUseCase();
    await useCase.addBarber({
      id: 'barber-6',
      name: 'Con Un Dia',
      email: anEmail(),
      schedule: [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' }],
    });

    await useCase.configureBarberWeek('barber-6', [
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' },
    ]);

    const own = await schedules.listBarberSchedule('barber-6');
    expect(own).toHaveLength(2);
    expect(own).toEqual(
      expect.arrayContaining([
        createBarberSchedule({ barberId: 'barber-6', dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }),
        createBarberSchedule({ barberId: 'barber-6', dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' }),
      ]),
    );
  });
});

// RED — README section 3.9, "Perfil del barbero": *"No es opcional: es la
// puerta por la que entra al sistema."* Until now the alta wrote `barbers` +
// `barber_schedules` and stopped there, so a barber the owner had just
// created showed up in the agenda and in public availability while no
// `users` row existed for them: assignable, and unable to log in. These
// cases pin the alta to producing BOTH, or neither.
describe('ManageClientsAndBarbersUseCase — la cuenta del barbero', () => {
  it('creates the login account and sends the activation invite in the same alta', async () => {
    const { useCase, accountsRepository, outbox } = buildUseCase();

    const added = await useCase.addBarber({
      id: 'barber-cuenta',
      name: 'Con Cuenta',
      email: 'concuenta@jc.test',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    expect(added).toMatchObject({ outcome: 'added' });
    const account = await accountsRepository.findByBarberId('barber-cuenta');
    expect(account).toMatchObject({ email: 'concuenta@jc.test', role: 'barber', activated: false, active: true });
    expect(outbox.enqueued.map((call) => call.notificationType)).toEqual(['staff_activation']);
  });

  it('writes NOTHING when the email already belongs to another account — no half-created barber', async () => {
    const { useCase, barbers, accountsRepository, outbox } = buildUseCase();
    await useCase.addBarber({
      id: 'barber-primero',
      name: 'Primero',
      email: 'repetido@jc.test',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    const added = await useCase.addBarber({
      id: 'barber-segundo',
      name: 'Segundo',
      email: 'repetido@jc.test',
      schedule: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '13:00' }],
    });

    expect(added).toEqual({ outcome: 'email-taken' });
    // The barber that could never log in was never created either — that is
    // the whole point of checking the email before writing anything.
    expect(await barbers.findById('barber-segundo')).toBeNull();
    expect(await accountsRepository.findByBarberId('barber-segundo')).toBeNull();
    expect(outbox.enqueued).toHaveLength(1);
  });
});
