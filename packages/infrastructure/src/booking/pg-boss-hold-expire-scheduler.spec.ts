import { FakeClock } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { PgBossHoldExpireScheduler } from './pg-boss-hold-expire-scheduler';

// 6.3 GREEN (production half) — `CreateHold` has demanded a
// `HoldExpireScheduler` since Phase 6, but the only implementation that ever
// existed was `FakeHoldExpireScheduler` in domain testing. The fork hid the
// gap: lineage A changed the constructor, lineage B wired `CreateHold` into a
// real Nest endpoint, and nobody built the adapter. Without it the phone
// appointment endpoint cannot be constructed at all.
//
// pg-boss is never started in these tests. The adapter's whole job is a
// translation — port call onto `boss.send(name, data, options)` — so a
// recording fake proves the two things that actually matter: the queue name
// the worker subscribes to, and that `startAfter` is forwarded as the Date the
// domain's `Clock` already computed, never recomputed here.

interface RecordedSend {
  readonly name: string;
  readonly data: unknown;
  readonly options: { startAfter?: Date; db?: unknown } | undefined;
}

function fakeBoss() {
  const sent: RecordedSend[] = [];
  return {
    sent,
    send: async (name: string, data: unknown, options?: RecordedSend['options']) => {
      sent.push({ name, data, options });
      return 'job-id';
    },
    /** Asserts exactly one enqueue happened and hands it back non-optional, so
     *  each test reads the call instead of re-checking the array's shape. */
    onlySend(): RecordedSend {
      expect(sent).toHaveLength(1);
      const [call] = sent;
      if (!call) {
        throw new Error('expected exactly one enqueue');
      }
      return call;
    },
  };
}

describe('PgBossHoldExpireScheduler (6.3)', () => {
  // The expiry instant comes from the Clock port, exactly as a real hold's
  // `holdExpiresAt` does — the lint rule forbids building it any other way.
  const startAfter = new FakeClock().localTimeToUtc('2026-09-01', '10:15');

  it('encola en la cola hold.expire que el worker consume, con el holdId como payload', async () => {
    const boss = fakeBoss();
    const scheduler = new PgBossHoldExpireScheduler(boss);

    await scheduler.scheduleExpire({ holdId: 'hold-1', startAfter });

    const call = boss.onlySend();
    expect(call.name).toBe('hold.expire');
    expect(call.data).toEqual({ holdId: 'hold-1' });
  });

  it('reenvia startAfter tal cual lo calculo el Clock del dominio, sin recalcular la hora', async () => {
    const boss = fakeBoss();
    const scheduler = new PgBossHoldExpireScheduler(boss);

    await scheduler.scheduleExpire({ holdId: 'hold-1', startAfter });

    // The expiry instant is the hold's own `holdExpiresAt`, produced by the
    // `Clock` port. An adapter that read a wall clock here would drift from
    // the row it is expiring.
    expect(boss.onlySend().options?.startAfter).toBe(startAfter);
  });

  it('pasa la conexion transaccional cuando se le da, para encolar en la misma transaccion que crea el hold', async () => {
    const boss = fakeBoss();
    const tx = { executeSql: async () => ({ rows: [] }) };
    const scheduler = new PgBossHoldExpireScheduler(boss, () => tx);

    await scheduler.scheduleExpire({ holdId: 'hold-1', startAfter });

    // design.md "Encolado transaccional": a rollback must discard the job too,
    // so no refund + notification fires for a hold that never committed.
    expect(boss.onlySend().options?.db).toBe(tx);
  });

  it('omite db cuando no hay transaccion en curso, en vez de mandar undefined explicito', async () => {
    const boss = fakeBoss();
    const scheduler = new PgBossHoldExpireScheduler(boss);

    await scheduler.scheduleExpire({ holdId: 'hold-1', startAfter });

    expect(boss.onlySend().options).not.toHaveProperty('db');
  });
});
