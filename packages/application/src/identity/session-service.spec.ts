import { FakeClock, FakeSessionRepository } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { SessionService } from './session-service';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

describe('SessionService.create', () => {
  it('gives a client session a 30-day TTL', async () => {
    const clock = new FakeClock(-180, at('12:00'));
    const sessions = new FakeSessionRepository();
    const service = new SessionService(sessions, clock);

    const session = await service.create({ userId: 'client-1', subject: 'client' });

    expect(session.expiresAt).toEqual(dateBuilder.localTimeToUtc('2026-10-01', '12:00'));
    expect(sessions.createCalls).toEqual([session]);
  });

  it('gives a staff (secretary/barber) session a 12-hour TTL', async () => {
    const clock = new FakeClock(-180, at('09:00'));
    const sessions = new FakeSessionRepository();
    const service = new SessionService(sessions, clock);

    const session = await service.create({ userId: 'barber-1', subject: 'staff' });

    expect(session.expiresAt).toEqual(at('21:00'));
  });

  it('gives the owner’s session a shorter 8-hour TTL, not the 12-hour staff default', async () => {
    const clock = new FakeClock(-180, at('09:00'));
    const sessions = new FakeSessionRepository();
    const service = new SessionService(sessions, clock);

    const session = await service.create({ userId: 'owner-1', subject: 'owner' });

    expect(session.expiresAt).toEqual(at('17:00'));
  });

  it('persists the created session for the requested user', async () => {
    const clock = new FakeClock(-180, at('09:00'));
    const sessions = new FakeSessionRepository();
    const service = new SessionService(sessions, clock);

    const session = await service.create({ userId: 'owner-1', subject: 'owner' });

    expect(session.userId).toBe('owner-1');
    expect(sessions.createCalls).toHaveLength(1);
  });

  it('generates a fresh session id on every call', async () => {
    const clock = new FakeClock(-180, at('09:00'));
    const sessions = new FakeSessionRepository();
    const service = new SessionService(sessions, clock);

    const first = await service.create({ userId: 'owner-1', subject: 'owner' });
    const second = await service.create({ userId: 'owner-1', subject: 'owner' });

    expect(first.id).not.toBe(second.id);
  });
});
