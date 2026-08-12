import {
  SESSION_TTL_MINUTES_BY_SUBJECT,
  type Clock,
  type Session,
  type SessionRepository,
  type SessionSubjectKind,
} from '@jc-barberia/domain';
import { randomUUID } from 'node:crypto';

export interface CreateSessionInput {
  readonly userId: string;
  readonly subject: SessionSubjectKind;
}

/**
 * Mints sessions with a TTL that depends on who is logging in — client
 * sessions slide for 30 days, staff for 12 hours (one work shift), the
 * owner for a shorter 8 hours since that is the only account that reaches
 * the shop's billing. The expiry is computed once, at creation time, via
 * the `Clock` port — never re-derived later, and never `new Date()`.
 */
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
  ) {}

  async create(input: CreateSessionInput): Promise<Session> {
    const ttlMinutes = SESSION_TTL_MINUTES_BY_SUBJECT[input.subject];
    const expiresAt = this.clock.addMinutes(this.clock.now(), ttlMinutes);
    const session: Session = { id: randomUUID(), userId: input.userId, expiresAt };
    await this.sessions.create(session);
    return session;
  }
}
