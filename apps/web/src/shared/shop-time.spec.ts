import { describe, expect, it } from 'vitest';

import { dayOfWeekOfCalendarDate, utcIsoToShopLocalDate } from './shop-time';

// A client's "Mi cuenta" list showed only `HH:mm`, so two turnos on
// different days were indistinguishable — the same "11:00" twice. The date
// is derived from the ISO string rather than a `Date`, matching the
// no-`Date`-construction rule the rest of this module already follows.
describe('utcIsoToShopLocalDate', () => {
  it('formats the day and month the way the shop reads it', () => {
    expect(utcIsoToShopLocalDate('2026-05-15T12:00:00.000Z')).toBe('15/05');
  });

  it('keeps the leading zeroes so every date is the same width in a list', () => {
    expect(utcIsoToShopLocalDate('2026-01-05T14:30:00.000Z')).toBe('05/01');
  });

  // The shop opens 09:00 local, which is 12:00 UTC, and closes 20:00 local
  // (23:00 UTC). No appointment instant ever lands close enough to UTC
  // midnight for the -03:00 offset to move it to the previous calendar day,
  // which is exactly why slicing the ISO date is safe here.
  it('agrees with the local date across the whole opening window', () => {
    expect(utcIsoToShopLocalDate('2026-05-15T12:00:00.000Z')).toBe('15/05');
    expect(utcIsoToShopLocalDate('2026-05-15T22:59:00.000Z')).toBe('15/05');
  });
});

// Los formularios del panel ofrecian los siete dias de la semana aunque el
// barbero atendiera cuatro: para saber si una fecha cae en un dia que ese
// barbero trabaja hace falta su dia de semana. Sin construir `Date` — la
// regla de lint del repo la prohibe fuera del Clock.
describe('dayOfWeekOfCalendarDate', () => {
  it('resuelve el dia de la semana con 0=domingo, igual que el resto del sistema', () => {
    expect(dayOfWeekOfCalendarDate('2026-08-30')).toBe(0); // domingo
    expect(dayOfWeekOfCalendarDate('2026-08-31')).toBe(1); // lunes
    expect(dayOfWeekOfCalendarDate('2026-09-05')).toBe(6); // sabado
  });

  it('acierta cruzando fin de mes y fin de anio', () => {
    expect(dayOfWeekOfCalendarDate('2026-12-31')).toBe(4); // jueves
    expect(dayOfWeekOfCalendarDate('2027-01-01')).toBe(5); // viernes
  });

  it('acierta en un 29 de febrero bisiesto', () => {
    expect(dayOfWeekOfCalendarDate('2028-02-29')).toBe(2); // martes
  });

  it('devuelve null para una fecha vacia o mal formada, nunca un dia inventado', () => {
    expect(dayOfWeekOfCalendarDate('')).toBeNull();
    expect(dayOfWeekOfCalendarDate('31/08/2026')).toBeNull();
  });
});
