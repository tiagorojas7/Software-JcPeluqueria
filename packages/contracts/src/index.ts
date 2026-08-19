// Shared types/schemas between apps/api and apps/web. First schema lands
// with the feature that needs it (starting Phase 3a/9); this package was
// only scaffolded in Phase 0.
export type {
  AccountAppointmentResponse,
  ListOwnAppointmentsResponse,
  SelfCancelAppointmentResponseBody,
} from './account';
export type { MarkBarberAbsentRequest, MarkBarberAbsentResponse } from './absence-reassignment';
export { MarkBarberAbsentRequestSchema } from './absence-reassignment';
export type { DayBoardColumn, DayBoardResponse, DayBoardSlot, SlotAction } from './agenda';
export { SLOT_ACTIONS } from './agenda';
export type {
  AppointmentResponse,
  ConfirmAbsenceResponseBody,
  CreatePhoneAppointmentRequest,
  CreateWalkInRequest,
  EditAppointmentRequest,
  PhoneAppointmentResponse,
  WalkInResponse,
} from './appointments';
export {
  CreatePhoneAppointmentRequestSchema,
  CreateWalkInRequestSchema,
  EditAppointmentRequestSchema,
} from './appointments';
export type { BarberRevenueResponse, BarberStatsResponse } from './barbers';
export type {
  ClientLoginRequest,
  ClientLoginResponseBody,
  RequestClientAccessRequest,
  RequestClientAccessResponseBody,
  StaffLoginRequest,
  StaffLoginResponseBody,
} from './identity';
export { ClientLoginRequestSchema, RequestClientAccessRequestSchema, StaffLoginRequestSchema } from './identity';
export type {
  AvailabilityResponse,
  AvailabilitySlot,
  CheckoutRequest,
  CheckoutResponseBody,
  ConfirmReservationRequest,
  ConfirmReservationResponse,
  CreateHoldRequest,
  GetAvailabilityQuery,
  HoldResponse,
} from './booking';
export {
  CheckoutRequestSchema,
  ConfirmReservationRequestSchema,
  CreateHoldRequestSchema,
  GetAvailabilityQuerySchema,
} from './booking';
export type {
  AddBarberRequest,
  BarberResponse,
  ClientRecordResponse,
  ClientsListResponse,
  ConfigureBarberScheduleRequest,
  ConfigureServicePriceRequest,
} from './panel';
export {
  AddBarberRequestSchema,
  ConfigureBarberScheduleRequestSchema,
  ConfigureServicePriceRequestSchema,
} from './panel';
