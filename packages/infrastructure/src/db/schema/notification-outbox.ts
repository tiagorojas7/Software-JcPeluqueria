import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Transactional-outbox row (design.md line 424: "El dominio no manda
 * mensajes: escribe una intención en `notification_outbox` dentro de la misma
 * transacción que produjo el hecho"). `status` mirrors the domain's
 * `NotificationOutboxStatus`: `pending` rows are eligible for delivery,
 * `delivered` once `NotificationPort.send()` resolved, `dead` once the
 * backoff cap (`MAX_DELIVERY_ATTEMPTS`, see `notification-outbox.repository.ts`)
 * is exhausted — surfaced for human inspection, never retried past that point.
 *
 * `next_attempt_at` is not literally in the tracker's column list
 * (`notification_type`/`recipient_email`/`payload`/`attempts`/`status`/
 * `last_error`/`created_at`) — it is the infra decision the domain port's own
 * contract asks for (`packages/domain/src/notifications/notification-outbox.ts`:
 * "the backoff handled entirely HERE so the consumer never computes a due
 * time"). Without it, `pickPendingForDelivery` would have no column to test
 * to skip a just-failed row until its backoff window elapses.
 */
export const notificationOutbox = pgTable('notification_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  notificationType: varchar('notification_type', { length: 40 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
  payload: jsonb('payload').notNull(),
  attempts: integer('attempts').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  lastError: text('last_error'),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
