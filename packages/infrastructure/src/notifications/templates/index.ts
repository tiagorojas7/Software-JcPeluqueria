import type { Clock } from '@jc-barberia/domain';

import type { TemplateRegistry } from './types';
import { accessTemplate } from './access.template';
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
 * The reasignación offer ("oferta de reasignación por ausencia de barbero") is
 * NOT here: it has no `NotificationTemplate` member yet — Phase 12 (task 12.5)
 * adds both the type and its outbox writer, then a renderer here.
 */
export function createTemplateRegistry(clock: Clock): TemplateRegistry {
  return {
    staff_activation: accessTemplate,
    staff_password_reset: accessTemplate,
    cancellation_with_refund: cancellationWithRefundTemplate,
    reminder_with_deposit: createReminderWithDepositTemplate(clock),
    reminder_without_deposit: reminderWithoutDepositTemplate,
  };
}

export type { TemplateRegistry };
