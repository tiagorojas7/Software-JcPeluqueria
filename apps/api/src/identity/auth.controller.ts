import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ClientLoginUseCase, RequestClientAccessUseCase, SessionService, StaffLoginUseCase } from '@jc-barberia/application';
import {
  ClientLoginRequestSchema,
  RequestClientAccessRequestSchema,
  StaffLoginRequestSchema,
  type ClientLoginResponseBody,
  type RequestClientAccessResponseBody,
  type StaffLoginResponseBody,
} from '@jc-barberia/contracts';
import type { ActorContextRepository, ClientContextRepository } from '@jc-barberia/domain';

import { Public } from '../access-control/decorators/public.decorator';
import { SESSION_COOKIE_NAME, writeSessionCookie, type CookieResponse } from '../access-control/session-cookie';
import { ACTOR_CONTEXT_REPOSITORY, CLIENT_CONTEXT_REPOSITORY } from '../access-control/tokens';

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
    // NEVER name these two the same as their own route handler methods
    // below (`requestClientAccess`/`clientLogin`) — a same-named instance
    // property SHADOWS the prototype method Nest's router captured during
    // route scanning, which makes PermissionsGuard read no metadata off the
    // handler at all and deny with "no access-control decorator" even
    // though @Public() is right there (see MarkBarberAbsentController's own
    // doc comment — this cost real debugging time once already).
    private readonly requestClientAccessUseCase: RequestClientAccessUseCase,
    private readonly clientLoginUseCase: ClientLoginUseCase,
    private readonly sessions: SessionService,
    @Inject(ACTOR_CONTEXT_REPOSITORY) private readonly actorContexts: ActorContextRepository,
    @Inject(CLIENT_CONTEXT_REPOSITORY) private readonly clientContexts: ClientContextRepository,
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

    writeSessionCookie(res, session.id, session.expiresAt);

    return { outcome: 'authenticated', userId: actor.userId, role: actor.role, barberId: actor.barberId ?? null };
  }

  /**
   * cablear-el-mvp Slice C (C.1): client-booking spec, "Cuenta sin
   * contraseña creada al final del flujo". `@Public()` — a client has no
   * session yet at this point, that is the entire reason this endpoint
   * exists. Always answers `{outcome:'requested'}`, whether or not the
   * phone is on file and whether or not that client ever registered for web
   * access (`RequestClientAccessUseCase`'s own doc comment): this endpoint
   * MUST NOT become an oracle for which phone numbers are registered.
   */
  @Public()
  @Post('request-client-access')
  @HttpCode(200)
  async requestClientAccess(@Body() body: unknown): Promise<RequestClientAccessResponseBody> {
    const parsed = RequestClientAccessRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    return this.requestClientAccessUseCase.execute({ phone: parsed.data.phone });
  }

  /**
   * cablear-el-mvp Slice C (C.2): client-booking spec, "Cuenta sin
   * contraseña creada al final del flujo" + "Código de acceso vencido".
   * `@Public()` for the same reason as `requestClientAccess` above. On
   * success, mints the session (`subject: 'client'`, the 30-day sliding TTL
   * task 3a.19 established) and resolves it straight back through
   * `ClientContextRepository` — the exact "create session, then resolve it
   * immediately" shape `login()` above already established for staff, reused
   * rather than invented twice. `clientId` here is `users.client_id`, never
   * anything the request supplied.
   */
  @Public()
  @Post('client-login')
  @HttpCode(200)
  async clientLogin(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<ClientLoginResponseBody> {
    const parsed = ClientLoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const result = await this.clientLoginUseCase.execute(parsed.data);
    if (result.outcome !== 'authenticated') {
      return result;
    }

    const session = await this.sessions.create({ userId: result.userId, subject: 'client' });

    const client = await this.clientContexts.resolveBySessionId(session.id);
    if (!client) {
      // Mirrors `login()`'s own guard above: the session this handler just
      // created did not resolve back to a client — should be unreachable,
      // but failing loudly beats handing the browser a cookie for an
      // identity it can never confirm.
      throw new BadRequestException('Session created but could not be resolved to a client.');
    }

    writeSessionCookie(res, session.id, session.expiresAt);

    return { outcome: 'authenticated', clientId: client.clientId };
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
