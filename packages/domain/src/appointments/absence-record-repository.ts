import type { AbsenceRecord } from './absence-record';

/**
 * Persistence for the absence history (appointment-lifecycle spec, "Ausencia
 * confirmada sin seña previa": "el evento queda registrado en el historial de
 * ausencias del cliente"). `ConfirmAbsenceUseCase` (Phase 4) deliberately did
 * NOT persist this — its doc said it is "a later phase's concern (whichever
 * phase wires `ConfirmAbsenceUseCase` to a repository)". Phase 10 is that
 * phase: this port is the seam. `record` is called for EVERY confirmed
 * absence, with or without a seña, because the history entry is the whole
 * point when there is no money to move.
 */
export interface AbsenceRecordRepository {
  record(absence: AbsenceRecord): Promise<void>;
}
