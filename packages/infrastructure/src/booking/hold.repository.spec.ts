import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService, SlotUnavailableError, type Hold } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleHoldRepository } from './hold.repository';

// Slot exclusivity is a database guarantee, not an application one, so it can
// only be proven against a real PostgreSQL engine. The pool is sized above the
// 20 competitors of the concurrency test on purpose: with a smaller pool the
// losers would queue instead of racing, and the test would prove nothing.
const POOL_SIZE = 25;
const DAY = '2026-09-01';

describe('slot occupancy exclusivity (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let barberId: string;
  let serviceId: string;

  const clock = new ShopClock();
  const at = (wallClock: string): Date => clock.localTimeToUtc(DAY, wallClock);
  const range = (from: string, to: string) =>
    `[${at(from).toISOString()},${at(to).toISOString()})`;
  const rawHold = (from: string, to: string) =>
    client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
           values (${barberId}, ${serviceId}, 'web', 'held', ${range(from, to)}::tstzrange)`;

  // The barber's working window for the day, as Phase 1's
  // AvailabilityService.workingWindows() would return it. Alternatives are
  // only ever searched inside it.
  const workingWindow = { start: at('09:00'), end: at('18:00') };
  // Deliberately not "DAY minus a few minutes": DAY itself is a fixed future
  // date (kept future so the exclusivity tests above never race against a
  // real clock). A genuinely-expired hold needs an instant in the past
  // relative to whenever this suite actually runs, so this uses its own,
  // unrelated calendar date instead.
  const PAST_HOLD_EXPIRY = clock.localTimeToUtc('2020-01-01', '12:00');
  const holdFor = (barber: string, from: string, to: string, channel: Hold['channel'] = 'web'): Hold => ({
    id: crypto.randomUUID(),
    barberId: barber,
    serviceId,
    clientId: null,
    channel,
    timeRange: { start: at(from), end: at(to) },
    holdExpiresAt: at('23:00'),
    originOccupancyId: null,
  });
  // Each competing scenario gets its own barber: the constraint is scoped per
  // barber, so this keeps the tests from occupying each other's ranges.
  const newBarber = async (): Promise<string> => {
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Barbero', active: true });
    await new DrizzleBarberRepository(db).create(barber);
    return barber.id;
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
      // Same contention allowance as the availability suite: pg_isready's own
      // wait strategy has a 120s default that is not enough on this machine.
      .withStartupTimeout(240_000)
      .start();

    client = postgres(container.getConnectionUri(), { max: POOL_SIZE });
    db = drizzle(client);
    await migrate(db, { migrationsFolder: './src/db/migrations' });

    const barber = createBarber({ id: crypto.randomUUID(), name: 'Juan', active: true });
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte clasico',
      durationMinutes: 30,
      priceCents: 500000,
    });
    await new DrizzleBarberRepository(db).create(barber);
    await new DrizzleServiceRepository(db).create(service);
    barberId = barber.id;
    serviceId = service.id;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('rejects the loser of two concurrent inserts on the same barber and range with 23P01', async () => {
    const results = await Promise.allSettled([rawHold('10:00', '10:30'), rawHold('10:00', '10:30')]);

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('23P01');
  });

  it('stores a hold over a free range', async () => {
    const hold = holdFor(await newBarber(), '11:00', '11:30');

    await new DrizzleHoldRepository(db).create(hold, workingWindow);

    const rows = await client`select status, time_range = ${range('11:00', '11:30')}::tstzrange as exact
                                from slot_occupancies where id = ${hold.id}`;
    expect([...rows]).toEqual([{ status: 'held', exact: true }]);
  });

  it('translates 23P01 into a domain rejection carrying the free ranges left in the day', async () => {
    const repo = new DrizzleHoldRepository(db);
    const barber = await newBarber();
    await repo.create(holdFor(barber, '10:00', '10:30'), workingWindow);

    const error = await repo.create(holdFor(barber, '10:00', '10:30'), workingWindow).catch((e) => e);

    expect(error).toBeInstanceOf(SlotUnavailableError);
    expect(error.alternatives).toEqual([
      { start: at('09:00'), end: at('10:00') },
      { start: at('10:30'), end: at('18:00') },
    ]);
  });

  it('offers no gap between two occupancies that touch', async () => {
    const repo = new DrizzleHoldRepository(db);
    const barber = await newBarber();
    await repo.create(holdFor(barber, '09:00', '12:00'), workingWindow);
    await repo.create(holdFor(barber, '12:00', '17:00'), workingWindow);

    const error = await repo.create(holdFor(barber, '10:00', '10:30'), workingWindow).catch((e) => e);

    expect(error.alternatives).toEqual([{ start: at('17:00'), end: at('18:00') }]);
  });

  // The only real proof of the hold. Twenty clients racing for one slot must
  // leave exactly one winner and nineteen offers of something else — no
  // second row, no deadlock, no silent success.
  it('lets exactly one of 20 concurrent transactions win the same slot', async () => {
    const repo = new DrizzleHoldRepository(db);
    const barber = await newBarber();

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.create(holdFor(barber, '15:00', '15:30'), workingWindow).then(
          () => 'won',
          (error) => (error instanceof SlotUnavailableError ? 'lost' : `unexpected: ${error}`),
        ),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === 'won')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'lost')).toHaveLength(19);
    const stored = await client`select count(*)::int as total from slot_occupancies
                                  where barber_id = ${barber} and status = 'held'`;
    expect([...stored]).toEqual([{ total: 1 }]);
  });

  // The EXCLUDE predicate cannot reference now(), so a hold nobody confirmed
  // or released stays 'held' forever unless something evaluates the
  // expiry lazily. This proves that evaluation happens right before a new
  // hold is written, not just eventually via the background job (Phase 6).
  it('lazily releases an expired hold before creating a new one on the same range', async () => {
    const repo = new DrizzleHoldRepository(db);
    const barber = await newBarber();
    const expiredId = crypto.randomUUID();
    await client`insert into slot_occupancies (id, barber_id, service_id, channel, status, time_range, hold_expires_at)
                 values (${expiredId}, ${barber}, ${serviceId}, 'web', 'held', ${range('10:00', '10:30')}::tstzrange, ${PAST_HOLD_EXPIRY.toISOString()})`;

    // Must NOT throw SlotUnavailableError: the stale row is released first.
    await repo.create(holdFor(barber, '10:00', '10:30'), workingWindow);

    const rows = await client`select status from slot_occupancies where id = ${expiredId}`;
    expect([...rows]).toEqual([{ status: 'liberado' }]);
  });

  // Task 5.17 — design.md line 150: "Un hold con un pago en curso nunca lo
  // libera el temporizador. Solo se libera cuando el pago alcanza un estado
  // terminal." The lazy release inside `create()` MUST skip a
  // `payment_pending=true` row even when its expiry already passed — that is
  // the exact race the rule exists to prevent (cliente paga a las 14:50,
  // el hold vence wall-clock-wise y queda un pago aprobado sin horario). Such
  // a hold stays `held` and keeps occupying the range until ProcessPaymentUseCase
  // itself confirms it (approved) or releases it (rejected/cancelled).
  it('does NOT lazily release an expired hold that has payment_pending=true — the slot stays occupied', async () => {
    const repo = new DrizzleHoldRepository(db);
    const barber = await newBarber();
    const pendingHoldId = crypto.randomUUID();
    await client`insert into slot_occupancies (id, barber_id, service_id, channel, status, time_range, hold_expires_at, payment_pending)
                 values (${pendingHoldId}, ${barber}, ${serviceId}, 'web', 'held', ${range('10:00', '10:30')}::tstzrange, ${PAST_HOLD_EXPIRY.toISOString()}, true)`;

    // The lazy release fires inside create() before the INSERT. If it
    // respected payment_pending it would skip this row, so the INSERT would
    // hit the EXCLUDE and surface as the domain rejection — NOT a silent
    // takeover of an in-flight payment's slot.
    const error = await repo.create(holdFor(barber, '10:00', '10:30'), workingWindow).catch((e) => e);

    expect(error).toBeInstanceOf(SlotUnavailableError);
    const rows = await client`select status, payment_pending from slot_occupancies where id = ${pendingHoldId}`;
    expect([...rows]).toEqual([{ status: 'held', payment_pending: true }]);
  });

  // Triangulates the test above: an ACTIVE hold (future hold_expires_at)
  // must still block, exactly like the pre-existing exclusivity tests. If
  // the lazy release were too broad (e.g. missing the hold_expires_at
  // predicate) this would start passing when it should not.
  it('still blocks on an active hold that has not expired yet', async () => {
    const repo = new DrizzleHoldRepository(db);
    const barber = await newBarber();
    await repo.create(holdFor(barber, '16:00', '16:30'), workingWindow);

    const error = await repo.create(holdFor(barber, '16:00', '16:30'), workingWindow).catch((e) => e);

    expect(error).toBeInstanceOf(SlotUnavailableError);
  });

  // Confirmation is a state transition on the SAME row, never a second
  // INSERT — there is no window between "release the hold" and "create the
  // appointment" for a competitor to slip into.
  it('atomically confirms an active hold, transitioning held -> reservado', async () => {
    const repo = new DrizzleHoldRepository(db);
    // 'telefono', not the 'web' default: migration 0007's CHECK constraint
    // requires a deposit_id for any web-channel row past 'held'/'liberado'
    // (design.md — "no existe ningún endpoint que transicione held ->
    // reservado en el canal web fuera del handler de pago aprobado"). This
    // test proves confirm()'s atomic UPDATE...RETURNING shape generically,
    // which telefono exercises just as well without needing a deposit.
    const hold = holdFor(await newBarber(), '13:00', '13:30', 'telefonico');
    await repo.create(hold, workingWindow);

    const confirmed = await repo.confirm(hold.id);

    expect(confirmed).toBe(true);
    const rows = await client`select status from slot_occupancies where id = ${hold.id}`;
    expect([...rows]).toEqual([{ status: 'reservado' }]);
  });

  // Triangulates the test above: the WHERE clause has two conditions
  // (status='held' AND hold_expires_at > now()); this exercises the second
  // one specifically, proving confirm() does not blindly flip any row with
  // a matching id.
  it('returns false without transitioning a hold that already expired', async () => {
    const barber = await newBarber();
    const expiredId = crypto.randomUUID();
    await client`insert into slot_occupancies (id, barber_id, service_id, channel, status, time_range, hold_expires_at)
                 values (${expiredId}, ${barber}, ${serviceId}, 'web', 'held', ${range('14:00', '14:30')}::tstzrange, ${PAST_HOLD_EXPIRY.toISOString()})`;

    const confirmed = await new DrizzleHoldRepository(db).confirm(expiredId);

    expect(confirmed).toBe(false);
    const rows = await client`select status from slot_occupancies where id = ${expiredId}`;
    expect([...rows]).toEqual([{ status: 'held' }]);
  });

  // Phase 5 checkout: same re-validation shape as confirm(), but the row
  // stays 'held' and only payment_pending/hold_expires_at move.
  it('re-validates and marks payment_pending, extending hold_expires_at', async () => {
    const repo = new DrizzleHoldRepository(db);
    const hold = holdFor(await newBarber(), '17:00', '17:30');
    await repo.create(hold, workingWindow);
    const paymentExpiresAt = at('17:20');

    const began = await repo.beginCheckout(hold.id, paymentExpiresAt);

    expect(began).toBe(true);
    // Compares in SQL, not `new Date(...)` in JS — same style as the
    // `time_range = ...::tstzrange as exact` checks above; the lint rule
    // forbids constructing `Date` outside `ShopClock`.
    const [row] = await client`select status, payment_pending,
        hold_expires_at = ${paymentExpiresAt.toISOString()}::timestamptz as expiry_matches
      from slot_occupancies where id = ${hold.id}`;
    expect(row!.status).toBe('held');
    expect(row!.payment_pending).toBe(true);
    expect(row!.expiry_matches).toBe(true);
  });

  it('returns false for beginCheckout on an already-expired hold, without touching it', async () => {
    const barber = await newBarber();
    const expiredId = crypto.randomUUID();
    await client`insert into slot_occupancies (id, barber_id, service_id, channel, status, time_range, hold_expires_at)
                 values (${expiredId}, ${barber}, ${serviceId}, 'web', 'held', ${range('18:00', '18:30')}::tstzrange, ${PAST_HOLD_EXPIRY.toISOString()})`;

    const began = await new DrizzleHoldRepository(db).beginCheckout(expiredId, at('18:20'));

    expect(began).toBe(false);
    const rows = await client`select payment_pending from slot_occupancies where id = ${expiredId}`;
    expect([...rows]).toEqual([{ payment_pending: false }]);
  });
});
