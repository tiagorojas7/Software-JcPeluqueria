import type { AbsenceRecord, AbsenceRecordRepository } from '@jc-barberia/domain';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { clientAbsences } from '../db/schema/client-absences';

/**
 * The repository seam `ConfirmAbsenceUseCase` waited for (Phase 10, task
 * 10.11): one `INSERT` per confirmed absence, with the `AbsenceRecord`'s
 * fields mapped straight onto the `client_absences` columns. Records a row
 * for every confirmed no-show regardless of `depositForfeited` — that flag
 * is just stored, not used to decide whether to write, so a phone booking
 * with no seña ends up in the history exactly like a paid web booking.
 */
export class DrizzleAbsenceRecordRepository implements AbsenceRecordRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async record(absence: AbsenceRecord): Promise<void> {
    await this.db.insert(clientAbsences).values({
      appointmentId: absence.appointmentId,
      clientId: absence.clientId,
      confirmedByUserId: absence.confirmedByUserId,
      confirmedAt: absence.confirmedAt,
      depositForfeited: absence.depositForfeited,
    });
  }
}
