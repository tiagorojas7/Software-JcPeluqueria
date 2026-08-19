import { Module, type OnApplicationShutdown } from '@nestjs/common';
import {
  AcceptOfferUseCase,
  CreateHold,
  GenerateAbsenceReassignmentOffers,
  MarkBarberAbsentUseCase,
  RejectOfferUseCase,
} from '@jc-barberia/application';
import {
  db,
  DrizzleAppointmentRepository,
  DrizzleBarberRepository,
  DrizzleClientRepository,
  DrizzleFreeRangesQuery,
  DrizzleHoldRepository,
  DrizzleNotificationOutboxRepository,
  DrizzleScheduleRepository,
  DrizzleServiceRepository,
  lazyJobSender,
  MercadoPagoPaymentAdapter,
  PgBossHoldExpireScheduler,
  ShopClock,
  stopJobSender,
} from '@jc-barberia/infrastructure';
import type {
  AppointmentRepository,
  BarberRepository,
  ClientRepository,
  Clock,
  FreeRangesQuery,
  HoldExpireScheduler,
  HoldRepository,
  NotificationOutboxRepository,
  PaymentPort,
  ScheduleRepository,
  ServiceRepository,
} from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { MarkBarberAbsentController } from './mark-barber-absent.controller';
import { OffersController } from './offers.controller';
import {
  APPOINTMENT_REPOSITORY,
  BARBER_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  FREE_RANGES_QUERY,
  HOLD_EXPIRE_SCHEDULER,
  HOLD_REPOSITORY,
  NOTIFICATION_OUTBOX_REPOSITORY,
  PAYMENT_PORT,
  SCHEDULE_REPOSITORY,
  SERVICE_REPOSITORY,
} from './tokens';

/**
 * Wires task 12.1/12.2's detection endpoint (`MarkBarberAbsentController`)
 * AND, since E.1 (cablear-el-mvp Slice E), the offer-generation step it now
 * triggers (`GenerateAbsenceReassignmentOffers`) plus C.6's client-facing
 * accept/reject routes (`OffersController`) — all three share the exact same
 * `barber-absence-reassignment` bounded context, so they live in one module
 * rather than splitting `HOLD_REPOSITORY`/`PAYMENT_PORT` across two.
 *
 * `HOLD_EXPIRE_SCHEDULER` follows the SAME lazy-connect discipline every
 * other pg-boss producer in this app uses (`AppointmentsModule`/
 * `BookingModule`'s own token): a synchronous factory, `lazyJobSender()`
 * defers the connection to the first enqueue. `CreateHold` (reused
 * unmodified by `GenerateAbsenceReassignmentOffers`, same as everywhere else
 * in this codebase) needs it to claim same-day offer holds.
 */
@Module({
  imports: [AccessControlModule],
  controllers: [MarkBarberAbsentController, OffersController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: APPOINTMENT_REPOSITORY, useFactory: () => new DrizzleAppointmentRepository(db) },
    { provide: BARBER_REPOSITORY, useFactory: () => new DrizzleBarberRepository(db) },
    { provide: SERVICE_REPOSITORY, useFactory: () => new DrizzleServiceRepository(db) },
    { provide: SCHEDULE_REPOSITORY, useFactory: () => new DrizzleScheduleRepository(db) },
    { provide: FREE_RANGES_QUERY, useFactory: () => new DrizzleFreeRangesQuery(db) },
    { provide: CLIENT_REPOSITORY, useFactory: () => new DrizzleClientRepository(db) },
    { provide: HOLD_REPOSITORY, useFactory: () => new DrizzleHoldRepository(db) },
    { provide: NOTIFICATION_OUTBOX_REPOSITORY, useFactory: () => new DrizzleNotificationOutboxRepository(db) },
    {
      provide: PAYMENT_PORT,
      useFactory: () => new MercadoPagoPaymentAdapter(process.env.MERCADOPAGO_ACCESS_TOKEN ?? ''),
    },
    {
      // See this file's own doc comment above — same trap `AppointmentsModule`'s
      // HOLD_EXPIRE_SCHEDULER comment documents: an eager `await jobSender()`
      // here would open a connection while Nest is still building the module
      // graph and kill every test suite.
      provide: HOLD_EXPIRE_SCHEDULER,
      useFactory: () => new PgBossHoldExpireScheduler(lazyJobSender()),
    },
    {
      provide: CreateHold,
      inject: [HOLD_REPOSITORY, CLOCK, HOLD_EXPIRE_SCHEDULER],
      useFactory: (holds: HoldRepository, clock: Clock, holdExpire: HoldExpireScheduler) =>
        new CreateHold(holds, clock, holdExpire),
    },
    {
      provide: MarkBarberAbsentUseCase,
      inject: [APPOINTMENT_REPOSITORY],
      useFactory: (appointments: AppointmentRepository) => new MarkBarberAbsentUseCase(appointments),
    },
    {
      // E.1: the step `MarkBarberAbsentController` never used to call.
      provide: GenerateAbsenceReassignmentOffers,
      inject: [
        BARBER_REPOSITORY,
        SERVICE_REPOSITORY,
        SCHEDULE_REPOSITORY,
        FREE_RANGES_QUERY,
        CLIENT_REPOSITORY,
        CreateHold,
        NOTIFICATION_OUTBOX_REPOSITORY,
        CLOCK,
      ],
      useFactory: (
        barbers: BarberRepository,
        services: ServiceRepository,
        schedules: ScheduleRepository,
        freeRangesQuery: FreeRangesQuery,
        clients: ClientRepository,
        createHold: CreateHold,
        outbox: NotificationOutboxRepository,
        clock: Clock,
      ) =>
        new GenerateAbsenceReassignmentOffers(
          barbers,
          services,
          schedules,
          freeRangesQuery,
          clients,
          createHold,
          outbox,
          clock,
        ),
    },
    {
      // C.6: the client's own accept/reject routes.
      provide: AcceptOfferUseCase,
      inject: [HOLD_REPOSITORY, APPOINTMENT_REPOSITORY],
      useFactory: (holds: HoldRepository, appointments: AppointmentRepository) =>
        new AcceptOfferUseCase(holds, appointments),
    },
    {
      provide: RejectOfferUseCase,
      inject: [APPOINTMENT_REPOSITORY, PAYMENT_PORT],
      useFactory: (appointments: AppointmentRepository, paymentPort: PaymentPort) =>
        new RejectOfferUseCase(appointments, paymentPort),
    },
  ],
})
export class AbsenceReassignmentModule implements OnApplicationShutdown {
  /** pg-boss keeps its own pool open; without this the process hangs on
   *  exit — same reason `AppointmentsModule`/`BookingModule` implement this
   *  too. `stopJobSender()` is idempotent, so a shared shutdown with those
   *  modules never double-stops anything. */
  async onApplicationShutdown(): Promise<void> {
    await stopJobSender();
  }
}
