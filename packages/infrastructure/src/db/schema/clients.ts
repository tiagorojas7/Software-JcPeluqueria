import { integer, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * design.md's schema table: "nombre, teléfono, email, edad opcional". First
 * real writer is Phase 10 (phone appointments); Phase 9 (web account at the
 * end of the booking flow) writes here too once built. `email`/`age` stay
 * nullable — a client with no email is a first-class case (admin-operations
 * spec, "Consecuencias de un turno telefónico sin email"), not an error.
 */
export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  phone: varchar('phone', { length: 30 }).notNull(),
  email: varchar('email', { length: 255 }),
  age: integer('age'),
});
