import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService, type ActorContext } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleDayBoardRepository } from './day-board.repository';

const DAY = '2026-09-01';
const OTHER_DAY = '2026-09-02';

// Row-level narrowing by barber_id is a database guarantee here (task 8.7,
// reusing 3b.7's rule), so — like agenda.repository.spec.ts — it can only be
// proven against a real PostgreSQL engine, not a fake.
describe('DrizzleDayBoardRepository (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let repository: DrizzleDayBoardRepository;
  let barberAId: string;
  let barberBId: string;

  const clock = new ShopClock();
  const at = (calendarDate: string, wallClock: string): Date => clock.localTimeToUtc(calendarDate, wallClock);
  const range = (calendarDate: string, from: string, to: string) =>
    `[${at(calendarDate, from).toISOString()},${at(calendarDate, to).toISOString()})`;

  const OWNER: ActorContext = { userId: 'owner-1', role: 'owner' };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
      .withStartupTimeout(240_000)
      .start();

    client = postgres(container.getConnectionUri());
    db = drizzle(client);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    repository = new DrizzleDayBoardRepository(db, clock);

    const barberA = createBarber({ id: crypto.randomUUID(), name: 'Juan', active: true });
    const barberB = createBarber({ id: crypto.randomUUID(), name: 'Ana', active: true });
    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte clasico',
      durationMinutes: 30,
      priceCents: 500000,
    });
    await new DrizzleBarberRepository(db).create(barberA);
    await new DrizzleBarberRepository(db).create(barberB);
    await new DrizzleServiceRepository(db).create(service);
    barberAId = barberA.id;
    barberBId = barberB.id;

    // The board carries BOTH channels, so the fixture does too. Phase 5's
    // `web_channel_requires_deposit_once_settled` makes a web row past the
    // hold stage without a deposit unrepresentable ("pagar despues" on the
    // web channel cannot exist), and `only_web_channel_carries_deposit` is
    // its inverse: phone and walk-in rows never carry one. A fixture that
    // ignored either would be seeding a state the running system can never
    // produce.
    const [deposit] = await client<{ id: string }[]>`
      insert into deposits (amount_cents, payment_id, state)
      values (250000, 'pay-day-board-a', 'settled')
      returning id`;

    // A confirmed slot for each barber that day — barber A's came through the
    // web with its 50% deposit, barber B's by phone with none...
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range, deposit_id)
                 values (${barberAId}, ${service.id}, 'web', 'reservado', ${range(DAY, '09:00', '09:30')}::tstzrange, ${deposit!.id})`;
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberBId}, ${service.id}, 'telefonico', 'reservado', ${range(DAY, '10:00', '10:30')}::tstzrange)`;
    // ...a hold, mid-checkout, on barber A that day (must never appear — held/liberado are "anteriores al ciclo de vida del turno").
    // `held` is exempt from the deposit constraint: that is exactly the window
    // in which the client has not paid yet.
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range, hold_expires_at)
                 values (${barberAId}, ${service.id}, 'web', 'held', ${range(DAY, '11:00', '11:30')}::tstzrange, ${at(DAY, '11:15').toISOString()})`;
    // ...and a confirmed slot for barber A on a DIFFERENT day (must never appear in DAY's board).
    await client`insert into slot_occupancies (barber_id, service_id, channel, status, time_range)
                 values (${barberAId}, ${service.id}, 'telefonico', 'reservado', ${range(OTHER_DAY, '09:00', '09:30')}::tstzrange)`;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('returns every barber column and every reservado slot that day, excluding held rows, for an actor with no barberId', async () => {
    const result = await repository.findDayBoard(DAY, OWNER);

    expect(result.columns).toEqual(
      expect.arrayContaining([
        { barberId: barberAId, barberName: 'Juan' },
        { barberId: barberBId, barberName: 'Ana' },
      ]),
    );
    expect(result.slots).toHaveLength(2);
    expect(result.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ barberId: barberAId, status: 'reservado' }),
        expect.objectContaining({ barberId: barberBId, status: 'reservado' }),
      ]),
    );
  });

  it("narrows both columns and slots to the actor's own barberId — never a post-fetch filter (task 8.7)", async () => {
    const barberActor: ActorContext = { userId: 'barber-a-user', role: 'barber', barberId: barberAId };

    const result = await repository.findDayBoard(DAY, barberActor);

    expect(result.columns).toEqual([{ barberId: barberAId, barberName: 'Juan' }]);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]).toEqual(
      expect.objectContaining({ barberId: barberAId, status: 'reservado' }),
    );
  });

  it('excludes a confirmed slot that belongs to a different calendar date', async () => {
    const result = await repository.findDayBoard(OTHER_DAY, OWNER);

    expect(result.slots).toEqual([expect.objectContaining({ barberId: barberAId, status: 'reservado' })]);
  });
});
