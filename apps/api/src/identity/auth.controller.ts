import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { SessionService, StaffLoginUseCase } from '@jc-barberia/application';
import { StaffLoginRequestSchema, type StaffLoginResponseBody } from '@jc-barberia/contracts';
import type { ActorContextRepository } from '@jc-barberia/domain';

import { Public } from '../access-control/decorators/public.decorator';
import { SESSION_COOKIE_NAME } from '../access-control/session-cookie';
import { ACTOR_CONTEXT_REPOSITORY } from '../access-control/tokens';

/**
 * Minimal structural shape of what this handler needs from the platform
 * response object (`res.cookie`/`res.clearCookie`, both real Express
 * methods since `@nestjs/platform-express` is the adapter this app already
 * uses) — deliberately NOT `import type { Response } from 'express'`:
 * `express` is only a transitive dependency here (via
 * `@nestjs/platform-express`), and pnpm's strict linking does not expose
 * transitive packages to this app's own imports. A structural type avoids
 * adding a direct dependency for types alone.
 */
interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string): void;
}

/**
 * The staff-side entrypoint this application never had. `StaffLoginUseCase`
 * and `SessionService` were both fully built and tested in Phase 3a (see
 * `packages/application/src/identity`), but — same gap `app.module.ts`'s own
 * doc comment records for `main.ts` itself — nothing ever turned them into
 * an HTTP route: without this controller an owner/secretary/barber had no
 * way to reach a `session_id` cookie at all, which means `AgendaModule`,
 * `AppointmentsModule` and `BarbersModule`'s endpoints were permanently
 * unreachable in practice even though `PermissionsGuard` was fully wired.
 * This is the arranque slice's addition — not one of the 40 tracked
 * requirements — flagged here and in apply-progress rather than silently
 * bundled into the "just wiring" story.
 *
 * Reuses `ActorContextRepository.resolveBySessionId` (already bound by
 * `AccessControlModule`) to resolve the freshly created session back into
 * the `{role, barberId}` the web app needs to route correctly — never a
 * second, parallel query for the same information.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly staffLogin: StaffLoginUseCase,
    private readonly sessions: SessionService,
    @Inject(ACTOR_CONTEXT_REPOSITORY) private readonly actorContexts: ActorContextRepository,
  ) {}

  @Public()
  @Post('staff-login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<StaffLoginResponseBody> {
    const parsed = StaffLoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const result = await this.staffLogin.execute(parsed.data);
    if (result.outcome !== 'authenticated') {
      return { outcome: 'rejected' };
    }

    // Every staff login gets the 12h TTL, owner included:
    // `SESSION_TTL_MINUTES_BY_SUBJECT` differentiates 'staff' (12h) from
    // 'owner' (8h), but choosing between them needs the actor's role, which
    // is only knowable AFTER a session exists to resolve through
    // `ActorContextRepository` — this endpoint accepts that one
    // simplification (documented in apply-progress) rather than adding a
    // second, parallel role-by-email lookup this slice has no spec for.
    const session = await this.sessions.create({ userId: result.userId, subject: 'staff' });

    const actor = await this.actorContexts.resolveBySessionId(session.id);
    if (!actor) {
      // The session this handler just created did not resolve — should be
      // unreachable given `DrizzleActorContextRepository`'s own guards, but
      // failing loudly here is safer than handing the browser a cookie for
      // an actor it can never identify.
      throw new BadRequestException('Session created but could not be resolved to an actor.');
    }

    res.cookie(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      // Secure cookies require HTTPS — the demo runs the API over plain
      // HTTP on localhost, so this only turns on for a real deployment.
      secure: process.env.NODE_ENV === 'production',
      expires: session.expiresAt,
    });

    return { outcome: 'authenticated', userId: actor.userId, role: actor.role, barberId: actor.barberId ?? null };
  }

  /**
   * Not part of any spec either — the demo's own need to switch between
   * owner/secretary/barber accounts without restarting the browser.
   * `@Public()` on purpose: logging out must work even if the session
   * already expired or was never valid.
   */
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: CookieResponse): { loggedOut: true } {
    res.clearCookie(SESSION_COOKIE_NAME);
    return { loggedOut: true };
  }
}
