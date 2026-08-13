import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ActorContext } from '@jc-barberia/domain';

import type { RequestWithActor } from '../request-with-actor';

/**
 * Extracts the `ActorContext` `ActorContextMiddleware` already attached to
 * the request. By the time a handler runs, `PermissionsGuard` has already
 * rejected any request without one (see its "no actor" branch) — this
 * decorator is a thin, type-safe accessor, never a second source of truth
 * for identity.
 */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): ActorContext => {
  const request = ctx.switchToHttp().getRequest<RequestWithActor>();
  if (!request.actor) {
    throw new Error('@CurrentActor() used on a route the guard let through without a resolved actor.');
  }
  return request.actor;
});
