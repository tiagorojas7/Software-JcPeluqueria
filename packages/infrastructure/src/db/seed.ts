import { eq } from 'drizzle-orm';

import { Argon2PasswordHasher } from '../identity/argon2-password-hasher';
import { db, sqlClient } from './connection';
import { roles } from './schema/access-control';
import { barbers, barberSchedules, services, shopHours } from './schema/availability';
import { users } from './schema/identity';

/**
 * Demo-ready seed data for JC Barbería (arranque slice — not one of the 40
 * tracked requirements, no spec file this traces back to). Fixed, readable
 * UUIDs on purpose: a demo operator needs to paste a real `barberId`/
 * `serviceId` into `PhoneAppointmentForm`'s bare text inputs (that
 * component's own doc comment: purely presentational, no dropdown), so the
 * ids need to be stable across re-runs, not whatever `defaultRandom()`
 * happens to generate. Every insert is `onConflict...` so running this
 * script twice against the same database is a safe no-op/update, never a
 * duplicate-key crash.
 *
 * Roles (`owner`/`secretary`/`barber`) are NOT created here — migration
 * 0006_access_control.sql already seeded those three rows plus their
 * `role_permissions`. This script only looks them up and attaches users.
 *
 * Passwords go through `Argon2PasswordHasher` exactly like `PasswordService`
 * would (never a literal hash) — this is the one place in this file with
 * real logic, not pure data shaping.
 */

const BARBER_CRISTIAN = 'a0000000-0000-4000-8000-000000000001';
const BARBER_FACUNDO = 'a0000000-0000-4000-8000-000000000002';
const BARBER_NAHUEL = 'a0000000-0000-4000-8000-000000000003';

const SERVICE_CORTE_CLASICO = 'b0000000-0000-4000-8000-000000000001';
const SERVICE_CORTE_BARBA = 'b0000000-0000-4000-8000-000000000002';
const SERVICE_BARBA = 'b0000000-0000-4000-8000-000000000003';
const SERVICE_CORTE_NINO = 'b0000000-0000-4000-8000-000000000004';

/** Demo login credentials — obviously non-production, documented verbatim
 *  in `docs/DEMO.md` so a human can log in live. Well over the 12-char
 *  `MIN_PASSWORD_LENGTH` staff passwords require. */
const STAFF_ACCOUNTS = [
  { email: 'dueno@jcbarberia.test', password: 'jcbarberia-dueno', role: 'owner', barberId: null as string | null },
  {
    email: 'secretaria@jcbarberia.test',
    password: 'jcbarberia-secre',
    role: 'secretary',
    barberId: null as string | null,
  },
  {
    email: 'cristian@jcbarberia.test',
    password: 'jcbarberia-barbero1',
    role: 'barber',
    barberId: BARBER_CRISTIAN,
  },
  {
    email: 'facundo@jcbarberia.test',
    password: 'jcbarberia-barbero2',
    role: 'barber',
    barberId: BARBER_FACUNDO,
  },
] as const;

// Domain's DayOfWeek convention: 0 (Sunday) … 6 (Saturday).
const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;
const SAT = 6;

async function seedBarbers(): Promise<void> {
  const rows = [
    { id: BARBER_CRISTIAN, name: 'Cristian Gómez', active: true },
    { id: BARBER_FACUNDO, name: 'Facundo Díaz', active: true },
    { id: BARBER_NAHUEL, name: 'Nahuel Torres', active: true },
  ];
  for (const barber of rows) {
    await db
      .insert(barbers)
      .values(barber)
      .onConflictDoUpdate({ target: barbers.id, set: { name: barber.name, active: barber.active } });
  }
}

async function seedServices(): Promise<void> {
  const rows = [
    { id: SERVICE_CORTE_CLASICO, name: 'Corte clásico', durationMinutes: 30, priceCents: 800_000 },
    { id: SERVICE_CORTE_BARBA, name: 'Corte + Barba', durationMinutes: 45, priceCents: 1_200_000 },
    { id: SERVICE_BARBA, name: 'Barba', durationMinutes: 20, priceCents: 500_000 },
    { id: SERVICE_CORTE_NINO, name: 'Corte niño', durationMinutes: 30, priceCents: 600_000 },
  ];
  for (const service of rows) {
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
  // Horario corrido, Monday-Saturday 09:00-20:00 — closed Sunday (no row).
  for (const dayOfWeek of [MON, TUE, WED, THU, FRI, SAT]) {
    await db
      .insert(shopHours)
      .values({ dayOfWeek, opensAt: '09:00', closesAt: '20:00' })
      .onConflictDoUpdate({
        target: shopHours.dayOfWeek,
        set: { opensAt: '09:00', closesAt: '20:00' },
      });
  }
}

async function seedBarberSchedules(): Promise<void> {
  // Each barber keeps their own hours/days off (README: "cada uno con su
  // propio horario y días libres") — demonstrates the per-barber narrowing
  // rather than every column looking identical in the demo's day board.
  const rows: { barberId: string; dayOfWeek: number; opensAt: string; closesAt: string }[] = [
    ...[MON, TUE, WED, THU, FRI].map((dayOfWeek) => ({
      barberId: BARBER_CRISTIAN,
      dayOfWeek,
      opensAt: '09:00',
      closesAt: '18:00',
    })),
    ...[TUE, WED, THU, FRI, SAT].map((dayOfWeek) => ({
      barberId: BARBER_FACUNDO,
      dayOfWeek,
      opensAt: '11:00',
      closesAt: '20:00',
    })),
    ...[MON, WED, FRI, SAT].map((dayOfWeek) => ({
      barberId: BARBER_NAHUEL,
      dayOfWeek,
      opensAt: '09:00',
      closesAt: '17:00',
    })),
  ];
  for (const row of rows) {
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

async function main(): Promise<void> {
  await seedBarbers();
  await seedServices();
  await seedShopHours();
  await seedBarberSchedules();
  await seedStaffUsers();

  console.log('[seed] done.');
  console.log('[seed] barbers:');
  console.log(`  Cristian Gómez  ${BARBER_CRISTIAN}`);
  console.log(`  Facundo Díaz    ${BARBER_FACUNDO}`);
  console.log(`  Nahuel Torres   ${BARBER_NAHUEL}`);
  console.log('[seed] services:');
  console.log(`  Corte clásico   ${SERVICE_CORTE_CLASICO}  $8.000,00  30min`);
  console.log(`  Corte + Barba   ${SERVICE_CORTE_BARBA}  $12.000,00  45min`);
  console.log(`  Barba           ${SERVICE_BARBA}  $5.000,00  20min`);
  console.log(`  Corte niño      ${SERVICE_CORTE_NINO}  $6.000,00  30min`);
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
