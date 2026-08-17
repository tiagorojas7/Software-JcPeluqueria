import { describe, expect, it, vi } from 'vitest';

import { lazyJobSender } from './job-producer';
import type { JobSender } from './pg-boss-hold-expire-scheduler';

// Regression guard for a real defect: the first wiring of `HOLD_EXPIRE_SCHEDULER`
// awaited `jobSender()` inside the Nest provider factory, so pg-boss opened a
// PostgreSQL connection while the module graph was being CONSTRUCTED. Two
// consequences, both bad:
//
//   1. `apps/api` could not boot at all unless the queue's database was already
//      reachable — a queue outage became a total API outage, for an endpoint
//      that may never enqueue anything.
//   2. Every Nest test that builds the app died with ECONNREFUSED before a
//      single assertion ran (4 suites, 36 tests skipped).
//
// Connecting belongs to the first send, not to construction.

describe('lazyJobSender', () => {
  it('no conecta al construirse — armar el grafo de modulos no debe tocar la red', () => {
    const connect = vi.fn<() => Promise<JobSender>>();

    lazyJobSender(connect);

    expect(connect).not.toHaveBeenCalled();
  });

  it('conecta recien en el primer send y delega el envio', async () => {
    const inner: JobSender = { send: vi.fn(async () => 'job-1') };
    const connect = vi.fn(async () => inner);
    const sender = lazyJobSender(connect);

    const jobId = await sender.send('hold.expire', { holdId: 'h-1' }, { startAfter: new Date(0) });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(inner.send).toHaveBeenCalledWith(
      'hold.expire',
      { holdId: 'h-1' },
      { startAfter: new Date(0) },
    );
    expect(jobId).toBe('job-1');
  });

  it('manda todos los jobs al mismo productor, nunca uno nuevo por job', async () => {
    const inner: JobSender = { send: vi.fn(async () => 'job-1') };
    // The wrapper asks `connect` on each send and `jobSender()` memoises its
    // own start promise, so asking again is free. What must never happen is a
    // SECOND producer: that would mean a second pool and a second pg-boss
    // installation check per enqueue.
    const connect = vi.fn(async () => inner);
    const sender = lazyJobSender(connect);

    await sender.send('hold.expire', { holdId: 'h-1' });
    await sender.send('hold.expire', { holdId: 'h-2' });

    // Each call returns its own Promise object, so the promises must be
    // resolved before comparing — it is the producer behind them that has to
    // be the same instance, not the wrapper's return value.
    const producers = await Promise.all(connect.mock.results.map((r) => r.value));
    expect(new Set(producers).size).toBe(1);
    expect(inner.send).toHaveBeenCalledTimes(2);
  });
});
