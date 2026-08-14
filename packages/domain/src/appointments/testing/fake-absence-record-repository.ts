import type { AbsenceRecord } from '../absence-record';
import type { AbsenceRecordRepository } from '../absence-record-repository';

/**
 * In-memory `AbsenceRecordRepository` test double — same role the other
 * fakes play for their repos. Real uniqueness/replay semantics only exist
 * against PostgreSQL (see `DrizzleAbsenceRecordRepository`'s Testcontainers
 * suite); this fake only has to support the application-layer flows that
 * persist absences: capture what was recorded so the absence history is
 * assertable without a database.
 */
export class FakeAbsenceRecordRepository implements AbsenceRecordRepository {
  readonly recordCalls: AbsenceRecord[] = [];

  async record(absence: AbsenceRecord): Promise<void> {
    this.recordCalls.push(absence);
  }
}
