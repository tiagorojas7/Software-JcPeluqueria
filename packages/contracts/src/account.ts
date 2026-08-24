/**
 * Wire contracts for "Mi cuenta" (cablear-el-mvp Slice C, C.3/C.4/C.5): the
 * authenticated client's own appointments and self-service cancellation.
 * Deliberately no zod request schema here — both routes take their identity
 * from the session (`@RequiresClientSession()` / `@CurrentClient()`, never
 * the request body), and `cancel` takes no body at all, only the `:id` path
 * param.
 */

export interface AccountAppointmentResponse {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  /**
   * Raw `AppointmentStatus` passthrough — the same posture
   * `DayBoardSlot.status` already takes: a plain string here, never a
   * duplicate closed union, since `packages/domain` owns that vocabulary.
   */
  readonly status: string;
  /** ISO instants. */
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface ListOwnAppointmentsResponse {
  readonly appointments: readonly AccountAppointmentResponse[];
}

/**
 * Mirrors `SelfCancelResult['outcome']`
 * (`packages/application/src/appointments/self-cancel-appointment.ts`)
 * exactly, adding only the wire-safe representation of what does not survive
 * JSON as-is: `cutoff` travels as an ISO instant, never a `Date`.
 */
export type SelfCancelAppointmentResponseBody =
  | { readonly outcome: 'cancelled'; readonly appointment: AccountAppointmentResponse }
  | { readonly outcome: 'too-late'; readonly cutoff: string }
  | { readonly outcome: 'not-yours' }
  | { readonly outcome: 'not-cancellable' };

/**
 * panel-usable: "the owner wants their stored details filled in
 * automatically, confirmed once, and then straight to paying the deposit"
 * for a returning client — today they retype name/email/phone on every
 * booking even though the shop already has them on file.
 * `GET /account/profile` is the plumbing that reads them back, same
 * session-only identity discipline as every other route on this
 * controller.
 */
export interface AccountProfileResponse {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly age: number | null;
}
