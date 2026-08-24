import type { Clock } from '@jc-barberia/domain';

import type { TemplateRegistry } from './types';
import { accessTemplate } from './access.template';
import { createAbsenceReassignmentOfferTemplate } from './absence-reassignment-offer.template';
import { createAppointmentUpdatedTemplate } from './appointment-updated.template';
import { createBookingConfirmedTemplate } from './booking-confirmed.template';
import { createClientAccessCodeTemplate } from './client-access-code.template';
import { cancellationWithRefundTemplate } from './cancellation-with-refund.template';
import { createReminderWithDepositTemplate } from './reminder-with-deposit.template';
import { reminderWithoutDepositTemplate } from './reminder-without-deposit.template';

/**
 * Exhaustive registry of every `NotificationTemplate` to its renderer. The
 * reminder row forks by `DepositState`: `reminder_with_deposit` renders the
 * con-seña body ("última oportunidad" + the `turno − 1h` cutoff the `Clock`
 * computes) and `reminder_without_deposit` the plain body with no seña mention.
 * The clock is injected HERE so the templates own no offset math — the
 * `no-restricted-syntax` rule keeps `new Date()`/offset reads inside the clock.
 *
 * `absence_reassignment_offer` (barber-absence-reassignment, task 12.5/12.6)
 * renders the same-day alternative `GenerateAbsenceReassignmentOffers` just
 * claimed, with the hold's own cutoff.
 *
 * `booking_confirmed` (cablear-el-mvp item 1) renders the confirmation
 * `ProcessPaymentUseCase` enqueues the first time a web booking's deposit
 * settles — barber, service and the shop-local time, via the same clock.
 *
 * `appointment_updated` (panel-usable) renders the same "what is it now"
 * shape for `EditAppointmentUseCase`'s notification whenever staff edit a
 * turno's barbero, servicio or horario.
 *
 * `publicBaseUrl` (fix/acceso-cliente-sin-id) is the same `PUBLIC_BASE_URL`
 * `MercadoPagoPaymentAdapter` already reads (`apps/api/src/booking/booking.module.ts`)
 * — one source of truth for where this deployment is publicly reachable,
 * passed through only to `client_access_code`, the one template that
 * currently needs a link back into the app.
 */
export function createTemplateRegistry(clock: Clock, publicBaseUrl?: string): TemplateRegistry {
  return {
    staff_activation: accessTemplate,
    staff_password_reset: accessTemplate,
    cancellation_with_refund: cancellationWithRefundTemplate,
    reminder_with_deposit: createReminderWithDepositTemplate(clock),
    reminder_without_deposit: reminderWithoutDepositTemplate,
    absence_reassignment_offer: createAbsenceReassignmentOfferTemplate(clock),
    client_access_code: createClientAccessCodeTemplate(clock, publicBaseUrl),
    booking_confirmed: createBookingConfirmedTemplate(clock),
    appointment_updated: createAppointmentUpdatedTemplate(clock),
  };
}

export type { TemplateRegistry };
