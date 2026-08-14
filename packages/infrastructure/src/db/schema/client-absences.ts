import { boolean, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { slotOccupancies } from './slot-occupancy';
import { users } from './identity';

/**
 * The absence history the appointment-lifecycle spec calls "historial de
 * ausencias del cliente". One row per confirmed absence — created for EVERY
 * confirmed no-show, with or without a seña, because when there is no money
 * to move the history entry is the entire effect (appointment-lifecycle spec,
 * "Ausencia confirmada sin seña previa"). The domain `AbsenceRecord` maps
 * 1:1 onto a row here; `ConfirmAbsenceUseCase` produces the record and Phase
 * 10's `AbsenceRecordRepository` persists it.
 */
export const clientAbsences = pgTable('client_absences', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointmentId: uuid('appointment_id')
    .notNull()
    .references(() => slotOccupancies.id),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id),
  confirmedByUserId: uuid('confirmed_by_user_id')
    .notNull()
    .references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
  depositForfeited: boolean('deposit_forfeited').notNull(),
});
