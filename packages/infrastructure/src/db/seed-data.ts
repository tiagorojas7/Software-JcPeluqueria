/**
 * Pure demo data for `db/seed.ts` — no drizzle, no `db` import, on purpose:
 * `seed-data.spec.ts` validates every invariant below without a database
 * (this is the one piece of the arranque slice's seed script that is real
 * data-SHAPING logic, not pure I/O, so it is the one piece that gets a
 * test — see apply-progress).
 *
 * Fixed, readable UUIDs on purpose: `apps/web/src/shared/demo-data.ts`
 * duplicates these same ids for the SPA's `DEMO_BARBERS`/`DEMO_SERVICES`
 * (no HTTP endpoint lists them yet, see that file's own doc comment) — the
 * ids need to be stable across re-runs so that fixed frontend list keeps
 * matching real seeded rows, not whatever `defaultRandom()` happens to
 * generate.
 */

export const BARBER_CRISTIAN = 'a0000000-0000-4000-8000-000000000001';
export const BARBER_FACUNDO = 'a0000000-0000-4000-8000-000000000002';
export const BARBER_NAHUEL = 'a0000000-0000-4000-8000-000000000003';

export const SERVICE_CORTE_CLASICO = 'b0000000-0000-4000-8000-000000000001';
export const SERVICE_CORTE_BARBA = 'b0000000-0000-4000-8000-000000000002';
export const SERVICE_BARBA = 'b0000000-0000-4000-8000-000000000003';
export const SERVICE_CORTE_NINO = 'b0000000-0000-4000-8000-000000000004';

export interface DemoBarber {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export const DEMO_BARBERS: readonly DemoBarber[] = [
  { id: BARBER_CRISTIAN, name: 'Cristian Gómez', active: true },
  { id: BARBER_FACUNDO, name: 'Facundo Díaz', active: true },
  { id: BARBER_NAHUEL, name: 'Nahuel Torres', active: true },
];

export interface DemoService {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number;
}

export const DEMO_SERVICES: readonly DemoService[] = [
  { id: SERVICE_CORTE_CLASICO, name: 'Corte clásico', durationMinutes: 30, priceCents: 800_000 },
  { id: SERVICE_CORTE_BARBA, name: 'Corte + Barba', durationMinutes: 45, priceCents: 1_200_000 },
  { id: SERVICE_BARBA, name: 'Barba', durationMinutes: 20, priceCents: 500_000 },
  { id: SERVICE_CORTE_NINO, name: 'Corte niño', durationMinutes: 30, priceCents: 600_000 },
];

// Domain's DayOfWeek convention: 0 (Sunday) … 6 (Saturday).
export const MON = 1;
export const TUE = 2;
export const WED = 3;
export const THU = 4;
export const FRI = 5;
export const SAT = 6;

export interface DemoShopHours {
  readonly dayOfWeek: number;
  readonly opensAt: string;
  readonly closesAt: string;
}

// Horario corrido, Monday-Saturday 09:00-20:00 — closed Sunday (no row).
export const SHOP_HOURS: readonly DemoShopHours[] = [MON, TUE, WED, THU, FRI, SAT].map((dayOfWeek) => ({
  dayOfWeek,
  opensAt: '09:00',
  closesAt: '20:00',
}));

export interface DemoBarberSchedule {
  readonly barberId: string;
  readonly dayOfWeek: number;
  readonly opensAt: string;
  readonly closesAt: string;
}

// Each barber keeps their own hours/days off (README: "cada uno con su
// propio horario y días libres") — demonstrates the per-barber narrowing
// rather than every column looking identical in the demo's day board.
export const BARBER_SCHEDULES: readonly DemoBarberSchedule[] = [
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

export type StaffRole = 'owner' | 'secretary' | 'barber';

export interface DemoStaffAccount {
  readonly email: string;
  readonly password: string;
  readonly role: StaffRole;
  readonly barberId: string | null;
}

/** Demo login credentials — obviously non-production, documented verbatim
 *  in `docs/DEMO.md` so a human can log in live. Well over the 12-char
 *  `MIN_PASSWORD_LENGTH` staff passwords require (`seed-data.spec.ts`
 *  checks against that exact constant, never a hardcoded `12`). */
export const STAFF_ACCOUNTS: readonly DemoStaffAccount[] = [
  { email: 'dueno@jcbarberia.test', password: 'jcbarberia-dueno', role: 'owner', barberId: null },
  { email: 'secretaria@jcbarberia.test', password: 'jcbarberia-secre', role: 'secretary', barberId: null },
  { email: 'cristian@jcbarberia.test', password: 'jcbarberia-barbero1', role: 'barber', barberId: BARBER_CRISTIAN },
  { email: 'facundo@jcbarberia.test', password: 'jcbarberia-barbero2', role: 'barber', barberId: BARBER_FACUNDO },
];
