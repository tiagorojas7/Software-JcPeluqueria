import { Module, type OnApplicationShutdown } from '@nestjs/common';
import {
  AdminCancelAppointmentUseCase,
  AdminConfirmAbsenceUseCase,
  AdminMarkCompletedUseCase,
  BarberConfirmAbsenceUseCase,
  BarberMarkCompletedUseCase,
  CreateHold,
  CreatePhoneAppointmentUseCase,
  CreateWalkInUseCase,
  EditAppointmentUseCase,
  ScheduleAppointmentReminder,
} from '@jc-barberia/application';
import {
  db,
  DrizzleAbsenceRecordRepository,
  DrizzleAppointmentRepository,
  DrizzleBarberRepository,
  DrizzleClientRepository,
  DrizzleHoldRepository,
  DrizzleNotificationOutboxRepository,
  DrizzleServiceRepository,
  DrizzleWalkInRepository,
  lazyJobSender,
  MercadoPagoPaymentAdapter,
  PgBossAppointmentReminderScheduler,
  PgBossHoldExpireScheduler,
  ShopClock,
  stopJobSender,
} from '@jc-barberia/infrastructure';
import type {
  AbsenceRecordRepository,
  AppointmentReminderScheduler,
  AppointmentRepository,
  BarberRepository,
  ClientRepository,
  Clock,
  HoldExpireScheduler,
  HoldRepository,
  NotificationOutboxRepository,
  PaymentPort,
  ServiceRepository,
  WalkInRepository,
} from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { AppointmentActionsController } from './appointment-actions.controller';
import { PhoneAppointmentController } from './phone-appointment.controller';
import {
  ABSENCE_RECORD_REPOSITORY,
  APPOINTMENT_REMINDER_SCHEDULER,
  APPOINTMENT_REPOSITORY,
  BARBER_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  HOLD_EXPIRE_SCHEDULER,
  HOLD_REPOSITORY,
  NOTIFICATION_OUTBOX_REPOSITORY,
  PAYMENT_PORT,
  SERVICE_REPOSITORY,
  WALK_IN_REPOSITORY,
} from './tokens';

/** Wires task 10.1/10.2's real endpoint. `HoldRepository` is bound to its own
 *  token here rather than reused across modules — `AgendaModule` follows the
 *  same one-token-per-module pattern for `RolePermissionRepository`. */
