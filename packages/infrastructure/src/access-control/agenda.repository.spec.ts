import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ActorContext } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleAgendaRepository } from './agenda.repository';

// access-control spec, "El barbero queda acotado a sus propios datos" —
// design.md's "el repositorio estrecha la consulta (WHERE barber_id =
// :actorBarberId) ... no como filtro posterior". One container for the
// whole file, same reasoning as the sibling repository specs in this
// directory.
describe('agenda access narrowing (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  const newBarberWithSchedule = async (dayOfWeek: number): Promise<string> => {
    const barberId = randomUUID();
    await client`insert into barbers (id, name) values (${barberId}, 'Test Barber')`;
    await client`
      insert into barber_schedules (barber_id, day_of_week, opens_at, closes_at)
      values (${barberId}, ${dayOfWeek}, '09:00', '18:00')
    `;
    return barberId;
  };

  const owner: ActorContext = { userId: randomUUID(), role: 'owner' };
  const secretary: ActorContext = { userId: randomUUID(), role: 'secretary' };

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
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('lets an owner (agenda:read:any) read any barber’s own schedule, narrowed to that one barber', async () => {
    const barberAId = await newBarberWithSchedule(1);
    const barberBId = await newBarberWithSchedule(2);
    const repo = new DrizzleAgendaRepository(db);

    const resultA = await repo.findScheduleFor(barberAId, owner);
    const resultB = await repo.findScheduleFor(barberBId, owner);

    expect(resultA).toEqual({
      outcome: 'allowed',
      schedule: [{ barberId: barberAId, dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' }],
    });
    expect(resultB).toEqual({
      outcome: 'allowed',
      schedule: [{ barberId: barberBId, dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' }],
    });
  });

  it('lets a secretary (agenda:read:any) read a barber’s schedule too', async () => {
    const barberId = await newBarberWithSchedule(3);
    const repo = new DrizzleAgendaRepository(db);

    const result = await repo.findScheduleFor(barberId, secretary);

    expect(result).toEqual({
      outcome: 'allowed',
      schedule: [{ barberId, dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' }],
    });
  });

  it('lets a barber read their own schedule', async () => {
    const barberId = await newBarberWithSchedule(4);
    const barberActor: ActorContext = { userId: randomUUID(), role: 'barber', barberId };
    const repo = new DrizzleAgendaRepository(db);

    const result = await repo.findScheduleFor(barberId, barberActor);

    expect(result).toEqual({
      outcome: 'allowed',
      schedule: [{ barberId, dayOfWeek: 4, opensAt: '09:00', closesAt: '18:00' }],
    });
  });

  it('rejects a barber requesting a colleague’s schedule by id — access-control threat matrix (3b.6)', async () => {
    const ownBarberId = await newBarberWithSchedule(5);
    const colleagueBarberId = await newBarberWithSchedule(6);
    const barberActor: ActorContext = { userId: randomUUID(), role: 'barber', barberId: ownBarberId };
    const repo = new DrizzleAgendaRepository(db);

    const result = await repo.findScheduleFor(colleagueBarberId, barberActor);

    expect(result).toEqual({ outcome: 'forbidden' });
  });

  it('returns an empty (not forbidden) schedule for a barber with no configured rows yet', async () => {
    const barberId = randomUUID();
    await client`insert into barbers (id, name) values (${barberId}, 'Unscheduled Barber')`;
    const repo = new DrizzleAgendaRepository(db);

    const result = await repo.findScheduleFor(barberId, owner);

    expect(result).toEqual({ outcome: 'allowed', schedule: [] });
  });
});
