import {
  boolean,
  date,
  integer,
  pgTable,
  smallint,
  time,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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

// Unique on dayOfWeek: horario corrido is a confirmed business rule (see
// packages/domain/src/availability/entities.ts) — at most one contiguous
// open/close range per day of week, never a second row for a "second
// shift". Without this, AvailabilityService.workingWindows()'s `.find()`
// would silently pick whichever row Postgres happens to return first.
export const shopHours = pgTable(
  'shop_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dayOfWeek: smallint('day_of_week').notNull(),
    opensAt: time('opens_at').notNull(),
    closesAt: time('closes_at').notNull(),
  },
  (table) => [unique('shop_hours_day_of_week_unique').on(table.dayOfWeek)],
);

// Same horario corrido rule, scoped per barber: at most one schedule row
// per (barberId, dayOfWeek).
export const barberSchedules = pgTable(
  'barber_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    barberId: uuid('barber_id')
      .notNull()
      .references(() => barbers.id),
    dayOfWeek: smallint('day_of_week').notNull(),
    opensAt: time('opens_at').notNull(),
    closesAt: time('closes_at').notNull(),
  },
  (table) => [
    unique('barber_schedules_barber_id_day_of_week_unique').on(table.barberId, table.dayOfWeek),
  ],
);

export const barberTimeOff = pgTable('barber_time_off', {
  id: uuid('id').primaryKey().defaultRandom(),
  barberId: uuid('barber_id')
    .notNull()
    .references(() => barbers.id),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
});
