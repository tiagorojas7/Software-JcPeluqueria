import { PgBoss } from 'pg-boss';

import type { JobSender } from './pg-boss-hold-expire-scheduler';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test';

/**
 * A started pg-boss used only to ENQUEUE jobs. `apps/worker` owns the consumer
 * side; the API never subscribes to a queue, it only produces.
 *
 * Kept here rather than in `apps/api` for the same reason `db` lives in
 * `connection.ts`: the composition root talks to `@jc-barberia/infrastructure`,
 * never to a driver package directly, so swapping the queue backend stays a
 * one-package change.
 *
 * Starting pg-boss is asynchronous and must happen once per process, so the
 * promise itself is the singleton — concurrent callers await the same start.
 */
/** Every queue this process ENQUEUES to. The worker owns the consuming side
 *  and declares them too; whichever starts first wins and the other is a
 *  no-op. */
const PRODUCED_QUEUES = ['hold.expire', 'payment.process'] as const;

let started: Promise<PgBoss> | undefined;

export function jobSender(): Promise<JobSender> {
  started ??= (async () => {
    const boss = new PgBoss(connectionString);
    // pg-boss is an EventEmitter, and an 'error' event with no listener is a
    // hard process crash in Node — not a rejected promise. Its background
    // poller emits one on any transient database hiccup, so without this the
    // whole API dies whenever the queue's connection blips, taking down
    // endpoints that never enqueue anything. Observed for real: a poll
    // timeout killed the process mid-login.
    boss.on('error', (error) => {
      console.error('[pg-boss] producer error (kept alive):', error);
    });
    await boss.start();
    // pg-boss v12 requires a queue to exist before anything can be sent to it,
    // and only the WORKER declared these. That made every booking depend on
    // the worker having run against this same database first: without it,
    // `POST /holds` died with "Queue hold.expire does not exist" and the
    // customer got a 500 with no way to book at all. The API produces to these
    // two, so the API makes sure they exist. `createQueue` is
    // `ON CONFLICT DO NOTHING` internally, so both processes declaring them is
    // safe and order between them stops mattering.
    await Promise.all(PRODUCED_QUEUES.map((queue) => boss.createQueue(queue)));
    return boss;
  })();
  return started;
}

/**
 * A `JobSender` that connects on its FIRST SEND, never at construction.
 *
 * Nest builds its whole module graph eagerly — at boot, and again in every
 * test that creates the app. A provider factory that awaited `jobSender()`
 * therefore opened a PostgreSQL connection just to exist, which meant the API
 * could not start unless the queue's database was already reachable: a queue
 * outage became a total API outage, for endpoints that may never enqueue
 * anything. Deferring the connection keeps module construction pure.
 *
 * `connect` is a parameter so the laziness itself is testable without a
 * database; production callers use the default.
 */
export function lazyJobSender(connect: () => Promise<JobSender> = jobSender): JobSender {
  return {
    send: async (name, data, options) => (await connect()).send(name, data, options),
  };
}

/** Closes the producer. The composition root calls this on shutdown so the
 *  process does not hang on pg-boss's open pool. */
export async function stopJobSender(): Promise<void> {
  if (!started) {
    return;
  }
  const boss = await started;
  started = undefined;
  await boss.stop();
}
