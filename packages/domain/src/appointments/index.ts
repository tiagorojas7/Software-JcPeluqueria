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
