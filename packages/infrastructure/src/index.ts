export { ShopClock } from './shared/clock/shop-clock';
export { db } from './db/connection';
export { DrizzleBarberRepository } from './availability/barber.repository';
export { DrizzleServiceRepository } from './availability/service.repository';
export { DrizzleScheduleRepository } from './availability/schedule.repository';
export { DrizzleAppointmentSweepRepository } from './booking/appointment-sweep.repository';
export { DrizzleFreeRangesQuery } from './booking/free-ranges-query.repository';
export { DrizzleRolePermissionRepository } from './access-control/role-permission.repository';
export { DrizzleActorContextRepository } from './access-control/actor-context.repository';
export { DrizzleAgendaRepository } from './access-control/agenda.repository';
export { DrizzleDepositRepository } from './payments/deposit.repository';
export { DrizzlePaymentEventRepository } from './payments/payment-event.repository';
export { MercadoPagoApiError, MercadoPagoPaymentAdapter } from './payments/mercadopago-payment.adapter';
export { verifyMercadoPagoSignature } from './payments/mercadopago-signature';
export type { WebhookSignatureInput } from './payments/mercadopago-signature';
export { PAYMENT_PROCESS_QUEUE, PgBossPaymentJobQueue } from './payments/pg-boss-payment-job-queue';
export { ConsoleNotificationAdapter } from './notifications/console-notification.adapter';
export { ConsoleNotificationOutboxRepository } from './notifications/console-notification-outbox.repository';
export { GmailNotificationAdapter } from './notifications/gmail-notification.adapter';
export type { GmailAdapterConfig, GmailAdapterDeps } from './notifications/gmail-notification.adapter';
export { createNotificationPort } from './notifications/notification-adapter';
export type {
  NotificationChannel,
  NotificationChannelConfig,
  NotificationChannelDeps,
} from './notifications/notification-adapter';
export { DrizzleDayBoardRepository } from './agenda/day-board.repository';
export { DrizzleHoldRepository } from './booking/hold.repository';
export { HOLD_EXPIRE_QUEUE, PgBossHoldExpireScheduler } from './booking/pg-boss-hold-expire-scheduler';
export type { HoldExpireJob, JobSender, TransactionalDb } from './booking/pg-boss-hold-expire-scheduler';
export { jobSender, lazyJobSender, stopJobSender } from './booking/job-producer';
export { DrizzleWalkInRepository } from './booking/walk-in.repository';
export { DrizzleClientRepository } from './clients/client.repository';
export { DrizzleUserCredentialsRepository } from './identity/user-credentials.repository';
export { Argon2PasswordHasher } from './identity/argon2-password-hasher';
export { DrizzleAuthChallengeRepository } from './identity/auth-challenge.repository';
export { DrizzleSessionRepository } from './identity/session.repository';
export { DrizzleClientAccountRepository } from './identity/client-account.repository';
export { DrizzleClientContextRepository } from './identity/client-context.repository';
export { DrizzleAppointmentRepository } from './appointments/appointment.repository';
export { DrizzleAbsenceRecordRepository } from './appointments/absence-record.repository';
export { DrizzleBarberPerformanceRepository } from './barbers/barber-performance.repository';
