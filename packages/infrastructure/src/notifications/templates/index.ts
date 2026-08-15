import type { TemplateRegistry } from './types';

import { accessTemplate } from './access.template';
import { cancellationWithRefundTemplate } from './cancellation-with-refund.template';
import { genericReminderTemplate } from './generic-reminder.template';

/**
 * Exhaustive registry of every `NotificationTemplate` to its renderer. 7.8 maps
 * BOTH reminder variants to the same generic body; 7.11 splits the reminder row
 * into the two `DepositState`-aware renderers (con-seña renders the
 * "última oportunidad" cutoff, sin-seña omits any seña mention), at which point
 * `createTemplateRegistry` will take the `Clock` the cutoff computation needs.
 *
 * The reasignación offer ("oferta de reasignación por ausencia de barbero") is
 * NOT here: it has no `NotificationTemplate` member yet — Phase 12 (task 12.5)
 * adds both the type and its outbox writer, then a renderer here.
 */
export function createTemplateRegistry(): TemplateRegistry {
  return {
    staff_activation: accessTemplate,
    staff_password_reset: accessTemplate,
    cancellation_with_refund: cancellationWithRefundTemplate,
    reminder_with_deposit: genericReminderTemplate,
    reminder_without_deposit: genericReminderTemplate,
  };
}

export type { TemplateRegistry };
