import '../config/load-env';
import { eq } from 'drizzle-orm';

import { Argon2PasswordHasher } from '../identity/argon2-password-hasher';
import { db, sqlClient } from './connection';
import { roles } from './schema/access-control';
import { barbers, barberSchedules, services, shopHours } from './schema/availability';
import { users } from './schema/identity';
import { BARBER_SCHEDULES, DEMO_BARBERS, DEMO_SERVICES, SHOP_HOURS, STAFF_ACCOUNTS } from './seed-data';

/**
 * Demo-ready seed for JC Barbería (arranque slice — not one of the 40
 * tracked requirements, no spec file this traces back to). The actual data
 * — barbers, services, shop hours, barber schedules, staff accounts — lives
 * in `seed-data.ts`, a pure module `seed-data.spec.ts` tests without a
 * database; this file is pure I/O orchestration against that data, every
 * insert an `onConflictDoUpdate` so running it twice against the same
 * database is a safe no-op/update, never a duplicate-key crash.
 *
 * Roles (`owner`/`secretary`/`barber`) are NOT created here — migration
 * 0006_access_control.sql already seeded those three rows plus their
 * `role_permissions`. This script only looks them up and attaches users.
 *
 * Passwords go through `Argon2PasswordHasher` exactly like `PasswordService`
 * would (never a literal hash) — this is the one place in this file with
 * real logic beyond data-shaping/I/O.
 */

async function seedBarbers(): Promise<void> {
  for (const barber of DEMO_BARBERS) {
    await db
      .insert(barbers)
      .values(barber)
      .onConflictDoUpdate({ target: barbers.id, set: { name: barber.name, active: barber.active } });
  }
}

async function seedServices(): Promise<void> {
  for (const service of DEMO_SERVICES) {
    await db
      .insert(services)
      .values(service)
      .onConflictDoUpdate({
        target: services.id,
        set: { name: service.name, durationMinutes: service.durationMinutes, priceCents: service.priceCents },
      });
  }
}

async function seedShopHours(): Promise<void> {
  for (const row of SHOP_HOURS) {
    await db
      .insert(shopHours)
      .values(row)
      .onConflictDoUpdate({
        target: shopHours.dayOfWeek,
        set: { opensAt: row.opensAt, closesAt: row.closesAt },
      });
  }
}

async function seedBarberSchedules(): Promise<void> {
  for (const row of BARBER_SCHEDULES) {
    await db
      .insert(barberSchedules)
      .values(row)
      .onConflictDoUpdate({
        target: [barberSchedules.barberId, barberSchedules.dayOfWeek],
        set: { opensAt: row.opensAt, closesAt: row.closesAt },
      });
  }
}

async function seedStaffUsers(): Promise<void> {
  const hasher = new Argon2PasswordHasher();

  for (const account of STAFF_ACCOUNTS) {
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, account.role));
    if (!role) {
      throw new Error(
        `Role "${account.role}" not found — run "pnpm --filter @jc-barberia/infrastructure db:migrate" first ` +
          '(migration 0006_access_control.sql seeds the three roles this script attaches users to).',
      );
    }

    const passwordHash = await hasher.hash(account.password);

    await db
      .insert(users)
      .values({
        email: account.email,
        roleId: role.id,
        barberId: account.barberId,
        active: true,
        passwordHash,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { roleId: role.id, barberId: account.barberId, active: true, passwordHash },
      });
  }
}

/** Formats cents as `$X.XXX,XX` (Argentine grouping) without
 *  `Number.prototype.toLocaleString` — the repo-wide `no-restricted-syntax`
 *  ESLint rule matches any `.toLocaleString()` call by property name alone,
 *  regardless of receiver type, so even this Number (never a Date) call
 *  would trip it. Console-output formatting only; no business logic reads
 *  this string back. */
function formatPriceArs(cents: number): string {
  const pesos = Math.floor(cents / 100);
  const centavos = String(cents % 100).padStart(2, '0');
  const wholeWithThousands = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${wholeWithThousands},${centavos}`;
}

async function main(): Promise<void> {
  await seedBarbers();
  await seedServices();
  await seedShopHours();
  await seedBarberSchedules();
  await seedStaffUsers();

  console.log('[seed] done.');
  console.log('[seed] barbers:');
  for (const barber of DEMO_BARBERS) {
    console.log(`  ${barber.name.padEnd(16)} ${barber.id}`);
  }
  console.log('[seed] services:');
  for (const service of DEMO_SERVICES) {
    console.log(
      `  ${service.name.padEnd(16)} ${service.id}  ${formatPriceArs(service.priceCents)}  ${service.durationMinutes}min`,
    );
  }
  console.log('[seed] staff logins (see docs/DEMO.md):');
  for (const account of STAFF_ACCOUNTS) {
    console.log(`  ${account.role.padEnd(10)} ${account.email.padEnd(28)} ${account.password}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // `db`'s underlying `postgres()` client keeps its pool open — without an
    // explicit end, this one-shot script would hang after printing its
    // summary. The API/worker never call this: `main.ts`'s shutdown hooks
    // and pg-boss own the app's live connection lifecycle instead.
    await sqlClient.end({ timeout: 5 });
  });
