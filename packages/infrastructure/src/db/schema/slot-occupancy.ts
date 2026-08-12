import {
  boolean,
  customType,
  pgTable,
  timestamp,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { barbers, services } from './availability';

/**
 * `tstzrange` has no first-class Drizzle type. It stays as its raw text
 * literal (`["2026-09-01T12:00:00Z","2026-09-01T12:30:00Z")`) at this
 * boundary: the repository builds the literal and reads the bounds back with
 * `lower()`/`upper()`, so no `Date` is ever constructed outside `ShopClock`.
 */
const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });

/** Statuses that consume the barber's time. Mirrors the EXCLUDE predicate in migration 0003. */
export const OCCUPYING_STATUSES = ['held', 'reservado', 'realizado'] as const;

/**
 * One physical table for every kind of occupancy: a hold, a booked
 * appointment and a walk-in all consume the same barber time. Confirming a
 * hold is therefore a status transition, never a second INSERT, so the window
 * in which somebody else could slip in never exists.
 *
 * Exclusivity lives in the `no_overlap_per_barber` EXCLUDE constraint
 * (migration 0003), not here — Drizzle cannot express it.
 *
 * `client_id` and `deposit_id` carry no foreign key yet: `clients` and
 * `deposits` arrive in later phases and will add the constraint then.
 */
export const slotOccupancies = pgTable('slot_occupancies', {
  id: uuid('id').primaryKey().defaultRandom(),
  barberId: uuid('barber_id')
    .notNull()
    .references(() => barbers.id),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id),
  clientId: uuid('client_id'),
  channel: varchar('channel', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  timeRange: tstzrange('time_range').notNull(),
  /** Only set while `status = 'held'`. */
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  /** A hold with a payment in flight is never released by the timer. */
  paymentPending: boolean('payment_pending').notNull().default(false),
  /** The appointment this row was offered as a replacement for (absence flow). */
  originOccupancyId: uuid('origin_occupancy_id').references((): AnyPgColumn => slotOccupancies.id),
  depositId: uuid('deposit_id'),
});
