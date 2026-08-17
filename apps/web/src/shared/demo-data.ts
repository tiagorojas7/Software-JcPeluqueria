/**
 * Fixed reference data for the demo, mirroring the fixed UUIDs
 * `packages/infrastructure/src/db/seed.ts` inserts. Duplicated on purpose,
 * not imported: `seed.ts` lives in a Node-only package (drizzle/postgres/
 * argon2 dependencies that must never reach a browser bundle), and there is
 * no HTTP endpoint that lists barbers/services for this SPA to fetch from
 * instead (out of scope for the arranque slice — see apply-progress). If the
 * seed script's ids ever change, this file needs the same update.
 */
export const DEMO_BARBERS = [
  { id: 'a0000000-0000-4000-8000-000000000001', name: 'Cristian Gómez' },
  { id: 'a0000000-0000-4000-8000-000000000002', name: 'Facundo Díaz' },
  { id: 'a0000000-0000-4000-8000-000000000003', name: 'Nahuel Torres' },
] as const;

export const DEMO_SERVICES = [
  { id: 'b0000000-0000-4000-8000-000000000001', name: 'Corte clásico ($8.000)' },
  { id: 'b0000000-0000-4000-8000-000000000002', name: 'Corte + Barba ($12.000)' },
  { id: 'b0000000-0000-4000-8000-000000000003', name: 'Barba ($5.000)' },
  { id: 'b0000000-0000-4000-8000-000000000004', name: 'Corte niño ($6.000)' },
] as const;
