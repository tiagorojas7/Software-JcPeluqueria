export {
  AppointmentStateMachine,
  InvalidAppointmentTransitionError,
} from './appointment-state-machine';
export { APPOINTMENT_STATUSES } from './appointment-status';
export type { AppointmentStatus } from './appointment-status';
export type { DepositState } from './deposit-state';
export type { PaymentPort, RefundResult } from './payment-port';
export {
  UnexpectedDepositStateError,
  resolveDepositForAbsence,
  resolveDepositForCancellation,
  resolveDepositForCompletion,
} from './deposit-transitions';
export { FakePaymentPort } from './testing/fake-payment-port';
export type { RecordedRefundCall } from './testing/fake-payment-port';
export type { Appointment } from './appointment';
export { MarkCompletedUseCase } from './mark-completed';
export type { MarkCompletedInput } from './mark-completed';
export type { AbsenceRecord } from './absence-record';
export type { AbsenceRecordRepository } from './absence-record-repository';
export { ConfirmAbsenceUseCase, MissingActorError } from './confirm-absence';
export type { ConfirmAbsenceInput, ConfirmAbsenceResult } from './confirm-absence';
export { AppointmentNotFoundError } from './appointment-repository';
export type {
  AppointmentRepository,
  AppointmentScheduleChange,
} from './appointment-repository';
export { FakeAppointmentRepository } from './testing/fake-appointment-repository';
export { FakeAbsenceRecordRepository } from './testing/fake-absence-record-repository';
