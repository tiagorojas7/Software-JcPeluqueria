import { Module, type OnApplicationShutdown } from '@nestjs/common';
import {
  CheckoutUseCase,
  CreateHold,
  GetPublicAvailabilityUseCase,
  ListPublicBarbersUseCase,
  ListPublicServicesUseCase,
  RegisterClientUseCase,
} from '@jc-barberia/application';
import {
  db,
  DrizzleBarberRepository,
  DrizzleClientAccountRepository,
  DrizzleClientRepository,
  DrizzleFreeRangesQuery,
  DrizzleHoldRepository,
  DrizzleScheduleRepository,
  DrizzleServiceRepository,
  lazyJobSender,
  MercadoPagoPaymentAdapter,
  PgBossHoldExpireScheduler,
  ShopClock,
  stopJobSender,
} from '@jc-barberia/infrastructure';
import type {
  BarberRepository,
  Clock,
  ClientAccountRepository,
  ClientRepository,
  FreeRangesQuery,
  HoldExpireScheduler,
  HoldRepository,
  PaymentPort,
  ScheduleRepository,
  ServiceRepository,
} from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { AvailabilityController } from './availability.controller';
import { HoldController } from './hold.controller';
import { ListPublicBarbersController, ListPublicServicesController } from './public-offerings.controller';
import {
  BARBER_REPOSITORY,
  CLIENT_ACCOUNT_REPOSITORY,
  CLIENT_REPOSITORY,
  CLOCK,
  FREE_RANGES_QUERY,
  HOLD_EXPIRE_SCHEDULER,
  HOLD_REPOSITORY,
  PAYMENT_PORT,
  SCHEDULE_REPOSITORY,
  SERVICE_REPOSITORY,
} from './tokens';

/**
 * Wires task 9.1/9.2's public availability endpoint and task 9.3/9.4's
 * public hold endpoint. `AccessControlModule` is still imported —
 * `PermissionsGuard` is global (deny-by-default applies to every
 * controller, `@Public()` included: the guard has to run and see the
 * decorator to let the request through, it does not simply skip undecorated
 * modules). `HOLD_EXPIRE_SCHEDULER` follows the exact same pg-boss producer
 * pattern `AppointmentsModule` already established for `CreateHold`.
 */
@Module({
  imports: [AccessControlModule],
  controllers: [AvailabilityController, HoldController, ListPublicBarbersController, ListPublicServicesController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: BARBER_REPOSITORY, useFactory: () => new DrizzleBarberRepository(db) },
    { provide: SERVICE_REPOSITORY, useFactory: () => new DrizzleServiceRepository(db) },
    { provide: SCHEDULE_REPOSITORY, useFactory: () => new DrizzleScheduleRepository(db) },
    { provide: FREE_RANGES_QUERY, useFactory: () => new DrizzleFreeRangesQuery(db) },
    { provide: HOLD_REPOSITORY, useFactory: () => new DrizzleHoldRepository(db) },
    {
      // Synchronous on purpose: `lazyJobSender()` defers the pg-boss
      // connection to the first enqueue. Building the module graph must not
      // touch the network, or a queue outage stops the whole API from
      // booting — and every Nest test dies before its first assertion.
      provide: HOLD_EXPIRE_SCHEDULER,
      useFactory: () => new PgBossHoldExpireScheduler(lazyJobSender()),
    },
    {
      provide: GetPublicAvailabilityUseCase,
      inject: [BARBER_REPOSITORY, SERVICE_REPOSITORY, SCHEDULE_REPOSITORY, FREE_RANGES_QUERY, CLOCK],
      useFactory: (
        barbers: BarberRepository,
        services: ServiceRepository,
        schedules: ScheduleRepository,
        freeRangesQuery: FreeRangesQuery,
        clock: Clock,
      ) => new GetPublicAvailabilityUseCase(barbers, services, schedules, freeRangesQuery, clock),
    },
    {
      provide: ListPublicBarbersUseCase,
      inject: [BARBER_REPOSITORY],
      useFactory: (barbers: BarberRepository) => new ListPublicBarbersUseCase(barbers),
    },
    {
      provide: ListPublicServicesUseCase,
      inject: [SERVICE_REPOSITORY],
      useFactory: (services: ServiceRepository) => new ListPublicServicesUseCase(services),
    },
    {
      provide: CreateHold,
      inject: [HOLD_REPOSITORY, CLOCK, HOLD_EXPIRE_SCHEDULER],
      useFactory: (holds: HoldRepository, clock: Clock, holdExpire: HoldExpireScheduler) =>
        new CreateHold(holds, clock, holdExpire),
    },
    { provide: CLIENT_REPOSITORY, useFactory: () => new DrizzleClientRepository(db) },
    {
      provide: CLIENT_ACCOUNT_REPOSITORY,
      useFactory: () => new DrizzleClientAccountRepository(db),
    },
    {
      // Task 9.7/9.8 — the account is created at the END of the booking flow,
      // never at the start. No password parameter reaches this graph at any
      // point: `ClientAccountRepository.create` structurally cannot accept one.
      provide: RegisterClientUseCase,
      inject: [CLIENT_REPOSITORY, CLIENT_ACCOUNT_REPOSITORY, HOLD_REPOSITORY],
      useFactory: (
        clients: ClientRepository,
        accounts: ClientAccountRepository,
        holds: HoldRepository,
      ) => new RegisterClientUseCase(clients, accounts, holds),
    },
    {
      // Task 9.11/9.12 — the seam this token was declared for and nothing
      // ever bound: MercadoPago is a plain HTTP client, so unlike
      // `HOLD_EXPIRE_SCHEDULER` there is no pg-boss laziness concern here.
      //
      // cablear-el-mvp item 2: this is the ONLY `MercadoPagoPaymentAdapter`
      // instance whose `createPreference` a real request ever reaches (via
      // `CheckoutUseCase` below) — the third argument, `PUBLIC_BASE_URL`,
      // is what puts `back_urls`/`auto_return`/`notification_url` on the
      // preference. Left undefined (every other module's own adapter
      // instance, used only for `getPayment`/`refund`) keeps today's
      // behavior exactly as it was.
      provide: PAYMENT_PORT,
      useFactory: () =>
        new MercadoPagoPaymentAdapter(
          process.env.MERCADOPAGO_ACCESS_TOKEN ?? '',
          undefined,
          process.env.PUBLIC_BASE_URL,
          // Con credenciales de prueba hay que cobrar en el checkout de
          // sandbox: el productivo rechaza las tarjetas de prueba. Explicito
          // porque la respuesta de MercadoPago trae las dos URLs siempre y no
          // permite deducir cual corresponde.
          process.env.MERCADOPAGO_SANDBOX === 'true',
        ),
    },
    {
      // client-booking: "Reserva web con seña obligatoria del 50%" — reuses
      // `CheckoutUseCase` (5.6) exactly, no second payment path. The 50%
      // math and the re-validate-then-charge order live entirely in that
      // class; this module only supplies its three ports.
      provide: CheckoutUseCase,
      inject: [HOLD_REPOSITORY, PAYMENT_PORT, CLOCK],
      useFactory: (holds: HoldRepository, paymentPort: PaymentPort, clock: Clock) =>
        new CheckoutUseCase(holds, paymentPort, clock),
    },
  ],
})
export class BookingModule implements OnApplicationShutdown {
  /** pg-boss keeps its own pool open; without this the process hangs on
   *  exit — same reason `AppointmentsModule` implements this too. */
  async onApplicationShutdown(): Promise<void> {
    await stopJobSender();
  }
}