@Module({
  imports: [AccessControlModule],
  controllers: [PhoneAppointmentController, AppointmentActionsController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: CLIENT_REPOSITORY, useFactory: () => new DrizzleClientRepository(db) },
    { provide: HOLD_REPOSITORY, useFactory: () => new DrizzleHoldRepository(db) },
    { provide: SERVICE_REPOSITORY, useFactory: () => new DrizzleServiceRepository(db) },
    {
      // Task 6.3's production half. `CreateHold` enqueues `hold.expire` on
      // every hold it creates, so the API is a pg-boss PRODUCER (the worker is
      // the consumer). Without this provider the module cannot be built at all.
      //
      // The factory is synchronous and `lazyJobSender()` defers the connection
      // to the first enqueue: building the module graph must not touch the
      // network, or the API stops booting whenever the queue's database is
      // down — and every Nest test dies before its first assertion.
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
      // E.2 (cablear-el-mvp Slice E): the same lazy-connect discipline as
      // HOLD_EXPIRE_SCHEDULER above — a synchronous factory, `lazyJobSender()`
      // defers the pg-boss connection to the first enqueue. An eager
      // `await jobSender()` here would open a connection while Nest is still
      // building the module graph and kill every test suite, exactly the
      // trap this file's own HOLD_EXPIRE_SCHEDULER comment already documents.
      provide: APPOINTMENT_REMINDER_SCHEDULER,
      useFactory: () => new PgBossAppointmentReminderScheduler(lazyJobSender()),
    },
    {
      provide: ScheduleAppointmentReminder,
      inject: [CLOCK, APPOINTMENT_REMINDER_SCHEDULER],
      useFactory: (clock: Clock, scheduler: AppointmentReminderScheduler) =>
        new ScheduleAppointmentReminder(clock, scheduler),
    },
    {
      provide: CreatePhoneAppointmentUseCase,
      inject: [
        CLIENT_REPOSITORY,
        HOLD_REPOSITORY,
        CreateHold,
        ScheduleAppointmentReminder,
        SERVICE_REPOSITORY,
        CLOCK,
        NOTIFICATION_OUTBOX_REPOSITORY,
        BARBER_REPOSITORY,
      ],
      useFactory: (
        clients: ClientRepository,
        holds: HoldRepository,
        createHold: CreateHold,
        scheduleReminder: ScheduleAppointmentReminder,
        services: ServiceRepository,
        clock: Clock,
        outbox: NotificationOutboxRepository,
        barbers: BarberRepository,
      ) =>
        new CreatePhoneAppointmentUseCase(
          clients,
          holds,
          createHold,
          scheduleReminder,
          services,
          clock,
          outbox,
          barbers,
        ),
    },
    // Slice B (cablear-el-mvp, B.1-B.5): bound to their own tokens here
    // rather than reused across modules — same one-token-per-module pattern
    // this file already follows for HOLD_REPOSITORY/CLIENT_REPOSITORY.
    { provide: APPOINTMENT_REPOSITORY, useFactory: () => new DrizzleAppointmentRepository(db) },
    { provide: ABSENCE_RECORD_REPOSITORY, useFactory: () => new DrizzleAbsenceRecordRepository(db) },
    {
      provide: PAYMENT_PORT,
      useFactory: () => new MercadoPagoPaymentAdapter(process.env.MERCADOPAGO_ACCESS_TOKEN ?? ''),
    },
    { provide: WALK_IN_REPOSITORY, useFactory: () => new DrizzleWalkInRepository(db) },
    {
      // panel-usable: EditAppointmentUseCase's own read-only lookup for the
      // barber name in the appointment_updated notification.
      provide: BARBER_REPOSITORY,
      useFactory: () => new DrizzleBarberRepository(db),
    },
    {
      // panel-usable: where EditAppointmentUseCase writes the
      // appointment_updated notification — same real adapter (migration
      // 0011) Slice A already wired for every other outbox writer.
      provide: NOTIFICATION_OUTBOX_REPOSITORY,
      useFactory: () => new DrizzleNotificationOutboxRepository(db),
    },
    {
      provide: AdminMarkCompletedUseCase,
      inject: [APPOINTMENT_REPOSITORY, CLOCK],
      useFactory: (appointments: AppointmentRepository, clock: Clock) =>
        new AdminMarkCompletedUseCase(appointments, clock),
    },
    {
      provide: AdminConfirmAbsenceUseCase,
      inject: [APPOINTMENT_REPOSITORY, ABSENCE_RECORD_REPOSITORY, CLOCK],
      useFactory: (appointments: AppointmentRepository, absences: AbsenceRecordRepository, clock: Clock) =>
        new AdminConfirmAbsenceUseCase(appointments, absences, clock),
    },
    {
      provide: BarberMarkCompletedUseCase,
      inject: [APPOINTMENT_REPOSITORY, CLOCK],
      useFactory: (appointments: AppointmentRepository, clock: Clock) =>
        new BarberMarkCompletedUseCase(appointments, clock),
    },
    {
      provide: BarberConfirmAbsenceUseCase,
      inject: [APPOINTMENT_REPOSITORY, ABSENCE_RECORD_REPOSITORY, CLOCK],
      useFactory: (appointments: AppointmentRepository, absences: AbsenceRecordRepository, clock: Clock) =>
        new BarberConfirmAbsenceUseCase(appointments, absences, clock),
    },
    {
      provide: EditAppointmentUseCase,
      inject: [APPOINTMENT_REPOSITORY, SERVICE_REPOSITORY, BARBER_REPOSITORY, CLIENT_REPOSITORY, NOTIFICATION_OUTBOX_REPOSITORY, CLOCK],
      useFactory: (
        appointments: AppointmentRepository,
        services: ServiceRepository,
        barbers: BarberRepository,
        clients: ClientRepository,
        outbox: NotificationOutboxRepository,
        clock: Clock,
      ) => new EditAppointmentUseCase(appointments, services, barbers, clients, outbox, clock),
    },
    {
      provide: AdminCancelAppointmentUseCase,
      inject: [APPOINTMENT_REPOSITORY, PAYMENT_PORT, CLOCK],
      useFactory: (appointments: AppointmentRepository, paymentPort: PaymentPort, clock: Clock) =>
        new AdminCancelAppointmentUseCase(appointments, paymentPort, clock),
    },
    {
      provide: CreateWalkInUseCase,
      inject: [WALK_IN_REPOSITORY, CLIENT_REPOSITORY, SERVICE_REPOSITORY, CLOCK],
      useFactory: (walkIns: WalkInRepository, clients: ClientRepository, services: ServiceRepository, clock: Clock) =>
        new CreateWalkInUseCase(walkIns, clients, services, clock),
    },
  ],
})
export class AppointmentsModule implements OnApplicationShutdown {
  /** pg-boss keeps its own pool open; without this the process hangs on exit. */
  async onApplicationShutdown(): Promise<void> {
    await stopJobSender();
  }
}
