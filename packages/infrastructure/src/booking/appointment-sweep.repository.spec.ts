import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';
import { ShopClock } from '../shared/clock/shop-clock';
import { DrizzleAppointmentSweepRepository } from './appointment-sweep.repository';

// The sweep's real contract is a database guarantee, not an application one:
// only a real PostgreSQL engine can prove the range filter and that con y
// sin seña transition alike. The pool is comfortable; the suite is sequential
// and each scenario owns its barber so ranges never collide.
const POOL_SIZE = 25;
const DAY = '2026-08-15'; // the swept business day
const PREV = '2026-08-14'; // the day before — must NOT be swept
const NEXT = '2026-08-22'; // a week later — must NOT be swept

describe('daily sweep (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let serviceId: string;
  let depositId: string;

  const clock = new ShopClock();
  const at = (date: string, wall: string): Date => clock.localTimeToUtc(date, wall);
  const range = (date: string, from: string, to: string) =>
    `[${at(date, from).toISOString()},${at(date, to).toISOString()})`;
  // The exact window the cron would compute for DAY via businessDayBounds.
  const bounds = clock.businessDayBounds(DAY);

  const newBarber = async (): Promise<string> => {
    const barber = createBarber({ id: crypto.randomUUID(), name: 'Barbero', active: true });
    await new DrizzleBarberRepository(db).create(barber);
    return barber.id;
  };
  // A reservado for the given day; `web` rows carry the seeded deposit (seña),
  // `telefonico` rows carry none — exactly the two appointments the sweep must
  // treat alike.
  const reservado = async (
    barber: string,
    date: string,
    from: string,
    to: string,
    channel: 'web' | 'telefonico',
  ): Promise<string> => {
    const id = crypto.randomUUID();
    await client`insert into slot_occupancies (id, barber_id, service_id, channel, status, time_range, deposit_id)
                 values (${id}, ${barber}, ${serviceId}, ${channel}, 'reservado',
                         ${range(date, from, to)}::tstzrange,
                         ${channel === 'web' ? depositId : null})`;
    return id;
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('jc_barberia_test')
      .withUsername('jc_barberia')
      .withPassword('jc_barberia')
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
    serviceId = service.id;

    // A settled seña for the con-seña web rows — the only reason `deposit_id`
    // can be non-null (migration 0007 enforces it per web channel + the FK).
    const [deposit] = await client`insert into deposits (amount_cents, payment_id, state)
                                    values (250000, ${crypto.randomUUID()}, 'settled')
                                    returning id`;
    depositId = (deposit as { id: string }).id;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  // 6.8 core — the sweep transitions the day's unmarked reservados con y sin
  // seña alike. The web row keeps its deposit_id ("MUST permanecer retenida sin
  // cambios"); the phone row stays without one. Both move to sin_registrado.
  it('transitions in-bounds reservado con y sin seña to sin_registrado and returns the count (2)', async () => {
    const barber = await newBarber();
    const webId = await reservado(barber, DAY, '10:00', '10:30', 'web');
    const phoneId = await reservado(barber, DAY, '11:00', '11:30', 'telefonico');

    const repo = new DrizzleAppointmentSweepRepository(db);
    const count = await repo.transitionUnmarked(bounds);

    expect(count).toBe(2);
    const [web, phone] = await client`select status, deposit_id from slot_occupancies
                                        where id in (${webId}, ${phoneId}) order by created_at`;
    expect(web!.status).toBe('sin_registrado');
    expect(web!.deposit_id).toBe(depositId); // seña retained, untouched
    expect(phone!.status).toBe('sin_registrado');
    expect(phone!.deposit_id).toBe(null);
  });

  // 6.8 — "Turnos futuros no son afectados por el barrido": a reservado a week
  // out stays reservado, and the run reports nothing swept for DAY.
  it('leaves a future-day reservado untouched (upper bound of the range filter)', async () => {
    const barber = await newBarber();
    const futureId = await reservado(barber, NEXT, '15:00', '15:30', 'telefonico');

    const repo = new DrizzleAppointmentSweepRepository(db);
    const count = await repo.transitionUnmarked(bounds);

    expect(count).toBe(0);
    const [row] = await client`select status from slot_occupancies where id = ${futureId}`;
    expect(row!.status).toBe('reservado');
  });

  // 6.9 — "confirmar el filtro de rango en la query": a reservado from the
  // PREVIOUS day (start < bounds.start) is also out of range and must stay
  // reservado — the predicate is a two-sided window, not just "< end".
  it('leaves a previous-day reservado untouched (lower bound of the range filter)', async () => {
    const barber = await newBarber();
    const prevId = await reservado(barber, PREV, '16:00', '16:30', 'telefonico');

    const repo = new DrizzleAppointmentSweepRepository(db);
    const count = await repo.transitionUnmarked(bounds);

    expect(count).toBe(0);
    const [row] = await client`select status from slot_occupancies where id = ${prevId}`;
    expect(row!.status).toBe('reservado');
  });

  // Triangulates the `status = 'reservado'` predicate — the sweep must NOT flip
  // every in-bounds row: a `realizado` (already resolved) stays as it is.
  it('leaves an in-bounds realizado untouched (only reservado is swept)', async () => {
    const barber = await newBarber();
    const doneId = crypto.randomUUID();
    await client`insert into slot_occupancies (id, barber_id, service_id, channel, status, time_range)
                 values (${doneId}, ${barber}, ${serviceId}, 'telefonico', 'realizado',
                         ${range(DAY, '12:00', '12:30')}::tstzrange)`;

    const repo = new DrizzleAppointmentSweepRepository(db);
    const count = await repo.transitionUnmarked(bounds);

    expect(count).toBe(0);
    const [row] = await client`select status from slot_occupancies where id = ${doneId}`;
    expect(row!.status).toBe('realizado');
  });
});
