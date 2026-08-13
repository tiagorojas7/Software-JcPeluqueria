/**
 * The appointment's lifecycle status — exactly five values, explicit and
 * non-collapsible (appointment-lifecycle spec, "Cinco estados explícitos y
 * no colapsables"; README "3.2 Ciclo de vida del turno"). These are the
 * exact Spanish tokens design.md assigns to the eventual
 * `slot_occupancies.status` column (`held`/`liberado` precede this list —
 * those are `slot-hold` states, Phase 2, not appointment states), so the
 * persistence layer a later phase adds never needs a translation table
 * between domain and column values.
 */
export const APPOINTMENT_STATUSES = [
  'reservado',
  'realizado',
  'cancelado',
  'sin_registrado',
  'ausente',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
