/**
 * The words the product uses for the domain's five appointment statuses
 * (`packages/domain/src/appointments/appointment-status.ts`).
 *
 * One source of truth on purpose: the same appointment is shown to the shop
 * on the day board and to the client on their account page, and the two must
 * not disagree about what its state is called. `sin_registrado` in
 * particular reads "Sin registrar" — the wording the README's status table
 * uses — because neither a barber nor a client should ever be shown a
 * snake_case database value.
 *
 * Deliberately keyed by `string` rather than by `AppointmentStatus`: slots
 * are typed wider than the five (the `held`/`liberado` hold states are still
 * in the type even though the server filters those rows out), so an unknown
 * value falls back to the raw string instead of rendering blank.
 */
const STATUS_LABELS: Record<string, string> = {
  reservado: 'Reservado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
  sin_registrado: 'Sin registrar',
  ausente: 'Ausente',
};

export function appointmentStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Plurals are spelled out rather than derived by appending an `s`: "sin
 * registrar" is a prepositional phrase and does not inflect, so the rule
 * that works for the other four ("realizados", "reservados") would produce
 * "sin registrars".
 */
const STATUS_PLURALS: Record<string, string> = {
  reservado: 'reservados',
  realizado: 'realizados',
  cancelado: 'cancelados',
  sin_registrado: 'sin registrar',
  ausente: 'ausentes',
};

/**
 * The phrase the shop would say when counting slots in a status — "2
 * realizados", "1 reservado".
 */
export function appointmentStatusCountLabel(status: string, count: number): string {
  if (count === 1) {
    return `${count} ${appointmentStatusLabel(status).toLowerCase()}`;
  }
  return `${count} ${STATUS_PLURALS[status] ?? appointmentStatusLabel(status).toLowerCase()}`;
}

/**
 * The order the panel lists statuses in: what still needs a decision first,
 * then what is still coming, then what is already settled. A barber opening
 * their column should read the thing they have to act on before the thing
 * they finished two hours ago.
 */
/**
 * How a turno entered the system (`slot_occupancies.channel`, exposed on
 * `DayBoardSlot.channel`).
 *
 * `web` is missing on purpose: an online booking is the normal path, and a
 * badge on every row would drown the two that are actually worth noticing.
 * The panel only names the exceptions.
 */
const CHANNEL_LABELS: Record<string, string> = {
  walk_in: 'Walk-in',
  telefonico: 'Teléfono',
};

export function appointmentChannelLabel(channel: string): string | null {
  return CHANNEL_LABELS[channel] ?? null;
}

/**
 * The order the panel lists statuses in: what still needs a decision first,
 * then what is still coming, then what is already settled. A barber opening
 * their column should read the thing they have to act on before the thing
 * they finished two hours ago.
 */
export const STATUS_DISPLAY_ORDER: readonly string[] = [
  'sin_registrado',
  'reservado',
  'realizado',
  'ausente',
  'cancelado',
];
