import { describe, expect, it } from 'vitest';

import { appointmentStatusLabel } from './appointment-status';

// One source of truth for status wording: the day board and the client's
// account page render the same appointment and must not call its state two
// different things.
describe('appointmentStatusLabel', () => {
  it.each([
    ['reservado', 'Reservado'],
    ['realizado', 'Realizado'],
    ['cancelado', 'Cancelado'],
    ['sin_registrado', 'Sin registrar'],
    ['ausente', 'Ausente'],
  ])('labels %s as "%s"', (status, label) => {
    expect(appointmentStatusLabel(status)).toBe(label);
  });

  // `sin_registrado` is the one the shop reads out loud when resolving a
  // pending day, and the database spelling is not a sentence anyone says.
  it('never leaks the snake_case database value for sin_registrado', () => {
    expect(appointmentStatusLabel('sin_registrado')).not.toContain('_');
  });

  // Slot types still permit the `held`/`liberado` hold states even though
  // the server filters those rows out. Falling back to the raw value keeps
  // an unexpected status visible instead of rendering an empty badge.
  it('falls back to the raw value for a status it does not know', () => {
    expect(appointmentStatusLabel('held')).toBe('held');
  });
});
