import { integer, jsonb, pgTable, timestamp, uuid, varchar, boolean } from 'drizzle-orm/pg-core';

/**
 * One row per settled or refunded MercadoPago payment. `paymentId` is
 * `UNIQUE` on purpose — it is the idempotency guard: a webhook retry for a
 * payment already recorded here hits `ON CONFLICT DO NOTHING` and affects
 * zero rows, exactly like `HoldRepository.confirm()`'s zero-rows-means-lost
 * shape (see `DrizzleDepositRepository.recordSettledPayment`).
 */
export const deposits = pgTable('deposits', {
  id: uuid('id').primaryKey().defaultRandom(),
  amountCents: integer('amount_cents').notNull(),
  paymentId: varchar('payment_id', { length: 100 }).notNull().unique(),
  state: varchar('state', { length: 20 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Raw audit trail of every webhook call received, valid signature or not —
 * `signatureValid: false` rows are exactly the "cero efectos en el dominio"
 * evidence the invalid-signature threat-matrix test relies on: the event is
 * recorded, nothing else happens.
 */
export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: varchar('payment_id', { length: 100 }).notNull(),
  rawPayload: jsonb('raw_payload').notNull(),
  signatureValid: boolean('signature_valid').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
