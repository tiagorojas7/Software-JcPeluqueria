import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createBarber, createService } from '@jc-barberia/domain';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleBarberRepository } from '../availability/barber.repository';
import { DrizzleServiceRepository } from '../availability/service.repository';

const CHECK_VIOLATION = '23514';

/**
 * Proves the two hand-written CHECK constraints from migration 0007 at the
 * database level — the same "only the database can guarantee this" reasoning
 * as the `EXCLUDE` constraint in migration 0003. A bug in a use case can
 * still forget to attach a deposit; the row itself cannot exist that way.
 */
describe('slot_occupancies channel/deposit CHECK invariants (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let serviceId: string;

  const range = '[2026-09-01T12:00:00Z,2026-09-01T12:30:00Z)';

  /** Own barber per case: keeps the CHECK assertions independent of the
   *  `EXCLUDE` constraint (migration 0003), which would otherwise fire first
   *  for two `reservado` rows sharing a barber and range. */
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
      .withStartupTimeout(240_000)
      .start();

    client = postgres(container.getConnectionUri());
    db = drizzle(client);
    await migrate(db, { migrationsFolder: './src/db/migrations' });

    const service = createService({
      id: crypto.randomUUID(),
      name: 'Corte clasico',
      durationMinutes: 30,
      priceCents: 500000,
    });
    await new DrizzleServiceRepository(db).create(service);
    serviceId = service.id;
  }, 300_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, 60_000);

  it('rejects a web-channel row past the hold stage with no deposit_id', async () => {
    const barber = await newBarber();

    const error = await client`
      insert into slot_occupancies (barber_id, service_id, channel, status, time_range, deposit_id)
      values (${barber}, ${serviceId}, 'web', 'reservado', ${range}::tstzrange, NULL)
    `.catch((e) => e);

    expect(error.code).toBe(CHECK_VIOLATION);
  });

  it('rejects a telefono-channel row carrying a deposit_id', async () => {
    const barber = await newBarber();
    const [deposit] = await client`
      insert into deposits (amount_cents, payment_id, state) values (250000, 'fake-payment-id', 'settled')
      returning id
    `;

    const error = await client`
      insert into slot_occupancies (barber_id, service_id, channel, status, time_range, deposit_id)
      values (${barber}, ${serviceId}, 'telefono', 'reservado', ${range}::tstzrange, ${deposit!.id})
    `.catch((e) => e);

    expect(error.code).toBe(CHECK_VIOLATION);
  });
});
