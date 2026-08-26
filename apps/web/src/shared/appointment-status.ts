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
