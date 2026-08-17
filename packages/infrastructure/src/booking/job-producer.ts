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
let started: Promise<PgBoss> | undefined;

export function jobSender(): Promise<JobSender> {
  started ??= (async () => {
    const boss = new PgBoss(connectionString);
    await boss.start();
    return boss;
  })();
  return started;
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
