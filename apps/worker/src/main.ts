import { PgBoss } from 'pg-boss';

/**
 * The single background process for the turnero (design.md "Procesos de
 * fondo"). pg-boss shares the app's own PostgreSQL — no extra Redis — so a
 * `hold.expire` job can be enqueued in the same transaction that creates the
 * hold (no orphan jobs on rollback). Phase 6 registers the handlers here:
 * `hold.expire` (6.5), the 23:59 business-day sweep (6.7), the appointment
 * reminder (6.11) and the `notification_outbox` consumer (6.13).
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test';

async function main(): Promise<void> {
  const boss = new PgBoss(connectionString);
  await boss.start();

  // Handlers are registered as the phases that own them land. An empty but
  // started pg-boss still runs its own maintenance cron — enough to keep the
  // schema present and prove the wiring boots.
  console.log('[worker] pg-boss started');
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});