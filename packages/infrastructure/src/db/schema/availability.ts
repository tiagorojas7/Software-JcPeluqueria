import { boolean, date, integer, pgTable, smallint, time, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Availability model (Phase 1, read-only). No FK to `users` yet — that
 * table arrives in Phase 3a. `dayOfWeek` matches the domain's `DayOfWeek`
 * convention: 0 (Sunday) … 6 (Saturday).
 */

export const barbers = pgTable('barbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  active: boolean('active').notNull().default(true),
});

export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  priceCents: integer('price_cents').notNull(),
});

export const shopHours = pgTable('shop_hours', {
  id: uuid('id').primaryKey().defaultRandom(),
  dayOfWeek: smallint('day_of_week').notNull(),
  opensAt: time('opens_at').notNull(),
  closesAt: time('closes_at').notNull(),
});

export const barberSchedules = pgTable('barber_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  barberId: uuid('barber_id')
    .notNull()
    .references(() => barbers.id),
  dayOfWeek: smallint('day_of_week').notNull(),
  opensAt: time('opens_at').notNull(),
  closesAt: time('closes_at').notNull(),
});

export const barberTimeOff = pgTable('barber_time_off', {
  id: uuid('id').primaryKey().defaultRandom(),
  barberId: uuid('barber_id')
    .notNull()
    .references(() => barbers.id),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
});
