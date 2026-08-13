/**
 * The domain-level proof that an absence was confirmed — produced even when
 * there was no deposit to lose (appointment-lifecycle spec, "Ausencia
 * confirmada sin seña previa": "el evento queda registrado en el historial
 * de ausencias del cliente"). Persisting this into an actual history table
 * is a later phase's concern (whichever phase wires `ConfirmAbsenceUseCase`
 * to a repository); this phase's contract is that the use case always
 * produces one, regardless of `depositForfeited`.
 */
export interface AbsenceRecord {
  readonly appointmentId: string;
  readonly clientId: string;
  readonly confirmedByUserId: string;
  readonly confirmedAt: Date;
  readonly depositForfeited: boolean;
}
