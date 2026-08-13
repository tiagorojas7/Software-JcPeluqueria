import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { ActorContextRepository } from '@jc-barberia/domain';

import { ACTOR_CONTEXT_REPOSITORY } from './tokens';
import type { RequestWithActor } from './request-with-actor';
import { readSessionCookie } from './session-cookie';

interface MinimalRequest extends RequestWithActor {
  readonly headers: { readonly cookie?: string };
}

/**
 * Resolves `request.actor` from the session cookie, once per request,
 * BEFORE any guard runs — Nest's request pipeline always runs middleware
 * ahead of guards, which is exactly the ordering `PermissionsGuard` needs
 * (see its own doc comment on the `request.actor` seam). No cookie, or a
 * cookie that doesn't resolve to an active session, simply leaves
 * `request.actor` unset — the guard's existing "no actor" branch already
 * denies that case; this middleware never itself rejects a request.
 */
@Injectable()
export class ActorContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(ACTOR_CONTEXT_REPOSITORY)
    private readonly actorContexts: ActorContextRepository,
  ) {}

  async use(req: MinimalRequest, _res: unknown, next: (error?: unknown) => void): Promise<void> {
    const sessionId = readSessionCookie(req.headers.cookie);
    if (sessionId) {
      req.actor = (await this.actorContexts.resolveBySessionId(sessionId)) ?? undefined;
    }
    next();
  }
}
