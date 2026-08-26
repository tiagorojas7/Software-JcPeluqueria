import { describe, expect, it } from 'vitest';

import { appointmentStatusCountLabel, appointmentStatusLabel } from './appointment-status';

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

describe('appointmentStatusCountLabel', () => {
  it.each([
    ['realizado', 2, '2 realizados'],
    ['reservado', 3, '3 reservados'],
    ['cancelado', 4, '4 cancelados'],
    ['ausente', 5, '5 ausentes'],
  ])('pluralises %s', (status, count, expected) => {
    expect(appointmentStatusCountLabel(status, count)).toBe(expected);
  });

  it('keeps the singular for exactly one', () => {
    expect(appointmentStatusCountLabel('realizado', 1)).toBe('1 realizado');
  });

  // "sin registrar" is a prepositional phrase, not an adjective: it does not
  // take an `s`. Appending one the way the other four statuses allow would
  // produce "sin registrars".
  it('does not inflect "sin registrar" in the plural', () => {
    expect(appointmentStatusCountLabel('sin_registrado', 2)).toBe('2 sin registrar');
    expect(appointmentStatusCountLabel('sin_registrado', 1)).toBe('1 sin registrar');
  });
});
