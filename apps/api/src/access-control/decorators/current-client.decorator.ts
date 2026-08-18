import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ClientContext } from '@jc-barberia/domain';

import type { RequestWithActor } from '../request-with-actor';

/**
 * Extracts the `ClientContext` `PermissionsGuard` already resolved and
 * attached to the request while checking `@RequiresClientSession()` — the
 * client counterpart of `@CurrentActor()`. By the time a handler runs, the
 * guard has already rejected any request without a resolved client; this
 * decorator is a thin, type-safe accessor, never a second source of truth
 * for identity. In particular: `clientId` here is `users.client_id`, the
 * value every self-service use case (`SelfCancelAppointmentUseCase`,
 * `ListOwnAppointmentsUseCase`) scopes its query by — NEVER take a client id
 * from the request body/query instead of this decorator.
 */
export const CurrentClient = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientContext => {
  const request = ctx.switchToHttp().getRequest<RequestWithActor>();
  if (!request.client) {
    throw new Error('@CurrentClient() used on a route the guard let through without a resolved client.');
  }
  return request.client;
});
