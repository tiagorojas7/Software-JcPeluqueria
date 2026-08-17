// Shared types/schemas between apps/api and apps/web. First schema lands
// with the feature that needs it (starting Phase 3a/9); this package was
// only scaffolded in Phase 0.
export type { DayBoardColumn, DayBoardResponse, DayBoardSlot, SlotAction } from './agenda';
export { SLOT_ACTIONS } from './agenda';
export type { CreatePhoneAppointmentRequest, PhoneAppointmentResponse } from './appointments';
export { CreatePhoneAppointmentRequestSchema } from './appointments';
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
