import { Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { AcceptOfferUseCase, RejectOfferUseCase } from '@jc-barberia/application';
import type {
  AccountAppointmentResponse,
  AcceptOfferResponseBody,
  RejectOfferResponseBody,
} from '@jc-barberia/contracts';
import type { Appointment, Clock, ClientContext, HoldRepository } from '@jc-barberia/domain';

import { CurrentClient } from '../access-control/decorators/current-client.decorator';
import { RequiresClientSession } from '../access-control/decorators/requires-client-session.decorator';
import { CLOCK, HOLD_REPOSITORY } from './tokens';

// Same mapping `AccountController` uses for "Mi cuenta" — duplicated rather
// than imported across the identity/absence-reassignment feature boundary
// for one three-line function; both copies are trivial to keep in sync if
// `AccountAppointmentResponse` ever grows a field.
function toAccountAppointmentResponse(appointment: Appointment): AccountAppointmentResponse {
  return {
    id: appointment.id,
    barberId: appointment.barberId,
    serviceId: appointment.serviceId,
    status: appointment.status,
    startsAt: appointment.timeRange.start.toISOString(),
    endsAt: appointment.timeRange.end.toISOString(),
  };
}

/**
 * C.6 (cablear-el-mvp Slice C): the client's own accept/reject routes for a
 * barber-absence-reassignment offer, reached from the offer notification —
 * `AccountController`'s own posture is the precedent copied here:
 * `@RequiresClientSession()` at the class level (a client is never in the
 * roles matrix, so `@RequiresPermission` structurally cannot express this),
 * identity always from `@CurrentClient()`, never the request body/a bare
 * path id, and no zod request schema — both routes take no body at all.
 *
 * Ownership is verified HERE, against the OFFER HOLD itself (`holds.clientId`
 * — the client `GenerateAbsenceReassignmentOffers.notifyClient` originally
 * notified), before either use case ever runs. `SelfCancelAppointmentUseCase`
 * collapses "missing" and "not yours" into the exact same outcome so a
 * prober learns nothing about a hold that is not theirs, including whether
 * it exists at all — the same discipline applied here: a holdId that does
 * not exist, does not carry an offer (`originOccupancyId === null`), belongs
 * to someone else, or already lapsed (`holdExpiresAt` in the past, checked
 * against `Clock.now()` rather than trusting a not-yet-swept row) all answer
 * with the exact same outcome the use case itself already uses for "this
 * offer is gone" (`offer-expired` / `not-cancellable`) — never a distinct
 * "forbidden" response that would turn this endpoint into an enumeration
 * oracle over other clients' offers.
 */
@RequiresClientSession()
@Controller('account/offers')
export class OffersController {
  constructor(
    // NEVER name these the same as their own route handler methods below
    // (`accept`/`reject`) — see `MarkBarberAbsentController`'s own doc
    // comment for why a same-named instance property breaks
    // `PermissionsGuard`'s metadata read.
    private readonly acceptOfferUseCase: AcceptOfferUseCase,
    private readonly rejectOfferUseCase: RejectOfferUseCase,
    @Inject(HOLD_REPOSITORY) private readonly holds: HoldRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post(':holdId/accept')
  @HttpCode(200)
  async accept(
    @Param('holdId') holdId: string,
    @CurrentClient() client: ClientContext,
  ): Promise<AcceptOfferResponseBody> {
    const offer = await this.holds.findById(holdId);
    if (!isLiveOfferOwnedBy(offer, client.clientId, this.clock.now())) {
      return { outcome: 'offer-expired' };
    }

    const searchWindow = this.clock.businessDayBounds(this.clock.calendarDateOf(offer.timeRange.start));
    const result = await this.acceptOfferUseCase.execute({ offerHoldId: holdId, searchWindow });

    switch (result.outcome) {
      case 'reassigned':
        return { outcome: 'reassigned' };
      case 'offer-expired':
        return { outcome: 'offer-expired' };
      case 'slot-taken':
        return {
          outcome: 'slot-taken',
          alternatives: result.alternatives.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
        };
    }
  }

  @Post(':holdId/reject')
  @HttpCode(200)
  async reject(
    @Param('holdId') holdId: string,
    @CurrentClient() client: ClientContext,
  ): Promise<RejectOfferResponseBody> {
    const offer = await this.holds.findById(holdId);
    if (!isLiveOfferOwnedBy(offer, client.clientId, this.clock.now())) {
      return { outcome: 'not-cancellable' };
    }

    const result = await this.rejectOfferUseCase.execute({ originalAppointmentId: offer.originOccupancyId });

    return result.outcome === 'cancelled'
      ? { outcome: 'cancelled', appointment: toAccountAppointmentResponse(result.appointment) }
      : { outcome: 'not-cancellable' };
  }
}

/**
 * Narrows `offer` to a still-open barber-absence-reassignment offer that
 * belongs to `clientId` — the single choke point both handlers above run
 * through before ever calling a use case, so "does not exist", "is not an
 * offer" (an ordinary client-booking hold, `originOccupancyId === null`),
 * "belongs to someone else" and "already past its own `holdExpiresAt`" are
 * structurally impossible to tell apart from the response alone.
 */
function isLiveOfferOwnedBy(
  offer: Awaited<ReturnType<HoldRepository['findById']>>,
  clientId: string,
  now: Date,
): offer is NonNullable<typeof offer> & { originOccupancyId: string } {
  return (
    offer !== null &&
    offer.originOccupancyId !== null &&
    offer.clientId === clientId &&
    offer.holdExpiresAt > now
  );
}
